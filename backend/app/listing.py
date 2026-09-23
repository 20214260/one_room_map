"""집주인 매물 등록 형식. 프론트 src/contracts/schemas.ts RoomSubmissionSchema, landlord.ts 와 같은 규칙.

DB rooms 행 ↔ RoomSubmission(집주인 본인용) ↔ Room(공개용) 변환도 여기서 함.
"""

import os
import secrets
from datetime import date, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .models import OPTION_IDS, RoomRow

OptionId = Literal["aircon", "washer", "fridge", "induction", "desk", "closet", "elevator"]
Status = Literal["pending_review", "published", "hidden", "closed"]

# 정확한 주소 대신 쓰는 대략적 위치 (프론트 domain/rooms.ts zoneAnchors 와 동일)
ZONE_ANCHORS = {
    "front-gate": (34.9716, 127.4801),
    "back-gate": (34.9702, 127.4849),
    "other": None,
}

# 해커톤 시연용: 검수 담당자가 없으니 등록 즉시 공개. 운영에서는 .env 에 AUTO_PUBLISH=false
AUTO_PUBLISH = os.getenv("AUTO_PUBLISH", "true").lower() == "true"


class LocationHint(BaseModel):
    zone: Literal["front-gate", "back-gate", "other"]
    detail: str = Field(min_length=1, max_length=60)

    @field_validator("detail", mode="before")
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v


class Contact(BaseModel):
    method: Literal["phone", "kakao"]
    value: str = Field(min_length=1, max_length=100)

    @field_validator("value", mode="before")
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v


class Coordinates(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class Photo(BaseModel):
    url: str = Field(max_length=2000)
    alt: str = Field(max_length=200)

    @field_validator("url")
    @classmethod
    def public_url_only(cls, v: str) -> str:
        # 계약: 자체 공개 경로(/uploads/...) 또는 HTTPS. base64(data:)는 mock 전용이라 DB 에 안 받음
        if not (v.startswith("/") and not v.startswith("//")) and not v.startswith("https://"):
            raise ValueError("사진 URL 형식")
        return v


class RoomSubmission(BaseModel):
    # 1단 - 필수
    title: str = Field(min_length=1, max_length=60)
    locationHint: LocationHint
    coordinates: Coordinates | None = None
    rent: int = Field(ge=0)
    contact: Contact
    # 2단 - 선택
    deposit: int | None = Field(default=None, ge=0)
    maintenance: int | None = Field(default=None, ge=0)
    area: float | None = Field(default=None, gt=0)
    floor: int | None = None
    options: dict[OptionId, bool] | None = None
    description: str | None = Field(default=None, max_length=1000)
    photos: list[Photo] | None = Field(default=None, max_length=10)
    # 자동채움 보조용. 저장하지 않음
    pastedListingText: str | None = Field(default=None, max_length=2000)

    @field_validator("title", mode="before")
    @classmethod
    def strip_title(cls, v):
        return v.strip() if isinstance(v, str) else v


def new_room_id() -> str:
    return f"owner-{secrets.token_hex(6)}"


def owner_source() -> dict:
    return {
        "name": "집주인·부동산 직접 등록",
        "url": None,
        "collectedAt": date.today().isoformat(),
        "license": "등록자 제공",
        "kind": "owner",
        "note": "등록자가 직접 입력한 정보이며 아직 좌표·도보거리는 검증 전이에요.",
    }


def apply_submission(row: RoomRow, s: RoomSubmission) -> None:
    """등록/수정 입력을 DB 행에 반영 (pastedListingText 는 버림)."""
    row.title = s.title
    row.zone = s.locationHint.zone
    row.location_detail = s.locationHint.detail
    row.neighborhood = s.locationHint.detail
    # 좌표를 아예 안 보낸 예전 요청만 zone 앵커로. 명시적인 null 은 null 그대로 보존
    if "coordinates" in s.model_fields_set:
        coords = (s.coordinates.lat, s.coordinates.lng) if s.coordinates else None
    else:
        coords = ZONE_ANCHORS[s.locationHint.zone]
    row.lat, row.lng = coords if coords else (None, None)
    row.rent = s.rent
    row.contact = s.contact.model_dump()
    row.deposit = s.deposit
    row.maintenance = s.maintenance
    row.area = s.area
    row.floor = s.floor
    row.options = dict(s.options or {})  # 입력한 것만 저장. 공개 응답에선 나머지를 null 로 채움
    row.description = s.description or ""
    row.photos = [p.model_dump() for p in (s.photos or [])]


def to_owner_listing(r: RoomRow) -> dict:
    """집주인 본인 전용 응답 (OwnerListingSchema). 연락처 포함 → 공개 API 에 쓰지 말 것."""
    submission = {
        "title": r.title,
        "locationHint": {"zone": r.zone or "other", "detail": r.location_detail or r.neighborhood or ""},
        "coordinates": {"lat": r.lat, "lng": r.lng} if r.lat is not None and r.lng is not None else None,
        "rent": r.rent,
        "contact": r.contact or {"method": "phone", "value": "-"},
        "deposit": r.deposit,
        "maintenance": r.maintenance,
        "area": float(r.area) if r.area is not None else None,
        "floor": r.floor,
        "options": {k: v for k, v in (r.options or {}).items() if k in OPTION_IDS and isinstance(v, bool)},
        "description": r.description or "",
        "photos": r.photos or [],
    }
    updated = r.updated_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return {"id": r.id, "ownerId": str(r.owner_id), "submission": submission,
            "status": r.status, "updatedAt": updated}
