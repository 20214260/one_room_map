"""이메일 로그인 API. 계약: docs/API_CONTRACT.md 인증 연결, src/contracts/schemas.ts UserSchema/RegisterSchema.

| Method | 경로            | 응답                          |
| GET    | /auth/csrf     | {token} + CSRF 쿠키           |
| GET    | /auth/me       | User, 비회원 401              |
| POST   | /auth/register | User + 세션 쿠키 (중복 409)    |
| POST   | /auth/login    | User + 세션 쿠키 (실패 401)    |
| POST   | /auth/logout   | 204, 쿠키 만료                |

OAuth(/auth/oauth/{provider}/start)는 다음 단계에서 추가.
"""

import re
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import ApiException
from ..models import SessionRow, UserRow, to_user
from ..security import (
    COOKIE_SECURE,
    CSRF_COOKIE,
    SESSION_COOKIE,
    SESSION_DAYS,
    burn_time,
    client_ip,
    hash_password,
    new_token,
    rate_limit,
    token_hash,
    verify_csrf,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ── 요청 형식 (프론트 RegisterSchema 와 같은 규칙) ─────────────
class RegisterBody(BaseModel):
    email: str
    password: str
    role: Literal["seeker", "landlord"] = "seeker"
    agreed: Literal[True]
    termsVersion: str | None = None

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str) -> str:
        v = v.strip().lower()
        if len(v) > 254 or not EMAIL_RE.match(v):
            raise ValueError("이메일 형식")
        return v

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        if not (8 <= len(v) <= 72) or not re.search(r"[A-Za-z]", v) or not re.search(r"[0-9]", v):
            raise ValueError("영문+숫자 8~72자")
        return v


class LoginBody(BaseModel):
    email: str
    password: str


# ── 세션 헬퍼 ───────────────────────────────────────────────
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _start_session(db: Session, response: Response, user: UserRow) -> None:
    token = new_token()
    db.add(SessionRow(token_hash=token_hash(token), user_id=user.id,
                      expires_at=_now() + timedelta(days=SESSION_DAYS)))
    response.set_cookie(
        SESSION_COOKIE, token, max_age=SESSION_DAYS * 86400,
        httponly=True, secure=COOKIE_SECURE, samesite="lax", path="/",
    )


def current_user(request: Request, db: Session = Depends(get_db)) -> UserRow | None:
    """세션 쿠키로 로그인한 사용자. 없거나 만료면 None. 다른 라우터에서도 Depends 로 사용."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    row = db.get(SessionRow, token_hash(token))
    if row is None or row.expires_at <= _now():
        return None
    # 하루에 한 번만 만료 시각을 밀어서 "최근 활동 기준 7일" 유지 (매 요청 쓰기 방지)
    if _now() - row.last_seen_at > timedelta(days=1):
        row.last_seen_at = _now()
        row.expires_at = _now() + timedelta(days=SESSION_DAYS)
        db.commit()
    return db.get(UserRow, row.user_id)


def require_user(user: UserRow | None = Depends(current_user)) -> UserRow:
    if user is None:
        raise ApiException(401, "UNAUTHORIZED", "로그인 필요")
    return user


def require_landlord(user: UserRow = Depends(require_user)) -> UserRow:
    if user.role != "landlord":
        raise ApiException(403, "FORBIDDEN", "집주인 전용")
    return user


# ── 라우트 ─────────────────────────────────────────────────
@router.get("/csrf")
def csrf(request: Request, response: Response):
    # 이미 있으면 재사용 → 탭 여러 개에서 동시에 요청해도 토큰이 엇갈리지 않음
    token = request.cookies.get(CSRF_COOKIE) or new_token()
    response.set_cookie(
        CSRF_COOKIE, token, max_age=SESSION_DAYS * 86400,
        httponly=True, secure=COOKIE_SECURE, samesite="lax", path="/",
    )
    return {"token": token}


@router.get("/me")
def me(user: UserRow = Depends(require_user)):
    return to_user(user)


@router.post("/register", dependencies=[Depends(verify_csrf)])
def register(body: RegisterBody, request: Request, response: Response, db: Session = Depends(get_db)):
    rate_limit(f"register:{client_ip(request)}", limit=10, per_seconds=600)
    exists = db.scalar(select(UserRow.id).where(func.lower(UserRow.email) == body.email))
    if exists:
        raise ApiException(409, "EMAIL_EXISTS", "이미 가입된 이메일")
    user = UserRow(
        email=body.email,
        password_hash=hash_password(body.password),
        name=body.email.split("@")[0][:30],
        role=body.role,
        provider="email",
    )
    db.add(user)
    db.flush()
    _start_session(db, response, user)
    db.commit()
    return to_user(user)


@router.post("/login", dependencies=[Depends(verify_csrf)])
def login(body: LoginBody, request: Request, response: Response, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    rate_limit(f"login:{client_ip(request)}:{email}", limit=10, per_seconds=300)
    user = db.scalar(select(UserRow).where(func.lower(UserRow.email) == email))
    if user is None:
        burn_time(body.password)
        raise ApiException(401, "INVALID_CREDENTIALS", "로그인 실패")
    if not verify_password(body.password, user.password_hash):
        raise ApiException(401, "INVALID_CREDENTIALS", "로그인 실패")
    _start_session(db, response, user)
    db.commit()
    return to_user(user)


@router.post("/logout", status_code=204, dependencies=[Depends(verify_csrf)])
def logout(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        db.execute(delete(SessionRow).where(SessionRow.token_hash == token_hash(token)))
        db.commit()
    res = Response(status_code=204)
    res.delete_cookie(SESSION_COOKIE, path="/", secure=COOKIE_SECURE, httponly=True, samesite="lax")
    return res
