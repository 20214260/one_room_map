"""관리자 전용 집주인 인증 심사 API. 관리자 = .env ADMIN_EMAILS 에 있는 이메일로 로그인한 사용자.

| Method | 경로                                     | 응답                                   |
| GET    | /admin/verifications?status=reviewing   | {items: 신청 목록 (이름·주소·AI 참고 결과 포함)} |
| GET    | /admin/verifications/{userId}/proof     | 증빙 원본 (다운로드 전용, 캐시 금지)          |
| POST   | /admin/verifications/{userId}/decision  | {applicationId, status, message} → 갱신된 신청 |

결정 규칙
- reviewing 인 신청만 approved / needs_info / rejected 로 결정. applicationId 가 현재 신청과 달라야 409
- approved → rejected 는 권한 철회로 허용
- needs_info / rejected 는 신청자에게 보여줄 message 필수
- 본인 신청은 본인이 결정할 수 없음
"""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import ApiException
from ..models import OwnerVerificationRow, UserRow
from ..security import verify_csrf
from ..verification import EXT, _now, iso, load_proof, require_admin, to_status

router = APIRouter(prefix="/admin", tags=["admin"])

Status = Literal["not_submitted", "reviewing", "needs_info", "approved", "rejected"]


def _item(row: OwnerVerificationRow, user: UserRow) -> dict:
    return to_status(row) | {
        "userId": str(row.user_id),
        "email": user.email,
        "ownerName": row.owner_name,
        "buildingAddress": row.building_address,
        "proof": {"mime": row.proof_mime, "size": row.proof_size} if row.proof_path else None,
        "reviewedAt": iso(row.reviewed_at),
        # 참고용. None 이면 AI 미연결·실패 → 관리자가 서류를 직접 확인
        "aiReview": row.ai_review,
    }


def _find(db: Session, user_id: str) -> tuple[OwnerVerificationRow, UserRow]:
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise ApiException(404, "NOT_FOUND", "신청 없음")
    row, user = db.get(OwnerVerificationRow, uid), db.get(UserRow, uid)
    if row is None or user is None:
        raise ApiException(404, "NOT_FOUND", "신청 없음")
    return row, user


@router.get("/verifications")
def list_verifications(status: Status | None = Query(default="reviewing"),
                       _: UserRow = Depends(require_admin), db: Session = Depends(get_db)):
    q = select(OwnerVerificationRow, UserRow).join(UserRow, UserRow.id == OwnerVerificationRow.user_id)
    if status is not None:
        q = q.where(OwnerVerificationRow.status == status)
    rows = db.execute(q.order_by(OwnerVerificationRow.submitted_at)).all()
    return {"items": [_item(r, u) for r, u in rows]}


@router.get("/verifications/{user_id}/proof")
def get_proof(user_id: str, _: UserRow = Depends(require_admin), db: Session = Depends(get_db)):
    row, _user = _find(db, user_id)
    if not row.proof_path or not row.proof_mime:
        raise ApiException(404, "NOT_FOUND", "증빙 없음")
    return Response(
        load_proof(row.proof_path),
        media_type=row.proof_mime,
        headers={
            "Content-Disposition": f'attachment; filename="proof-{row.application_id}.{EXT[row.proof_mime]}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
        },
    )


class DecisionBody(BaseModel):
    applicationId: str
    status: Literal["approved", "needs_info", "rejected"]
    message: str | None = Field(default=None, max_length=300)


@router.post("/verifications/{user_id}/decision", dependencies=[Depends(verify_csrf)])
def decide(user_id: str, body: DecisionBody, admin: UserRow = Depends(require_admin),
           db: Session = Depends(get_db)):
    row, user = _find(db, user_id)
    if row.user_id == admin.id:
        raise ApiException(403, "FORBIDDEN", "본인 신청은 결정할 수 없음")
    if str(row.application_id) != body.applicationId:
        raise ApiException(409, "STALE_APPLICATION", "신청이 바뀜. 목록을 새로고침")
    revoke = row.status == "approved" and body.status == "rejected"
    if row.status != "reviewing" and not revoke:
        raise ApiException(409, "INVALID_TRANSITION", f"{row.status} → {body.status} 불가")
    message = (body.message or "").strip() or None
    if body.status != "approved" and message is None:
        raise ApiException(422, "INVALID_INPUT", "보완 요청·반려는 사유 필요")
    row.status, row.message = body.status, message
    row.reviewed_at, row.reviewed_by = _now(), admin.id
    db.commit()
    db.refresh(row)
    return _item(row, user)
