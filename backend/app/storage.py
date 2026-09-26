"""매물 사진 저장 (Supabase Storage).

LANDLORD_HANDOFF: "FE가 재인코딩하더라도 BE는 크기·실제 이미지 디코딩·소유권·메타데이터를 다시 검사"
→ 서버에서 한 번 더 열어보고(가짜 이미지 거절), JPEG 로 다시 저장해서 EXIF(촬영 위치 등)를 지움.

필요한 .env
  SUPABASE_URL=https://<project-ref>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=...   (서버 전용 비밀 키: Secret key sb_secret_... 또는 Legacy service_role.
                                   절대 프론트·깃허브에 넣지 말 것)
  PHOTO_BUCKET=room-photos        (Supabase Storage 에서 Public bucket 으로 만들어 둘 것)
"""

import io
import os
import uuid

import httpx
from PIL import Image, UnidentifiedImageError

from .errors import ApiException

MAX_BYTES = 5 * 1024 * 1024  # 프론트 validatePhoto 와 같은 한도
MAX_SIDE = 1200  # 프론트 preparePhoto 와 같은 긴 변
ALLOWED = {"JPEG", "PNG", "WEBP"}
Image.MAX_IMAGE_PIXELS = 40_000_000  # 압축 폭탄 방지


def normalize_image(data: bytes) -> bytes:
    """실제 이미지인지 확인하고, 긴 변 1200px JPEG 로 다시 인코딩 (메타데이터 제거)."""
    if len(data) > MAX_BYTES:
        raise ApiException(413, "PHOTO_TOO_LARGE", "5MB 초과")
    try:
        img = Image.open(io.BytesIO(data))
        if img.format not in ALLOWED:
            raise ApiException(415, "PHOTO_TYPE", "JPG/PNG/WEBP 만")
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ApiException(422, "PHOTO_INVALID", "이미지가 아님")
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))  # 투명 부분은 흰 배경 (프론트와 동일)
        bg.paste(img, mask=img.split()[-1])
        img = bg
    else:
        img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=82, optimize=True)  # EXIF 를 넘기지 않으므로 메타데이터 제거됨
    return out.getvalue()


def _auth_headers(key: str) -> dict:
    """새 Secret 키(sb_secret_...)는 apikey 헤더로, 예전 service_role 키(JWT, eyJ...)는 Bearer 로도 보냄."""
    headers = {"apikey": key}
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def upload_photo(user_id: str, jpeg: bytes) -> str:
    """Supabase Storage 에 올리고 공개 HTTPS URL 반환."""
    base = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    bucket = os.getenv("PHOTO_BUCKET", "room-photos")
    if not base or not key:
        raise ApiException(503, "PHOTO_STORAGE", "사진 저장소 설정 없음 (.env SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)")
    path = f"{user_id}/{uuid.uuid4().hex}.jpg"
    try:
        res = httpx.post(
            f"{base}/storage/v1/object/{bucket}/{path}",
            content=jpeg,
            headers=_auth_headers(key) | {"Content-Type": "image/jpeg", "x-upsert": "false",
                                          "Cache-Control": "max-age=31536000"},
            timeout=15,
        )
    except httpx.HTTPError:
        raise ApiException(502, "PHOTO_UPLOAD", "저장소 연결 실패")
    if res.status_code >= 300:
        raise ApiException(502, "PHOTO_UPLOAD", f"저장소 오류 {res.status_code}")
    return f"{base}/storage/v1/object/public/{bucket}/{path}"
