"""집주인 인증: 증빙 검사, 비공개 보관, 상태 변환, 승인 검사, AI 심사 보조.

계약: docs/OWNER_VERIFICATION_HANDOFF.md, src/contracts/verification.ts

- 승인(approved)은 관리자만 설정함 (routers/admin.py). AI 결과는 심사 참고용이며 자동 승인에 쓰지 않음
- 증빙은 공개 사진 버킷(PHOTO_BUCKET)과 분리된 비공개 저장소에 둠
  - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 가 있으면 비공개 버킷 PROOF_BUCKET (기본 owner-proofs)
  - 없으면 서버 로컬 폴더 PROOF_DIR (기본 backend/.private/proofs, git 제외, 웹으로 직접 제공하지 않음)
"""

import io
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import httpx
from fastapi import Depends
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .db import get_db
from .errors import ApiException
from .models import OwnerVerificationRow, UserRow
from .routers.auth import require_landlord, require_user
from .storage import _auth_headers  # storage 를 import 하면 Image.MAX_IMAGE_PIXELS(압축 폭탄 방지)도 적용됨

MAX_PROOF_BYTES = 5 * 1024 * 1024  # 프론트 MAX_PROOF_BYTES 와 같은 한도
PDF_MIME, JPEG_MIME, PNG_MIME = "application/pdf", "image/jpeg", "image/png"
EXT = {PDF_MIME: "pdf", JPEG_MIME: "jpg", PNG_MIME: "png"}

# 신청자가 새로 신청할 수 있는 상태. 심사 중·승인은 재신청 불가
RESUBMITTABLE = {"not_submitted", "needs_info", "rejected"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None) -> str | None:
    """프론트 z.string().datetime() 은 Z 표기만 받음."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


# ── 상태 ──────────────────────────────────────────────────
def get_row(db: Session, user_id: uuid.UUID) -> OwnerVerificationRow | None:
    return db.get(OwnerVerificationRow, user_id)


def ensure_row(db: Session, user: UserRow) -> None:
    """집주인 가입 직후 not_submitted 행을 만듦 (이메일·소셜 가입 공통). commit 은 호출한 쪽에서."""
    if user.role == "landlord" and get_row(db, user.id) is None:
        db.add(OwnerVerificationRow(user_id=user.id, status="not_submitted"))


def to_status(row: OwnerVerificationRow | None) -> dict:
    """DB 행 → VerificationStatus. 이름·주소·서류·AI 결과는 신청자 응답에도 넣지 않음."""
    if row is None:
        return {"status": "not_submitted", "applicationId": None, "submittedAt": None, "message": None}
    return {
        "status": row.status,
        "applicationId": str(row.application_id) if row.application_id else None,
        "submittedAt": iso(row.submitted_at),
        "message": row.message[:300] if row.message else None,
    }


def require_verified_landlord(
    user: UserRow = Depends(require_landlord), db: Session = Depends(get_db)
) -> UserRow:
    """매물 등록·사진·수정·삭제·상태 변경 전용. 역할뿐 아니라 서버에 저장된 승인 상태를 확인."""
    row = get_row(db, user.id)
    if row is None or row.status != "approved":
        raise ApiException(403, "VERIFICATION_REQUIRED", "집주인 인증 승인 필요")
    return user


# ── 관리자 ────────────────────────────────────────────────
def admin_emails() -> set[str]:
    raw = os.getenv("ADMIN_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def require_admin(user: UserRow = Depends(require_user)) -> UserRow:
    """ADMIN_EMAILS 에 있는 이메일로 로그인한 사용자만. 비어 있으면 아무도 관리자가 아님."""
    if user.email.lower() not in admin_emails():
        raise ApiException(403, "FORBIDDEN", "관리자 전용")
    return user


# ── 증빙 파일 검사 ─────────────────────────────────────────
# PDF 안의 실행·외부 호출 기능. 등기사항증명서에는 필요 없으므로 발견하면 거절
_PDF_ACTIVE = re.compile(rb"/(JavaScript|JS|Launch|EmbeddedFile|EmbeddedFiles|RichMedia|SubmitForm|ImportData|GoToR|GoToE)(?![A-Za-z])")
_PDF_HEX_NAME = re.compile(rb"/[A-Za-z]*#[0-9A-Fa-f]{2}")  # /J#61vaScript 같은 이름 숨기기


def inspect_proof(data: bytes, declared_mime: str | None) -> tuple[bytes, str]:
    """실제 내용으로 형식을 판별하고 검사. (저장할 바이트, MIME) 반환.

    - 확장자·브라우저가 보낸 Content-Type 을 믿지 않고 파일 앞부분(매직 바이트)으로 판별
    - 이미지: Pillow 로 실제 디코딩 후 같은 형식으로 다시 인코딩 (EXIF 등 메타데이터·덧붙은 데이터 제거)
    - PDF: 구조 확인, 암호화 PDF 와 JavaScript·실행·첨부 파일 등 능동 콘텐츠 거절
      압축된 객체 스트림 내부까지는 보지 않으므로 관리자는 내려받은 파일을 뷰어의 보호 모드로 열 것
    """
    if not data:
        raise ApiException(422, "PROOF_EMPTY", "빈 파일")
    if len(data) > MAX_PROOF_BYTES:
        raise ApiException(413, "PROOF_TOO_LARGE", "5MB 초과")
    if data.startswith(b"%PDF-"):
        mime = PDF_MIME
    elif data.startswith(b"\xff\xd8\xff"):
        mime = JPEG_MIME
    elif data.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = PNG_MIME
    else:
        raise ApiException(415, "PROOF_TYPE", "PDF/JPG/PNG 만")
    if declared_mime and declared_mime != mime:
        raise ApiException(415, "PROOF_TYPE", "파일 형식과 내용 불일치")

    if mime == PDF_MIME:
        if b"%%EOF" not in data[-2048:]:
            raise ApiException(422, "PROOF_INVALID", "손상된 PDF")
        if b"/Encrypt" in data:
            raise ApiException(422, "PROOF_INVALID", "암호화된 PDF")
        if _PDF_ACTIVE.search(data) or _PDF_HEX_NAME.search(data):
            raise ApiException(422, "PROOF_INVALID", "허용하지 않는 PDF 기능 포함")
        return data, mime

    try:
        img = Image.open(io.BytesIO(data))
        if img.format not in ("JPEG", "PNG"):
            raise ApiException(415, "PROOF_TYPE", "PDF/JPG/PNG 만")
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ApiException(422, "PROOF_INVALID", "이미지가 아님")
    out = io.BytesIO()
    if mime == JPEG_MIME:
        img.convert("RGB").save(out, "JPEG", quality=92)
    else:
        if img.mode not in ("RGB", "RGBA", "L", "LA"):
            img = img.convert("RGBA")
        img.save(out, "PNG", optimize=True)
    clean = out.getvalue()
    if len(clean) > MAX_PROOF_BYTES:
        raise ApiException(413, "PROOF_TOO_LARGE", "5MB 초과")
    return clean, mime


# ── 비공개 저장소 ──────────────────────────────────────────
def _supabase() -> tuple[str, str, str] | None:
    base = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    bucket = os.getenv("PROOF_BUCKET", "owner-proofs")
    return (base, key, bucket) if base and key else None


def _local_dir() -> Path:
    default = Path(__file__).resolve().parent.parent / ".private" / "proofs"
    return Path(os.getenv("PROOF_DIR", str(default)))


def save_proof(user_id: uuid.UUID, application_id: uuid.UUID, data: bytes, mime: str) -> str:
    """저장 경로 반환. 경로는 서버가 만든 ID 로만 구성 (사용자 파일명 사용 안 함)."""
    path = f"{user_id}/{application_id}.{EXT[mime]}"
    sb = _supabase()
    if sb is None:
        target = _local_dir() / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return f"local:{path}"
    base, key, bucket = sb
    try:
        info = httpx.get(f"{base}/storage/v1/bucket/{bucket}", headers=_auth_headers(key), timeout=10)
        # 공개 버킷이면 누구나 URL 로 서류를 볼 수 있으므로 저장하지 않음
        if info.status_code != 200 or info.json().get("public") is not False:
            raise ApiException(503, "PROOF_STORAGE", "비공개 증빙 버킷 없음 또는 공개 설정")
        res = httpx.post(
            f"{base}/storage/v1/object/{bucket}/{path}",
            content=data,
            headers=_auth_headers(key) | {"Content-Type": mime, "x-upsert": "true"},
            timeout=20,
        )
    except httpx.HTTPError:
        raise ApiException(502, "PROOF_UPLOAD", "저장소 연결 실패")
    if res.status_code >= 300:
        raise ApiException(502, "PROOF_UPLOAD", f"저장소 오류 {res.status_code}")
    return f"supabase:{bucket}/{path}"


def load_proof(stored: str) -> bytes:
    kind, _, path = stored.partition(":")
    if kind == "local":
        root = _local_dir().resolve()
        target = (root / path).resolve()
        if root not in target.parents or not target.is_file():
            raise ApiException(404, "NOT_FOUND", "증빙 없음")
        return target.read_bytes()
    sb = _supabase()
    if kind != "supabase" or sb is None:
        raise ApiException(503, "PROOF_STORAGE", "증빙 저장소 설정 없음")
    base, key, _ = sb
    try:
        res = httpx.get(f"{base}/storage/v1/object/authenticated/{path}", headers=_auth_headers(key), timeout=20)
    except httpx.HTTPError:
        raise ApiException(502, "PROOF_UPLOAD", "저장소 연결 실패")
    if res.status_code != 200:
        raise ApiException(404, "NOT_FOUND", "증빙 없음")
    return res.content


def delete_proof(stored: str | None) -> None:
    """재신청으로 대체된 이전 증빙 정리 (실패해도 신청은 계속)."""
    if not stored:
        return
    kind, _, path = stored.partition(":")
    try:
        if kind == "local":
            root = _local_dir().resolve()
            target = (root / path).resolve()
            if root in target.parents:
                target.unlink(missing_ok=True)
        elif kind == "supabase" and (sb := _supabase()):
            base, key, _ = sb
            bucket, _, obj = path.partition("/")
            httpx.request("DELETE", f"{base}/storage/v1/object/{bucket}", headers=_auth_headers(key),
                          json={"prefixes": [obj]}, timeout=10)
    except (OSError, httpx.HTTPError):
        pass


# ── AI 심사 보조 (입출력 형식은 AI 담당과 확정 필요: docs/OWNER_VERIFICATION_HANDOFF.md) ──
CheckField = Literal["ownerName", "buildingAddress", "documentType", "issuedAt"]


class AiCheck(BaseModel):
    field: CheckField
    result: Literal["match", "mismatch", "unclear"]
    note: str = Field(default="", max_length=300)


class AiExtracted(BaseModel):
    documentType: Literal["registry", "other", "unknown"]
    ownerNames: list[str] = Field(default_factory=list, max_length=10)
    buildingAddress: str | None = Field(default=None, max_length=200)
    issuedAt: str | None = None  # YYYY-MM-DD


class AiReview(BaseModel):
    """AI 출력. 의도적으로 approve/score 같은 '결정' 필드를 두지 않음."""

    model: str = Field(max_length=100)
    extracted: AiExtracted
    checks: list[AiCheck] = Field(max_length=10)
    summary: str = Field(max_length=500)


def run_ai_review(owner_name: str, building_address: str, proof: bytes, mime: str) -> dict | None:
    """AI 에 넘기고 형식 검사까지 한 결과. 연결 전이거나 실패하면 None → 관리자가 직접 심사.

    AI 연결 시 여기서 analyze(...) 를 호출하고 AiReview.model_validate 로 검사할 것.
    주민등록번호 등은 AI 에 넘기기 전에 마스킹 (계약 문서 참고).
    """
    analyze = None  # TODO(AI 담당): 입출력 형식 확정 후 연결
    if analyze is None:
        return None
    try:
        return AiReview.model_validate(analyze(owner_name, building_address, proof, mime)).model_dump()
    except Exception:  # AI 오류·형식 불일치가 신청을 막지 않게
        return None
