"""카카오·구글 소셜 로그인 (서버가 인가 코드 흐름을 전부 처리).

계약(docs/API_CONTRACT.md 인증 연결):
버튼 → BE /start → 카카오/Google → BE 콜백에서 state·PKCE·code 검증 후 세션 발급 → FE /auth/callback

이 파일은 DB를 모름. 주소 만들기, state 쿠키, 코드 교환, 프로필 정규화만 담당함.
사용자 생성·연결은 routers/oauth.py.
"""

import base64
import hashlib
import json
import os
import secrets
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

PROVIDERS = ("kakao", "google")
FLOW_COOKIE = "sunroom_oauth"
FLOW_SECONDS = 600  # 로그인 창을 열어 두고 있을 수 있는 시간


class OAuthError(Exception):
    """제공자 통신 실패·검증 실패. 사용자에게는 원문을 보여주지 않음."""


@dataclass(frozen=True)
class ProviderConfig:
    name: str
    client_id: str
    client_secret: str
    authorize_url: str
    token_url: str
    userinfo_url: str
    scope: str | None
    pkce: bool


@dataclass(frozen=True)
class Profile:
    provider_user_id: str
    email: str | None  # 제공자가 검증했다고 알려준 이메일만. 없으면 None
    name: str


def frontend_url() -> str:
    return os.getenv("FRONTEND_URL", "http://127.0.0.1:5173").rstrip("/")


def redirect_uri(provider: str) -> str:
    """카카오/구글 콘솔에 등록한 Redirect URI 와 글자 하나까지 같아야 함."""
    base = os.getenv("OAUTH_REDIRECT_BASE", "http://127.0.0.1:8000").rstrip("/")
    return f"{base}/api/v1/auth/oauth/{provider}/callback"


def get_config(provider: str) -> ProviderConfig | None:
    """키가 설정된 제공자만 반환. 환경변수는 호출 시점에 읽음."""
    if provider == "kakao":
        client_id = os.getenv("KAKAO_CLIENT_ID", "")
        if not client_id:
            return None
        return ProviderConfig(
            name="kakao",
            client_id=client_id,
            client_secret=os.getenv("KAKAO_CLIENT_SECRET", ""),  # 콘솔에서 Client Secret 을 켰을 때만
            authorize_url="https://kauth.kakao.com/oauth/authorize",
            token_url="https://kauth.kakao.com/oauth/token",
            userinfo_url="https://kapi.kakao.com/v2/user/me",
            # scope 를 보내지 않으면 콘솔의 '동의항목' 설정을 따름. 이메일 권한이 없는 앱이 scope 로
            # account_email 을 요청하면 로그인 자체가 KOE205 로 막히기 때문
            scope=None,
            pkce=False,
        )
    if provider == "google":
        client_id = os.getenv("GOOGLE_CLIENT_ID", "")
        client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "")
        if not client_id or not client_secret:
            return None
        return ProviderConfig(
            name="google",
            client_id=client_id,
            client_secret=client_secret,
            authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
            token_url="https://oauth2.googleapis.com/token",
            userinfo_url="https://openidconnect.googleapis.com/v1/userinfo",
            scope="openid email profile",
            pkce=True,
        )
    return None


# ── /start: 인가 주소 + state 쿠키 ──────────────────────────
def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def begin(cfg: ProviderConfig, return_to: str, role: str) -> tuple[str, str]:
    """(인가 URL, 흐름 쿠키 값). state·PKCE verifier 는 서버 쿠키에만 두고 브라우저 JS는 못 읽음."""
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64) if cfg.pkce else ""
    query = {
        "client_id": cfg.client_id,
        "redirect_uri": redirect_uri(cfg.name),
        "response_type": "code",
        "state": state,
    }
    if cfg.scope:
        query["scope"] = cfg.scope
    if cfg.pkce:
        query["code_challenge"] = _b64(hashlib.sha256(verifier.encode()).digest())
        query["code_challenge_method"] = "S256"
    if cfg.name == "google":
        query["prompt"] = "select_account"
    flow = {"p": cfg.name, "s": state, "v": verifier, "r": return_to, "role": role}
    cookie = _b64(json.dumps(flow, separators=(",", ":")).encode())
    return f"{cfg.authorize_url}?{urlencode(query)}", cookie


def read_flow(cookie: str | None) -> dict | None:
    if not cookie:
        return None
    try:
        flow = json.loads(base64.urlsafe_b64decode(cookie + "=" * (-len(cookie) % 4)))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(flow, dict) or not all(isinstance(flow.get(k), str) for k in ("p", "s", "v", "r", "role")):
        return None
    return flow


# ── /callback: 코드 교환 + 프로필 ───────────────────────────
def _http() -> httpx.Client:
    return httpx.Client(timeout=10.0, follow_redirects=False)


def exchange_code(cfg: ProviderConfig, code: str, verifier: str) -> str:
    data = {
        "grant_type": "authorization_code",
        "client_id": cfg.client_id,
        "redirect_uri": redirect_uri(cfg.name),
        "code": code,
    }
    if cfg.client_secret:
        data["client_secret"] = cfg.client_secret
    if cfg.pkce:
        data["code_verifier"] = verifier
    try:
        with _http() as http:
            res = http.post(cfg.token_url, data=data, headers={"Accept": "application/json"})
        token = res.json().get("access_token") if res.status_code == 200 else None
    except (httpx.HTTPError, ValueError, AttributeError) as e:
        raise OAuthError("token request failed") from e
    if not isinstance(token, str) or not token:
        raise OAuthError("no access token")
    return token


def fetch_profile(cfg: ProviderConfig, access_token: str) -> Profile:
    try:
        with _http() as http:
            res = http.get(cfg.userinfo_url, headers={"Authorization": f"Bearer {access_token}"})
        if res.status_code != 200:
            raise OAuthError("profile request failed")
        data = res.json()
    except (httpx.HTTPError, ValueError) as e:
        raise OAuthError("profile request failed") from e
    if not isinstance(data, dict):
        raise OAuthError("bad profile")
    return _kakao_profile(data) if cfg.name == "kakao" else _google_profile(data)


def _kakao_profile(data: dict) -> Profile:
    uid = data.get("id")
    if not isinstance(uid, (int, str)) or isinstance(uid, bool) or not str(uid):
        raise OAuthError("no kakao id")
    account = data.get("kakao_account") if isinstance(data.get("kakao_account"), dict) else {}
    profile = account.get("profile") if isinstance(account.get("profile"), dict) else {}
    props = data.get("properties") if isinstance(data.get("properties"), dict) else {}
    email = account.get("email")
    # 카카오가 유효·인증됐다고 한 이메일만 신뢰 (아니면 None → 가상 이메일로 가입)
    trusted = account.get("is_email_valid") is True and account.get("is_email_verified") is True
    return Profile(
        provider_user_id=str(uid),
        email=email.strip().lower() if trusted and isinstance(email, str) and email.strip() else None,
        name=str(profile.get("nickname") or props.get("nickname") or "").strip(),
    )


def _google_profile(data: dict) -> Profile:
    sub = data.get("sub")
    if not isinstance(sub, str) or not sub:
        raise OAuthError("no google sub")
    email = data.get("email")
    trusted = data.get("email_verified") is True
    return Profile(
        provider_user_id=sub,
        email=email.strip().lower() if trusted and isinstance(email, str) and email.strip() else None,
        name=str(data.get("name") or "").strip(),
    )
