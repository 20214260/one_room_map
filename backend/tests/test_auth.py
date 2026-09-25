"""로그인 API 계약 테스트. 실제 DB 필요 (.env 의 DATABASE_URL).

프론트 gateway.ts 의 흐름을 그대로 따라 함:
POST 전에 GET /auth/csrf → X-CSRF-Token 헤더, 세션은 쿠키.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import engine
from app.main import app
from app.security import _hits

ORIGIN = "http://127.0.0.1:5173"


@pytest.fixture
def client():
    _hits.clear()  # 테스트끼리 요청 빈도 제한이 섞이지 않게
    with TestClient(app, headers={"Origin": ORIGIN}) as c:
        yield c


@pytest.fixture
def email():
    addr = f"test-{uuid.uuid4().hex[:10]}@example.com"
    yield addr
    with engine.begin() as conn:
        conn.execute(text("delete from users where email = :e"), {"e": addr})


def csrf(c: TestClient) -> dict:
    return {"X-CSRF-Token": c.get("/api/v1/auth/csrf").json()["token"]}


def register(c, email, role="seeker", password="abcd1234"):
    body = {"email": email, "password": password, "role": role, "agreed": True, "termsVersion": "2026-09-22"}
    return c.post("/api/v1/auth/register", json=body, headers=csrf(c))


def test_guest_me_is_401(client):
    res = client.get("/api/v1/auth/me")
    assert res.status_code == 401  # 프론트는 401 일 때만 "비회원"으로 처리함


def test_register_sets_session_and_role(client, email):
    res = register(client, email, role="landlord")
    assert res.status_code == 200
    user = res.json()
    assert user == {"id": user["id"], "name": email.split("@")[0], "email": email,
                    "provider": "email", "role": "landlord"}
    assert "sunroom_session" in res.cookies
    assert client.get("/api/v1/auth/me").json()["role"] == "landlord"


def test_session_cookie_is_httponly(client, email):
    res = register(client, email)
    cookie = [h for h in res.headers.get_list("set-cookie") if h.startswith("sunroom_session=")][0]
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie


def test_password_hash_never_returned(client, email):
    raw = register(client, email).text
    assert "scrypt" not in raw and "password" not in raw


def test_duplicate_email_is_409(client, email):
    register(client, email)
    client.cookies.clear()
    res = register(client, email.upper())  # 대소문자만 달라도 같은 이메일
    assert res.status_code == 409 and res.json()["error"]["code"] == "EMAIL_EXISTS"


def test_login_logout_flow(client, email):
    register(client, email)
    client.cookies.clear()
    assert client.get("/api/v1/auth/me").status_code == 401

    bad = client.post("/api/v1/auth/login", json={"email": email, "password": "wrong1234"}, headers=csrf(client))
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "INVALID_CREDENTIALS"

    ok = client.post("/api/v1/auth/login", json={"email": email, "password": "abcd1234"}, headers=csrf(client))
    assert ok.status_code == 200 and client.get("/api/v1/auth/me").json()["email"] == email

    out = client.post("/api/v1/auth/logout", headers=csrf(client))
    assert out.status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401


def test_unknown_email_same_error_as_wrong_password(client):
    res = client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "abcd1234"},
                      headers=csrf(client))
    assert res.status_code == 401 and res.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_post_without_csrf_is_rejected(client, email):
    body = {"email": email, "password": "abcd1234", "agreed": True}
    res = client.post("/api/v1/auth/register", json=body)
    assert res.status_code == 403


def test_other_origin_is_rejected(client, email):
    h = csrf(client) | {"Origin": "https://evil.example"}
    body = {"email": email, "password": "abcd1234", "agreed": True}
    assert client.post("/api/v1/auth/register", json=body, headers=h).status_code == 403


@pytest.mark.parametrize("password", ["short1", "onlyletters", "12345678", "a1" * 40])
def test_weak_password_is_422(client, email, password):
    assert register(client, email, password=password).status_code == 422


def test_terms_must_be_agreed(client, email):
    body = {"email": email, "password": "abcd1234", "agreed": False}
    assert client.post("/api/v1/auth/register", json=body, headers=csrf(client)).status_code == 422


def test_login_rate_limited(client, email):
    codes = [client.post("/api/v1/auth/login", json={"email": email, "password": "wrong1234"},
                         headers=csrf(client)).status_code for _ in range(11)]
    assert codes[-1] == 429
