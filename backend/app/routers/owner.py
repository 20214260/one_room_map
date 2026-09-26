"""집주인 전용 API. 계약: docs/LANDLORD_HANDOFF.md, src/contracts/landlord.ts

모든 경로에서 세션의 user.id 로 소유권을 검사함. 남의 매물·문의는 404 (존재 여부도 숨김).
매물 수정·상태 변경·삭제·사진 업로드는 집주인 인증 승인(require_verified_landlord)까지 확인. 미승인 403 VERIFICATION_REQUIRED.
"""

from typing import Literal

from fastapi import APIRouter, Depends, File, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import ApiException
from ..listing import AUTO_PUBLISH, RoomSubmission, apply_submission, to_owner_listing
from ..models import InquiryRow, RoomRow, UserRow
from ..security import rate_limit, verify_csrf
from ..storage import MAX_BYTES, normalize_image, upload_photo
from ..verification import require_verified_landlord
from .auth import require_landlord

router = APIRouter(prefix="/owner", tags=["owner"])


def _owned(db: Session, room_id: str, user: UserRow) -> RoomRow:
    row = db.get(RoomRow, room_id)
    if row is None or row.owner_id != user.id:
        raise ApiException(404, "NOT_FOUND", "내 매물 아님")
    return row


@router.get("/rooms")
def my_rooms(user: UserRow = Depends(require_landlord), db: Session = Depends(get_db)):
    rows = db.scalars(select(RoomRow).where(RoomRow.owner_id == user.id)
                      .order_by(RoomRow.updated_at.desc())).all()
    return {"items": [to_owner_listing(r) for r in rows]}


@router.patch("/rooms/{room_id}", dependencies=[Depends(verify_csrf)])
def update_room(room_id: str, body: RoomSubmission, user: UserRow = Depends(require_verified_landlord),
                db: Session = Depends(get_db)):
    """전체 RoomSubmission 교체."""
    row = _owned(db, room_id, user)
    apply_submission(row, body)
    if not AUTO_PUBLISH and row.status == "published":
        row.status = "pending_review"  # 검수 운영 시 수정하면 다시 검수
    db.commit()
    db.refresh(row)
    return to_owner_listing(row)


class StatusBody(BaseModel):
    status: Literal["pending_review", "published", "hidden", "closed"]


@router.patch("/rooms/{room_id}/status", dependencies=[Depends(verify_csrf)])
def set_status(room_id: str, body: StatusBody, user: UserRow = Depends(require_verified_landlord),
               db: Session = Depends(get_db)):
    """
    - pending_review 로는 집주인이 바꿀 수 없음
    - 검수 대기 중인 매물을 스스로 공개할 수 없음
    - 숨김/거래 완료 → 공개: 검수 운영 중이면 pending_review 로 돌아감
    """
    row = _owned(db, room_id, user)
    target = body.status
    if target != row.status:
        if target == "pending_review" or (target == "published" and row.status == "pending_review"):
            raise ApiException(409, "INVALID_TRANSITION", f"{row.status} → {target} 불가")
        if target == "published" and not AUTO_PUBLISH:
            target = "pending_review"
        row.status = target
        db.commit()
        db.refresh(row)
    return to_owner_listing(row)


@router.delete("/rooms/{room_id}", status_code=204, dependencies=[Depends(verify_csrf)])
def delete_room(room_id: str, user: UserRow = Depends(require_verified_landlord), db: Session = Depends(get_db)):
    row = _owned(db, room_id, user)
    db.delete(row)  # 문의는 FK on delete cascade 로 같이 삭제
    db.commit()
    return Response(status_code=204)


@router.get("/inquiries")
def inbox(user: UserRow = Depends(require_landlord), db: Session = Depends(get_db)):
    rows = db.execute(
        select(InquiryRow, RoomRow.title)
        .join(RoomRow, RoomRow.id == InquiryRow.room_id)
        .where(RoomRow.owner_id == user.id)
        .order_by(InquiryRow.created_at.desc())
    ).all()
    return {"items": [
        {"id": str(i.id), "roomId": i.room_id, "roomTitle": title, "message": i.message,
         "createdAt": i.created_at.isoformat().replace("+00:00", "Z"), "read": i.read}
        for i, title in rows
    ]}


@router.patch("/inquiries/{inquiry_id}/read", status_code=204, dependencies=[Depends(verify_csrf)])
def read_inquiry(inquiry_id: str, user: UserRow = Depends(require_landlord), db: Session = Depends(get_db)):
    try:
        import uuid
        iid = uuid.UUID(inquiry_id)
    except ValueError:
        raise ApiException(404, "NOT_FOUND", "문의 없음")
    row = db.execute(
        select(InquiryRow).join(RoomRow, RoomRow.id == InquiryRow.room_id)
        .where(InquiryRow.id == iid, RoomRow.owner_id == user.id)
    ).scalar_one_or_none()
    if row is None:
        raise ApiException(404, "NOT_FOUND", "문의 없음")
    row.read = True
    db.commit()
    return Response(status_code=204)


@router.post("/photos", dependencies=[Depends(verify_csrf)])
async def upload(file: UploadFile = File(...), user: UserRow = Depends(require_verified_landlord)):
    """POST /owner/photos (multipart file) → {photo: {url, alt}}"""
    rate_limit(f"photo:{user.id}", limit=40, per_seconds=600)
    data = await file.read(MAX_BYTES + 1)
    jpeg = normalize_image(data)
    url = upload_photo(str(user.id), jpeg)
    return {"photo": {"url": url, "alt": "등록자가 제공한 방 사진"}}
