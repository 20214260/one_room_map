"""카카오·구글 로그인 테스트. 실제 DB도, 실제 카카오/구글 서버도 필요 없음.

- DB: 메모리 SQLite (users·oauth_accounts·sessions 만 생성). .env 에 진짜 DATABASE_URL 이 있어도 건드리지 않음
- 제공자: httpx MockTransport 로 토큰·프로필 응답을 흉내 냄 (요청 내용도 검증)
프론트 gateway.ts 흐름 그대로: POST 전에 GET /auth/csrf → X-CSRF-Token, 콜백은 브라우저 이동(GET)
"""

import os

# app.db 는 import 시점에 DATABASE_URL 을 요구함. 여기서는 연결하지 않으므로 자리표시자면 충분
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://x:x@localhost:5432/x")

import base64
import hashlib
import json
from datetime import timezone
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.attributes import set_committed_value
from sqlalchemy.pool import StaticPool

from app import oauth
from app.db import Base, get_db
from app.main import app
from app.models import OAuthAccountRow, SessionRow, UserRow
from app.security import _hits

ORIGIN = "http://127.0.0.1:5173"
FRONT = "http://127.0.0.1:5173"


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("KAKAO_CLIENT_ID", "kakao-rest-key")
    monkeypatch.setenv("KAKAO_CLIENT_SECRET", "kakao-secret")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "google-secret")
    monkeypatch.setenv("OAUTH_REDIRECT_BASE", "http://127.0.0.1:8000")
    monkeypatch.setenv("FRONTEND_URL", FRONT)


def _utc_on_load(target, _context):
    """SQLite 는 timestamptz 를 시간대 없이 돌려줌 (Postgres 는 UTC 시간대 포함). 운영과 같게 맞춤."""
    for name in ("expires_at", "last_seen_at", "created_at"):
        value = getattr(target, name, None)
        if value is not None and value.tzinfo is None:
            set_committed_value(target, name, value.replace(tzinfo=timezone.utc))


@pytest.fixture
def db():
    for model in (UserRow, SessionRow, OAuthAccountRow):
        event.listen(model, "load", _utc_on_load)
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=[UserRow.__table__, OAuthAccountRow.__table__, SessionRow.__table__])
    maker = sessionmaker(bind=engine)

    def override():
        s = maker()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = override
    s = maker()
    yield s
    s.close()
    app.dependency_overrides.pop(get_db, None)
    for model in (UserRow, SessionRow, OAuthAccountRow):
        event.remove(model, "load", _utc_on_load)


@pytest.fixture
def client(db, env):
    _hits.clear()
    with TestClient(app, headers={"Origin": ORIGIN}, follow_redirects=False) as c:
        yield c


class Provider:
    """카카오/구글 서버 대역. 받은 요청을 기록하고 준비한 응답을 돌려줌."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.token_status = 200
        self.profiles = {
            "kakao": {
                "id": 123456789,
                "kakao_account": {
                    "profile": {"nickname": "순천학생"},
                    "email": "Kim@Example.com",
                    "is_email_valid": True,
                    "is_email_verified": True,
                },
            },
            "google": {"sub": "g-1", "email": "lee@example.com", "email_verified": True, "name": "이구글"},
        }

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        host = request.url.host
        if request.url.path.endswith("/token"):
            if self.token_status != 200:
                return httpx.Response(self.token_status, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": f"tok-{host}"})
        which = "kakao" if host == "kapi.kakao.com" else "google"
        return httpx.Response(200, json=self.profiles[which])


@pytest.fixture
def provider(monkeypatch):
    p = Provider()
    monkeypatch.setattr(oauth, "_http", lambda: httpx.Client(transport=httpx.MockTransport(p.handler)))
    return p


def csrf(c: TestClient) -> dict:
    return {"X-CSRF-Token": c.get("/api/v1/auth/csrf").json()["token"]}


def start(c: TestClient, name: str, **body):
    return c.post(f"/api/v1/auth/oauth/{name}/start", json={"returnTo": "/compare?ids=a,b", **body}, headers=csrf(c))


def finish(c: TestClient, name: str, auth_url: str, **query):
    """브라우저가 제공자 로그인 후 콜백으로 돌아오는 것을 흉내: state 는 인가 주소에서 그대로 가져옴."""
    state = parse_qs(urlparse(auth_url).query)["state"][0]
    params = {"code": "auth-code", "state": state, **query}
    params = {k: v for k, v in params.items() if v is not None}
    return c.get(f"/api/v1/auth/oauth/{name}/callback", params=params)


# ── /start ────────────────────────────────────────────────
def test_start_returns_kakao_url_that_frontend_allows(client):
    res = start(client, "kakao")
    assert res.status_code == 200
    url = urlparse(res.json()["authorizationUrl"])
    q = parse_qs(url.query)
    assert (url.scheme, url.hostname) == ("https", "kauth.kakao.com")  # gateway.ts 허용 목록과 같음
    assert q["client_id"] == ["kakao-rest-key"]
    assert q["redirect_uri"] == ["http://127.0.0.1:8000/api/v1/auth/oauth/kakao/callback"]
    assert q["response_type"] == ["code"] and len(q["state"][0]) >= 32
    assert "scope" not in q  # 콘솔 동의항목을 따름 (이메일 권한 없는 앱이 막히지 않게)
    assert "client_secret" not in res.text  # 비밀키는 인가 주소에 절대 안 나감


def test_start_google_uses_pkce_and_hides_secret(client):
    res = start(client, "google")
    url = urlparse(res.json()["authorizationUrl"])
    q = parse_qs(url.query)
    assert url.hostname == "accounts.google.com"
    assert q["scope"] == ["openid email profile"]
    assert q["code_challenge_method"] == ["S256"] and q["code_challenge"][0]
    assert "google-secret" not in res.text


def test_flow_cookie_is_httponly_and_scoped(client):
    res = start(client, "kakao")
    cookie = res.headers["set-cookie"].lower()
    assert "sunroom_oauth=" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert "path=/api/v1/auth/oauth" in cookie and "max-age=600" in cookie


def test_start_rejects_missing_csrf_and_bad_origin_and_unknown_provider(client):
    assert client.post("/api/v1/auth/oauth/kakao/start", json={"returnTo": "/"}).status_code == 403
    client.get("/api/v1/auth/csrf")
    evil = client.post(
        "/api/v1/auth/oauth/kakao/start", json={"returnTo": "/"},
        headers={**csrf(client), "Origin": "https://evil.example"},
    )
    assert evil.status_code == 403
    assert start(client, "naver").status_code == 404


def test_start_without_keys_is_503(client, monkeypatch):
    monkeypatch.delenv("KAKAO_CLIENT_ID")
    res = start(client, "kakao")
    assert res.status_code == 503 and res.json()["error"]["code"] == "OAUTH_NOT_CONFIGURED"


def test_google_needs_secret_too(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_SECRET")
    assert start(client, "google").status_code == 503


# ── /callback: 성공 ────────────────────────────────────────
def test_kakao_signup_creates_user_and_session(client, provider, db):
    url = start(client, "kakao").json()["authorizationUrl"]
    res = finish(client, "kakao", url)
    assert res.status_code == 302
    assert res.headers["location"] == f"{FRONT}/auth/callback?returnTo=%2Fcompare%3Fids%3Da%2Cb"
    set_cookie = " ".join(res.headers.get_list("set-cookie")).lower()
    assert "sunroom_session=" in set_cookie and "httponly" in set_cookie
    assert 'sunroom_oauth=""' in set_cookie or "sunroom_oauth=;" in set_cookie  # 흐름 쿠키는 즉시 폐기

    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    user = me.json()
    assert (user["email"], user["provider"], user["role"], user["name"]) == (
        "kim@example.com", "kakao", "seeker", "순천학생",
    )
    row = db.scalar(select(UserRow))
    assert row.password_hash is None  # 소셜 계정은 비밀번호 로그인 불가
    assert db.scalar(select(func.count()).select_from(OAuthAccountRow)) == 1


def test_code_exchange_request_shape(client, provider):
    url = start(client, "google").json()["authorizationUrl"]
    challenge = parse_qs(urlparse(url).query)["code_challenge"][0]
    finish(client, "google", url)
    token_req = next(r for r in provider.requests if r.url.path.endswith("/token"))
    form = parse_qs(token_req.content.decode())
    assert form["grant_type"] == ["authorization_code"] and form["code"] == ["auth-code"]
    assert form["client_secret"] == ["google-secret"]
    assert form["redirect_uri"] == ["http://127.0.0.1:8000/api/v1/auth/oauth/google/callback"]
    verifier = form["code_verifier"][0]
    assert base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode() == challenge
    profile_req = provider.requests[-1]
    assert profile_req.headers["authorization"] == "Bearer tok-oauth2.googleapis.com"


def test_google_signup_as_landlord(client, provider):
    url = start(client, "google", role="landlord").json()["authorizationUrl"]
    assert finish(client, "google", url).status_code == 302
    assert client.get("/api/v1/auth/me").json()["role"] == "landlord"


def test_second_login_reuses_same_user(client, provider, db):
    for _ in range(2):
        url = start(client, "kakao").json()["authorizationUrl"]
        assert "error" not in finish(client, "kakao", url).headers["location"]
    assert db.scalar(select(func.count()).select_from(UserRow)) == 1
    assert db.scalar(select(func.count()).select_from(SessionRow)) == 2


def test_relogin_keeps_existing_role_even_if_start_asks_landlord(client, provider):
    finish(client, "google", start(client, "google").json()["authorizationUrl"])
    finish(client, "google", start(client, "google", role="landlord").json()["authorizationUrl"])
    assert client.get("/api/v1/auth/me").json()["role"] == "seeker"


def test_kakao_without_email_gets_placeholder_email(client, provider, db):
    provider.profiles["kakao"] = {"id": 42, "properties": {"nickname": "닉"}, "kakao_account": {}}
    finish(client, "kakao", start(client, "kakao").json()["authorizationUrl"])
    user = client.get("/api/v1/auth/me").json()
    assert user["email"] == "kakao_42@oauth.sunroom.invalid" and user["name"] == "닉"


def test_unverified_email_is_not_trusted(client, provider):
    provider.profiles["google"]["email_verified"] = False
    finish(client, "google", start(client, "google").json()["authorizationUrl"])
    assert client.get("/api/v1/auth/me").json()["email"] == "google_g-1@oauth.sunroom.invalid"


def test_user_can_still_use_email_and_password_signup(client, provider, db):
    """소셜을 붙여도 기존 이메일 가입/로그인은 그대로."""
    body = {"email": "mail@example.com", "password": "abcd1234", "agreed": True}
    assert client.post("/api/v1/auth/register", json=body, headers=csrf(client)).status_code == 200
    client.post("/api/v1/auth/logout", headers=csrf(client))
    login = client.post("/api/v1/auth/login", json={"email": "mail@example.com", "password": "abcd1234"}, headers=csrf(client))
    assert login.status_code == 200 and login.json()["provider"] == "email"


# ── /callback: 거절 ────────────────────────────────────────
def test_same_email_other_provider_is_not_merged(client, provider, db):
    body = {"email": "kim@example.com", "password": "abcd1234", "agreed": True}
    client.post("/api/v1/auth/register", json=body, headers=csrf(client))
    client.post("/api/v1/auth/logout", headers=csrf(client))
    res = finish(client, "kakao", start(client, "kakao").json()["authorizationUrl"])
    assert res.headers["location"] == f"{FRONT}/auth/callback?error=account_link_required"
    assert client.get("/api/v1/auth/me").status_code == 401
    assert db.scalar(select(func.count()).select_from(UserRow)) == 1  # 병합도, 새 계정도 없음
    assert db.scalar(select(func.count()).select_from(OAuthAccountRow)) == 0


def test_social_account_cannot_password_login(client, provider):
    finish(client, "kakao", start(client, "kakao").json()["authorizationUrl"])
    client.post("/api/v1/auth/logout", headers=csrf(client))
    res = client.post("/api/v1/auth/login", json={"email": "kim@example.com", "password": "anything1"}, headers=csrf(client))
    assert res.status_code == 401 and res.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_wrong_state_is_rejected(client, provider, db):
    url = start(client, "kakao").json()["authorizationUrl"]
    res = finish(client, "kakao", url, state="attacker-state")
    assert res.headers["location"] == f"{FRONT}/auth/callback?error=oauth_failed"
    assert provider.requests == []  # state 가 틀리면 제공자에게 코드를 보내지도 않음
    assert client.get("/api/v1/auth/me").status_code == 401


def test_missing_state_or_flow_cookie_is_rejected(client, provider):
    url = start(client, "kakao").json()["authorizationUrl"]
    assert finish(client, "kakao", url, state=None).headers["location"].endswith("error=oauth_failed")
    client.cookies.clear()  # 다른 브라우저에서 콜백 링크만 열었을 때
    assert finish(client, "kakao", url).headers["location"].endswith("error=oauth_failed")
    assert provider.requests == []


def test_flow_cookie_from_other_provider_is_rejected(client, provider):
    url = start(client, "kakao").json()["authorizationUrl"]
    res = finish(client, "google", url)
    assert res.headers["location"].endswith("error=oauth_failed")


def test_user_cancelled_maps_to_access_denied(client, provider):
    url = start(client, "kakao").json()["authorizationUrl"]
    res = finish(client, "kakao", url, code=None, error="access_denied")
    assert res.headers["location"] == f"{FRONT}/auth/callback?error=access_denied"


def test_provider_error_and_token_failure_hide_details(client, provider):
    provider.token_status = 400
    res = finish(client, "kakao", start(client, "kakao").json()["authorizationUrl"])
    assert res.headers["location"] == f"{FRONT}/auth/callback?error=oauth_failed"
    assert "invalid_grant" not in res.headers["location"]
    assert client.get("/api/v1/auth/me").status_code == 401


def test_flow_cannot_be_replayed(client, provider):
    url = start(client, "kakao").json()["authorizationUrl"]
    assert "returnTo" in finish(client, "kakao", url).headers["location"]
    assert finish(client, "kakao", url).headers["location"].endswith("error=oauth_failed")  # 쿠키 폐기됨


@pytest.mark.parametrize("bad", ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/ok\r\nSet-Cookie: x=1"])
def test_open_redirect_is_blocked(client, provider, bad):
    url = start(client, "kakao", returnTo=bad).json()["authorizationUrl"]
    res = finish(client, "kakao", url)
    assert res.headers["location"] == f"{FRONT}/auth/callback?returnTo=%2F"


def test_provider_profile_without_id_is_failure(client, provider):
    provider.profiles["kakao"] = {"kakao_account": {}}
    res = finish(client, "kakao", start(client, "kakao").json()["authorizationUrl"])
    assert res.headers["location"].endswith("error=oauth_failed")


def test_callback_unknown_provider_is_404(client):
    assert client.get("/api/v1/auth/oauth/naver/callback", params={"code": "x", "state": "y"}).status_code == 404


def test_flow_cookie_garbage_is_ignored():
    assert oauth.read_flow("!!!not-base64!!!") is None
    assert oauth.read_flow(None) is None
    bad = oauth._b64(json.dumps({"p": "kakao"}).encode())
    assert oauth.read_flow(bad) is None
