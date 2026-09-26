"""카카오·구글 로그인 API. 흐름과 계약은 app/oauth.py 참고.

| Method | 경로                             | 응답                                        |
| POST   | /auth/oauth/{provider}/start    | {authorizationUrl} + 흐름 쿠키              |
| GET    | /auth/oauth/{provider}/callback | 302 → FE /auth/callback (세션 쿠키 발급)     |

정책 (계약 '같은 이메일의 다른 제공자 계정은 자동 병합하지 않음'):
- 이미 연결된 소셜 계정 → 그 사용자로 로그인
- 처음 보는 소셜 계정인데 같은 이메일의 기존 사용자가 있음 → 병합하지 않고 error=account_link_required
- 이메일을 못 받은 경우(카카오 이메일 미동의 등) → 가상 이메일로 가입. 외부 서비스에 이메일을 넘기지 않음
"""

import hmac
from typing import Literal
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import oauth
from ..db import get_db
from ..errors import ApiException
from ..models import OAuthAccountRow, OwnerVerificationRow, UserRow
from ..security import COOKIE_SECURE, client_ip, rate_limit, verify_csrf
from .auth import _start_session

router = APIRouter(prefix="/auth/oauth", tags=["auth"])

FLOW_PATH = "/api/v1/auth/oauth"


class StartBody(BaseModel):
    returnTo: str = "/"
    # 계약의 요청은 returnTo 뿐. role 은 처음 가입할 때만 쓰는 선택값 (기본 seeker)
    role: Literal["seeker", "landlord"] = "seeker"


def safe_return_path(raw: str | None) -> str:
    """프론트 safeReturnPath 와 같은 규칙. 외부 주소로 되돌려 보내는 오픈 리디렉트 차단."""
    if raw and raw.startswith("/") and not raw.startswith("//") and "\\" not in raw and raw.isprintable():
        return raw
    return "/"


def _clear_flow(res: Response) -> None:
    res.delete_cookie(oauth.FLOW_COOKIE, path=FLOW_PATH, secure=COOKIE_SECURE, httponly=True, samesite="lax")


def _failure(reason: str) -> RedirectResponse:
    # FE AuthCallback 은 error=access_denied 만 '취소'로, 나머지는 공통 실패 문구로 처리함
    res = RedirectResponse(f"{oauth.frontend_url()}/auth/callback?{urlencode({'error': reason})}", status_code=302)
    _clear_flow(res)
    return res


@router.post("/{provider}/start", dependencies=[Depends(verify_csrf)])
def start(provider: str, body: StartBody, request: Request):
    if provider not in oauth.PROVIDERS:
        raise ApiException(404, "NOT_FOUND", "")
    rate_limit(f"oauth-start:{client_ip(request)}", limit=30, per_seconds=600)
    cfg = oauth.get_config(provider)
    if cfg is None:
        raise ApiException(503, "OAUTH_NOT_CONFIGURED", "소셜 로그인 준비 중")
    url, cookie = oauth.begin(cfg, safe_return_path(body.returnTo), body.role)
    res = JSONResponse({"authorizationUrl": url})
    res.set_cookie(
        oauth.FLOW_COOKIE, cookie, max_age=oauth.FLOW_SECONDS,
        httponly=True, secure=COOKIE_SECURE, samesite="lax", path=FLOW_PATH,
    )
    return res


@router.get("/{provider}/callback")
def callback(
    provider: str,
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    if provider not in oauth.PROVIDERS:
        raise ApiException(404, "NOT_FOUND", "")
    rate_limit(f"oauth-callback:{client_ip(request)}", limit=30, per_seconds=600)

    # 1) state 검증: 우리가 /start 에서 이 브라우저에 심은 값과 같아야 함 (로그인 CSRF 방지)
    flow = oauth.read_flow(request.cookies.get(oauth.FLOW_COOKIE))
    if flow is None or flow["p"] != provider or not state or not _same(flow["s"], state):
        return _failure("oauth_failed")
    if error:
        return _failure("access_denied" if error == "access_denied" else "oauth_failed")
    cfg = oauth.get_config(provider)
    if cfg is None or not code:
        return _failure("oauth_failed")

    # 2) 코드 → 토큰 → 프로필 (제공자 오류 원문은 사용자에게 노출하지 않음)
    try:
        profile = oauth.fetch_profile(cfg, oauth.exchange_code(cfg, code, flow["v"]))
    except oauth.OAuthError:
        return _failure("oauth_failed")

    # 3) 사용자 찾기/만들기
    user = _find_linked(db, provider, profile.provider_user_id)
    if user is None:
        email = profile.email or f"{provider}_{profile.provider_user_id}@oauth.sunroom.invalid"
        if db.scalar(select(UserRow.id).where(func.lower(UserRow.email) == email)):
            return _failure("account_link_required")
        role = flow["role"] if flow["role"] in ("seeker", "landlord") else "seeker"
        user = UserRow(
            email=email,
            password_hash=None,
            name=(profile.name or email.split("@")[0])[:30],
            role=role,
            provider=provider,
        )
        try:
            db.add(user)
            db.flush()
            db.add(OAuthAccountRow(provider=provider, provider_user_id=profile.provider_user_id, user_id=user.id))
            if role == "landlord":
                db.add(OwnerVerificationRow(user_id=user.id, status="not_submitted"))
            db.flush()
        except IntegrityError:
            # 같은 계정으로 콜백이 동시에 두 번 들어온 경우: 먼저 끝난 쪽 계정으로 로그인
            db.rollback()
            user = _find_linked(db, provider, profile.provider_user_id)
            if user is None:
                return _failure("oauth_failed")

    # 4) 세션 발급 후 프론트로 복귀. 프론트가 /auth/me 로 로그인 상태를 확인함
    res = RedirectResponse(
        f"{oauth.frontend_url()}/auth/callback?{urlencode({'returnTo': safe_return_path(flow['r'])})}",
        status_code=302,
    )
    _start_session(db, res, user)
    db.commit()
    _clear_flow(res)
    return res


def _find_linked(db: Session, provider: str, provider_user_id: str) -> UserRow | None:
    link = db.get(OAuthAccountRow, (provider, provider_user_id))
    return db.get(UserRow, link.user_id) if link else None


def _same(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())
