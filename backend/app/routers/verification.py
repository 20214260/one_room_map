"""집주인 인증 신청 API. 계약: docs/OWNER_VERIFICATION_HANDOFF.md, src/contracts/verification.ts

| Method | 경로                 | 응답                                         |
| GET    | /owner/verification | 로그인한 집주인 본인의 VerificationStatus       |
| POST   | /owner/verification | multipart ownerName, buildingAddress, consent=true, proof → VerificationStatus |

다른 사람의 신청은 조회할 경로 자체가 없음 (세션 user.id 로만 조회). 심사·승인은 routers/admin.py.
"""

import uuid

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import ApiException
from ..models import OwnerVerificationRow, UserRow
from ..security import rate_limit, verify_csrf
from ..verification import (
    MAX_PROOF_BYTES,
    RESUBMITTABLE,
    _now,
    delete_proof,
    get_row,
    inspect_proof,
    run_ai_review,
    save_proof,
    to_status,
)
from .auth import require_landlord

router = APIRouter(prefix="/owner", tags=["owner-verification"])


@router.get("/verification")
def my_verification(user: UserRow = Depends(require_landlord), db: Session = Depends(get_db)):
    return to_status(get_row(db, user.id))


@router.post("/verification", dependencies=[Depends(verify_csrf)])
async def submit_verification(
    ownerName: str = Form(...),
    buildingAddress: str = Form(...),
    consent: str = Form(...),
    proof: UploadFile = File(...),
    user: UserRow = Depends(require_landlord),
    db: Session = Depends(get_db),
):
    # 프론트 VerificationInputSchema 와 같은 규칙
    owner_name, address = ownerName.strip(), buildingAddress.strip()
    if not (2 <= len(owner_name) <= 80) or not (5 <= len(address) <= 200) or consent != "true":
        raise ApiException(422, "INVALID_INPUT", "이름·주소·동의 확인")
    rate_limit(f"verify:{user.id}", limit=5, per_seconds=3600)

    row = get_row(db, user.id)
    if row is not None and row.status not in RESUBMITTABLE:
        code = "ALREADY_VERIFIED" if row.status == "approved" else "VERIFICATION_PENDING"
        raise ApiException(409, code, f"{row.status} 상태에서는 다시 신청할 수 없음")

    data, mime = inspect_proof(await proof.read(MAX_PROOF_BYTES + 1), proof.content_type)
    application_id = uuid.uuid4()
    stored = save_proof(user.id, application_id, data, mime)

    if row is None:
        row = OwnerVerificationRow(user_id=user.id)
        db.add(row)
    previous = row.proof_path
    row.status = "reviewing"
    row.application_id = application_id
    row.owner_name, row.building_address = owner_name, address
    row.proof_path, row.proof_mime, row.proof_size = stored, mime, len(data)
    row.submitted_at, row.reviewed_at, row.reviewed_by = _now(), None, None
    row.message = None
    # AI 는 심사 보조만. 결과와 상관없이 상태는 reviewing 으로 남고 관리자가 결정함
    row.ai_review = run_ai_review(owner_name, address, data, mime)
    db.commit()
    db.refresh(row)
    if previous and previous != stored:
        delete_proof(previous)
    return to_status(row)
