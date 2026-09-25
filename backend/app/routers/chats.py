"""학생 ↔ 집주인 채팅. 계약: docs/CHAT_HANDOFF.md, src/contracts/chat.ts

지키는 규칙
1. 참가자(owner/seeker)만 접근. 남의 대화는 전부 404
2. 대화 시작은 seeker 만, 공개 중인 "직접 등록" 매물만 (샘플 불가). (room, seeker) 당 대화 1개
3. 메시지 1~500자. 차단 → 403 CHAT_BLOCKED, 거래 완료·삭제 → 409 ROOM_CLOSED. 숨김 매물은 계속 대화 가능
4. 읽지 않은 수 = 상대 메시지 중 내 마지막 읽음 위치(seq) 이후 개수
5. 방문 제안은 미래 시각만, 상대 제안에만 1번 답변
6. 신고는 신고자별 1번. 신고·차단해도 기록은 지우지 않음
"""

import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import ApiException
from ..models import ChatMessageRow, ChatReportRow, ChatRow, RoomRow, UserRow
from ..security import rate_limit, verify_csrf
from .auth import require_user

router = APIRouter(prefix="/chats", tags=["chats"])


# ── 요청 형식 ──────────────────────────────────────────────
def _strip(v):
    return v.strip() if isinstance(v, str) else v


class StartChatBody(BaseModel):
    roomId: str
    message: str = Field(min_length=1, max_length=500)
    _s = field_validator("message", mode="before")(classmethod(lambda cls, v: _strip(v)))


class MessageBody(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    _s = field_validator("message", mode="before")(classmethod(lambda cls, v: _strip(v)))


class VisitBody(BaseModel):
    visitAt: datetime


class VisitResponseBody(BaseModel):
    decision: Literal["accepted", "declined"]


class ReportBody(BaseModel):
    reason: Literal["spam", "inappropriate", "other"]


# ── 변환 ───────────────────────────────────────────────────
def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _mask(name: str) -> str:
    """이름이 이메일 앞부분이라 그대로 보여주지 않음."""
    return (name[:2] + "***") if name else "사용자"


def _msg(m: ChatMessageRow) -> dict:
    return {
        "id": str(m.id), "senderId": str(m.sender_id) if m.sender_id else "", "kind": m.kind,
        "text": m.text, "createdAt": _iso(m.created_at), "visitAt": _iso(m.visit_at),
        "proposalId": str(m.proposal_id) if m.proposal_id else None, "decision": m.decision,
    }


def _room_view(db: Session, chat: ChatRow) -> dict:
    """채팅에 보여줄 공개 가능한 매물 요약. 삭제됐으면 저장해 둔 요약 + status 'deleted'."""
    room = db.get(RoomRow, chat.room_id) if chat.room_id else None
    if room is None:
        return {**chat.room_snapshot, "status": "deleted"}
    return {
        "id": room.id, "title": room.title,
        "photoUrl": (room.photos or [{}])[0].get("url") if room.photos else None,
        "location": room.neighborhood or "", "deposit": room.deposit, "rent": room.rent,
        "maintenance": room.maintenance, "status": room.status,
    }


def _snapshot(room: RoomRow) -> dict:
    return {
        "id": room.id, "title": room.title,
        "photoUrl": room.photos[0]["url"] if room.photos else None,
        "location": room.neighborhood or "", "deposit": room.deposit, "rent": room.rent,
        "maintenance": room.maintenance,
    }


def _summary(db: Session, chat: ChatRow, me: UserRow, with_messages: bool = False) -> dict:
    i_am_owner = chat.owner_id == me.id
    read_seq = chat.owner_read_seq if i_am_owner else chat.seeker_read_seq
    unread = db.scalar(select(func.count()).select_from(ChatMessageRow).where(
        ChatMessageRow.chat_id == chat.id, ChatMessageRow.seq > read_seq,
        ChatMessageRow.sender_id != me.id))
    msgs = db.scalars(select(ChatMessageRow).where(ChatMessageRow.chat_id == chat.id)
                      .order_by(ChatMessageRow.seq)).all() if with_messages else None
    last = msgs[-1] if msgs else db.scalars(
        select(ChatMessageRow).where(ChatMessageRow.chat_id == chat.id)
        .order_by(ChatMessageRow.seq.desc()).limit(1)).first()
    other = db.get(UserRow, chat.seeker_id if i_am_owner else chat.owner_id)
    out = {
        "id": str(chat.id),
        "room": _room_view(db, chat),
        "otherPartyName": _mask(other.name) if (i_am_owner and other) else "집주인",
        "unreadCount": unread or 0,
        "lastMessage": _msg(last) if last else None,
        "updatedAt": _iso(last.created_at if last else chat.created_at),
        "blocked": chat.blocked_by is not None,
    }
    if with_messages:
        out["messages"] = [_msg(m) for m in msgs]
    return out


# ── 공통 검사 ──────────────────────────────────────────────
def _chat_for(db: Session, chat_id: str, me: UserRow) -> ChatRow:
    try:
        cid = uuid.UUID(chat_id)
    except ValueError:
        raise ApiException(404, "NOT_FOUND", "대화 없음")
    chat = db.get(ChatRow, cid)
    if chat is None or me.id not in (chat.owner_id, chat.seeker_id):
        raise ApiException(404, "NOT_FOUND", "대화 없음")
    return chat


def _writable(db: Session, chat: ChatRow) -> None:
    if chat.blocked_by is not None:
        raise ApiException(403, "CHAT_BLOCKED", "차단된 대화")
    if _room_view(db, chat)["status"] in ("closed", "deleted"):
        raise ApiException(409, "ROOM_CLOSED", "거래 종료")


def _add(db: Session, chat: ChatRow, me: UserRow, kind: str, text: str, **extra) -> ChatMessageRow:
    m = ChatMessageRow(chat_id=chat.id, sender_id=me.id, kind=kind, text=text, **extra)
    db.add(m)
    chat.updated_at = func.now()
    db.flush()
    db.refresh(m)
    return m


# ── 라우트 ─────────────────────────────────────────────────
@router.get("")
def list_chats(me: UserRow = Depends(require_user), db: Session = Depends(get_db)):
    chats = db.scalars(select(ChatRow).where(
        (ChatRow.owner_id == me.id) | (ChatRow.seeker_id == me.id))).all()
    items = [_summary(db, c, me) for c in chats]
    items.sort(key=lambda x: x["updatedAt"], reverse=True)
    return {"items": items}


@router.post("", dependencies=[Depends(verify_csrf)])
def start_chat(body: StartChatBody, me: UserRow = Depends(require_user), db: Session = Depends(get_db)):
    if me.role != "seeker":
        raise ApiException(403, "FORBIDDEN", "방 찾는 사용자만 대화를 시작할 수 있음")
    rate_limit(f"chat:{me.id}", limit=60, per_seconds=60)
    chat = db.scalar(select(ChatRow).where(ChatRow.room_id == body.roomId, ChatRow.seeker_id == me.id))
    if chat is None:
        room = db.get(RoomRow, body.roomId)
        if room is None or room.status != "published" or room.owner_id is None:
            raise ApiException(404, "NOT_FOUND", "직접 등록한 공개 매물에만 대화 가능")
        if room.owner_id == me.id:
            raise ApiException(400, "OWN_ROOM", "내 매물")
        chat = ChatRow(room_id=room.id, room_snapshot=_snapshot(room), owner_id=room.owner_id, seeker_id=me.id)
        db.add(chat)
        try:
            db.flush()
        except IntegrityError:  # 동시에 두 번 눌러도 대화는 하나
            db.rollback()
            chat = db.scalar(select(ChatRow).where(ChatRow.room_id == body.roomId, ChatRow.seeker_id == me.id))
    _writable(db, chat)
    _add(db, chat, me, "text", body.message)
    db.commit()
    return _summary(db, chat, me, with_messages=True)


@router.get("/{chat_id}")
def get_chat(chat_id: str, me: UserRow = Depends(require_user), db: Session = Depends(get_db)):
    return _summary(db, _chat_for(db, chat_id, me), me, with_messages=True)


@router.post("/{chat_id}/messages", dependencies=[Depends(verify_csrf)])
def send_message(chat_id: str, body: MessageBody, me: UserRow = Depends(require_user),
                 db: Session = Depends(get_db)):
    chat = _chat_for(db, chat_id, me)
    rate_limit(f"chat:{me.id}", limit=60, per_seconds=60)
    _writable(db, chat)
    m = _add(db, chat, me, "text", body.message)
    db.commit()
    return _msg(m)


@router.patch("/{chat_id}/read", status_code=204, dependencies=[Depends(verify_csrf)])
def mark_read(chat_id: str, me: UserRow = Depends(require_user), db: Session = Depends(get_db)):
    chat = _chat_for(db, chat_id, me)
    top = db.scalar(select(func.max(ChatMessageRow.seq)).where(ChatMessageRow.chat_id == chat.id)) or 0
    if chat.owner_id == me.id:
        chat.owner_read_seq = max(chat.owner_read_seq, top)
    else:
        chat.seeker_read_seq = max(chat.seeker_read_seq, top)
    db.commit()
    return Response(status_code=204)


@router.post("/{chat_id}/visits", dependencies=[Depends(verify_csrf)])
def propose_visit(chat_id: str, body: VisitBody, me: UserRow = Depends(require_user),
                  db: Session = Depends(get_db)):
    chat = _chat_for(db, chat_id, me)
    _writable(db, chat)
    at = body.visitAt if body.visitAt.tzinfo else body.visitAt.replace(tzinfo=timezone.utc)
    if at <= datetime.now(timezone.utc):
        raise ApiException(400, "INVALID_VISIT", "미래 시각만 가능")
    m = _add(db, chat, me, "visit_proposal", "방문 시간을 제안했어요.", visit_at=at)
    db.commit()
    return _msg(m)


@router.post("/{chat_id}/visits/{proposal_id}/response", dependencies=[Depends(verify_csrf)])
def respond_visit(chat_id: str, proposal_id: str, body: VisitResponseBody,
                  me: UserRow = Depends(require_user), db: Session = Depends(get_db)):
    chat = _chat_for(db, chat_id, me)
    _writable(db, chat)
    try:
        pid = uuid.UUID(proposal_id)
    except ValueError:
        raise ApiException(404, "NOT_FOUND", "방문 제안 없음")
    proposal = db.get(ChatMessageRow, pid)
    if (proposal is None or proposal.chat_id != chat.id or proposal.kind != "visit_proposal"
            or proposal.sender_id == me.id):
        raise ApiException(404, "NOT_FOUND", "방문 제안 없음")
    text = "방문 시간을 수락했어요." if body.decision == "accepted" else "방문 시간을 거절했어요."
    try:
        m = _add(db, chat, me, "visit_response", text, visit_at=proposal.visit_at,
                 proposal_id=proposal.id, decision=body.decision)
        db.commit()
    except IntegrityError:  # 이미 답변함 (DB 고유 제약)
        db.rollback()
        raise ApiException(409, "INVALID_TRANSITION", "이미 답변한 제안")
    return _msg(m)


@router.post("/{chat_id}/block", dependencies=[Depends(verify_csrf)])
def block(chat_id: str, me: UserRow = Depends(require_user), db: Session = Depends(get_db)):
    chat = _chat_for(db, chat_id, me)
    if chat.blocked_by is None:
        chat.blocked_by = me.id
        db.commit()
    return _summary(db, chat, me, with_messages=True)


@router.post("/{chat_id}/reports", dependencies=[Depends(verify_csrf)])
def report(chat_id: str, body: ReportBody, me: UserRow = Depends(require_user), db: Session = Depends(get_db)):
    chat = _chat_for(db, chat_id, me)
    db.execute(pg_insert(ChatReportRow).values(chat_id=chat.id, reporter_id=me.id, reason=body.reason)
               .on_conflict_do_nothing())
    db.commit()
    return {"status": "received"}
