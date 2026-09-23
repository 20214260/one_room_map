"""비밀번호 해시, 세션 토큰, CSRF, 요청 빈도 제한.

계약(docs/API_CONTRACT.md 인증 연결):
- 세션은 서버가 HttpOnly 쿠키로 소유. 브라우저 저장소에 토큰을 두지 않음
- 모든 POST/PATCH/DELETE 전에 GET /auth/csrf → X-CSRF-Token 헤더
- 서버는 Origin/CSRF 검증
"""

import hashlib
import hmac
import os
import secrets
import time
from collections import defaultdict, deque

from fastapi import Request

from .errors import ApiException

SESSION_COOKIE = "sunroom_session"
CSRF_COOKIE = "sunroom_csrf"
SESSION_DAYS = 7  # 최근 활동 기준 7일 갱신
# 운영(HTTPS)에서는 COOKIE_SECURE=true. 로컬 http 개발에서는 false 여야 쿠키가 저장됨
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"


# ── 비밀번호 (표준 라이브러리 scrypt) ─────────────────────────
_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        _, n, r, p, salt, digest = stored.split("$")
        got = hashlib.scrypt(
            password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32
        )
        return hmac.compare_digest(got.hex(), digest)
    except ValueError:
        return False


# 존재하지 않는 이메일로 로그인할 때도 같은 시간이 걸리게 해서 가입 여부를 추측하기 어렵게 함
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def burn_time(password: str) -> None:
    verify_password(password, _DUMMY_HASH)


# ── 세션 토큰 ─────────────────────────────────────────────
def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    """DB에는 토큰 원문 대신 해시만 저장 (DB가 새도 세션 탈취 불가)."""
    return hashlib.sha256(token.encode()).hexdigest()


# ── CSRF (이중 제출 쿠키) ──────────────────────────────────
def allowed_origins() -> list[str]:
    raw = os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return [o.strip() for o in raw.split(",") if o.strip()]


def verify_csrf(request: Request) -> None:
    """변경 요청(POST/PATCH/DELETE) 라우트에 Depends 로 붙임."""
    origin = request.headers.get("origin")
    if origin and origin not in allowed_origins():
        raise ApiException(403, "FORBIDDEN", "허용되지 않은 Origin")
    header = request.headers.get("x-csrf-token", "")
    cookie = request.cookies.get(CSRF_COOKIE, "")
    if not header or not cookie or not hmac.compare_digest(header, cookie):
        raise ApiException(403, "CSRF", "CSRF 토큰 불일치")


# ── 요청 빈도 제한 (서버 1대 기준 메모리) ─────────────────────
_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(key: str, limit: int, per_seconds: int) -> None:
    now = time.monotonic()
    q = _hits[key]
    while q and now - q[0] > per_seconds:
        q.popleft()
    if len(q) >= limit:
        raise ApiException(429, "RATE_LIMITED", "요청이 너무 많음")
    q.append(now)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"
