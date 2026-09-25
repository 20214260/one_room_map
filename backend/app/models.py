from datetime import datetime

import uuid

from sqlalchemy import BigInteger, Boolean, DateTime, FetchedValue, Float, Integer, Numeric, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base

OPTION_IDS = ("aircon", "washer", "fridge", "induction", "desk", "closet", "elevator")
PUBLIC_STATUS = "published"


class RoomRow(Base):
    """Supabase public.rooms 테이블 (sql/001 → 003 적용 후 구조)."""

    __tablename__ = "rooms"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    neighborhood: Mapped[str | None] = mapped_column(Text)
    deposit: Mapped[int | None] = mapped_column(Integer)
    rent: Mapped[int | None] = mapped_column(Integer)
    maintenance: Mapped[int | None] = mapped_column(Integer)
    area: Mapped[float | None] = mapped_column(Numeric)
    floor: Mapped[int | None] = mapped_column(Integer)
    school_distance: Mapped[int | None] = mapped_column(Integer)
    near_commercial: Mapped[bool | None] = mapped_column(Boolean)
    description: Mapped[str | None] = mapped_column(Text)
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    photos: Mapped[list] = mapped_column(JSONB)
    options: Mapped[dict] = mapped_column(JSONB)
    facilities: Mapped[list] = mapped_column(JSONB)
    source: Mapped[dict | None] = mapped_column(JSONB)
    distance_source: Mapped[dict | None] = mapped_column(JSONB)
    # 003: 집주인 등록 매물
    owner_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    status: Mapped[str] = mapped_column(Text, default="published")  # pending_review|published|hidden|closed
    contact: Mapped[dict | None] = mapped_column(JSONB)  # 비공개. to_room 에 절대 넣지 않음
    zone: Mapped[str | None] = mapped_column(Text)
    location_detail: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


def to_room(r: RoomRow) -> dict:
    """DB 행 → 공개용 RoomSchema(src/contracts/schemas.ts).

    owner_id / contact / zone 같은 비공개 필드는 여기서 내보내지 않음.
    """
    return {
        "id": r.id,
        "title": r.title,
        "neighborhood": r.neighborhood or "",
        "description": r.description or "",
        "coordinates": (
            {"lat": r.lat, "lng": r.lng} if r.lat is not None and r.lng is not None else None
        ),
        "deposit": r.deposit,
        "rent": r.rent,
        "maintenance": r.maintenance,
        "area": float(r.area) if r.area is not None else None,
        "floor": r.floor,
        # 표준 옵션 키를 모두 보냄. 모르는 값은 null (false 와 구별)
        "options": {k: (r.options or {}).get(k) for k in OPTION_IDS},
        "nearCommercial": r.near_commercial,
        "photos": r.photos or [],
        "schoolDistance": r.school_distance,
        "facilities": r.facilities or [],
        "distanceSource": r.distance_source,
        "source": r.source,
        "published": r.status == PUBLIC_STATUS,
    }


class UserRow(Base):
    """public.users (sql/003). 로그인은 FastAPI가 직접 관리."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(Text)
    password_hash: Mapped[str | None] = mapped_column(Text)  # 소셜 전용 계정은 null
    name: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text, default="seeker")  # seeker | landlord
    provider: Mapped[str] = mapped_column(Text, default="email")  # email | kakao | google
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SessionRow(Base):
    """public.sessions (sql/003). 토큰 원문은 쿠키에만, DB에는 SHA-256 해시."""

    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


def to_user(u: UserRow) -> dict:
    """DB 행 → 프론트 UserSchema. 비밀번호 해시는 절대 내보내지 않음."""
    return {"id": str(u.id), "name": u.name, "email": u.email, "provider": u.provider, "role": u.role}


class InquiryRow(Base):
    """public.inquiries (sql/003). 학생 연락처(replyContact)는 저장하지 않음."""

    __tablename__ = "inquiries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    room_id: Mapped[str] = mapped_column(Text)
    sender_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    message: Mapped[str] = mapped_column(Text)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ChatRow(Base):
    """public.chats (sql/004)."""

    __tablename__ = "chats"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    room_id: Mapped[str | None] = mapped_column(Text)
    room_snapshot: Mapped[dict] = mapped_column(JSONB)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    seeker_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    owner_read_seq: Mapped[int] = mapped_column(BigInteger, default=0)
    seeker_read_seq: Mapped[int] = mapped_column(BigInteger, default=0)
    blocked_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ChatMessageRow(Base):
    """public.chat_messages (sql/004)."""

    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    seq: Mapped[int] = mapped_column(BigInteger, server_default=FetchedValue())  # DB bigserial
    chat_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    sender_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    kind: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    visit_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    proposal_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    decision: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ChatReportRow(Base):
    """public.chat_reports (sql/004)."""

    __tablename__ = "chat_reports"

    chat_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    reporter_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    reason: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
