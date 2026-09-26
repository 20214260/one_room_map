from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..draft import DraftRequest, generate_draft
from ..errors import ApiException
from ..listing import AUTO_PUBLISH, Contact, RoomSubmission, apply_submission, new_room_id, owner_source
from ..models import PUBLIC_STATUS, InquiryRow, RoomRow, UserRow, to_room
from ..search import Search, search_rooms
from ..security import rate_limit, verify_csrf
from ..verification import require_verified_landlord
from .auth import require_user

router = APIRouter(prefix="/rooms", tags=["rooms"])

# 주의: /rooms/draft 같은 고정 경로는 /{room_id} 보다 위에 선언할 것


@router.post("/draft", dependencies=[Depends(verify_csrf)])
def draft(body: DraftRequest, user: UserRow = Depends(require_verified_landlord)):
    """POST /api/v1/rooms/draft (인증 승인된 집주인)  →  DraftResponse. AI 실패·미설정이면 mode: rules"""
    rate_limit(f"draft:{user.id}", limit=20, per_seconds=600)
    return generate_draft(body)


@router.get("")
def list_rooms(search: str | None = Query(default=None), db: Session = Depends(get_db)):
    """GET /api/v1/rooms?search=<Search JSON, URL 인코딩>  →  {items, total}"""
    try:
        s = Search.model_validate_json(search) if search else Search()
    except ValidationError:
        raise ApiException(422, "INVALID_SEARCH", "search 파라미터 형식이 올바르지 않음")

    # 샘플 규모라 공개 매물을 전부 읽고 프론트와 같은 로직으로 거름 (계약상 페이지네이션 없음)
    rows = db.scalars(select(RoomRow).where(RoomRow.status == PUBLIC_STATUS)).all()
    items = search_rooms([to_room(r) for r in rows], s)
    return {"items": items, "total": len(items)}


@router.get("/{room_id}")
def get_room(room_id: str, db: Session = Depends(get_db)):
    """GET /api/v1/rooms/{id}  →  Room (검수 대기·숨김·거래 완료·없음은 모두 404)"""
    row = db.get(RoomRow, room_id)
    if row is None or row.status != PUBLIC_STATUS:
        raise ApiException(404, "NOT_FOUND", "매물 없음 또는 비공개")
    return to_room(row)


# ── 집주인 매물 등록 ────────────────────────────────────────
@router.post("", dependencies=[Depends(verify_csrf)])
def submit_room(body: RoomSubmission, user: UserRow = Depends(require_verified_landlord),
                db: Session = Depends(get_db)):
    """POST /api/v1/rooms (인증 승인된 집주인 전용)  →  {roomId, status}. 미승인 403 VERIFICATION_REQUIRED"""
    rate_limit(f"submit:{user.id}", limit=20, per_seconds=3600)
    row = RoomRow(id=new_room_id(), owner_id=user.id,
                  status="published" if AUTO_PUBLISH else "pending_review",
                  source=owner_source(), distance_source=None,
                  facilities=[], school_distance=None, near_commercial=None)
    apply_submission(row, body)
    db.add(row)
    db.commit()
    return {"roomId": row.id, "status": row.status}


# ── 문의 (학생 → 집주인 중계) ─────────────────────────────────
class InquiryBody(BaseModel):
    roomId: str
    message: str = Field(min_length=1, max_length=500)
    replyContact: Contact  # 형식만 검사하고 저장하지 않음

    @field_validator("message", mode="before")
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v


@router.post("/{room_id}/inquiries", dependencies=[Depends(verify_csrf)])
def inquire(room_id: str, body: InquiryBody, user: UserRow = Depends(require_user),
            db: Session = Depends(get_db)):
    """POST /api/v1/rooms/{id}/inquiries (로그인)  →  {status: 'sent'}"""
    if body.roomId != room_id:
        raise ApiException(422, "INVALID_INPUT", "roomId 불일치")
    rate_limit(f"inquire:{user.id}", limit=20, per_seconds=600)
    row = db.get(RoomRow, room_id)
    # 샘플 매물(owner 없음)과 비공개 매물에는 문의 불가
    if row is None or row.status != PUBLIC_STATUS or row.owner_id is None:
        raise ApiException(404, "NOT_FOUND", "문의할 수 없는 매물")
    if row.owner_id == user.id:
        raise ApiException(400, "OWN_ROOM", "내 매물에는 문의 불가")
    db.add(InquiryRow(room_id=room_id, sender_id=user.id, message=body.message))
    db.commit()
    return {"status": "sent"}
