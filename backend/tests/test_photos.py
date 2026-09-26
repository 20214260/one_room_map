"""사진 업로드 테스트. 실제 Supabase 대신 가짜 저장소로 바꿔서 확인."""

import io
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text

import app.routers.owner as owner_router
import app.storage as storage
from app.db import engine
from app.main import app
from tests.verified import approve_landlord
from app.security import _hits

ORIGIN = "http://127.0.0.1:5173"


def csrf(c):
    return {"X-CSRF-Token": c.get("/api/v1/auth/csrf").json()["token"]}


def make_user(role):
    c = TestClient(app, headers={"Origin": ORIGIN})
    c.user = c.post("/api/v1/auth/register", headers=csrf(c), json={
        "email": f"photo-{uuid.uuid4().hex[:8]}@example.com", "password": "abcd1234",
        "role": role, "agreed": True}).json()
    if role == "landlord":
        approve_landlord(c.user["id"])
    return c


@pytest.fixture
def users():
    _hits.clear()
    u = {"landlord": make_user("landlord"), "seeker": make_user("seeker")}
    yield u
    with engine.begin() as conn:
        for c in u.values():
            conn.execute(text("delete from users where id = cast(:i as uuid)"), {"i": c.user["id"]})


@pytest.fixture
def fake_storage(monkeypatch):
    saved = {}

    def fake_upload(user_id, jpeg):
        saved["user"], saved["bytes"] = user_id, jpeg
        return f"https://example.supabase.co/storage/v1/object/public/room-photos/{user_id}/x.jpg"

    monkeypatch.setattr(owner_router, "upload_photo", fake_upload)
    return saved


def jpeg_with_gps(size=(3000, 2000)) -> bytes:
    img = Image.new("RGB", size, (200, 120, 80))
    exif = Image.Exif()
    exif[0x8825] = {2: (34.0, 58.0, 17.0)}  # GPS 정보 (촬영 위치)
    exif[0x010F] = "PhoneMaker"
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


def upload(c, data, name="room.jpg", ctype="image/jpeg"):
    return c.post("/api/v1/owner/photos", files={"file": (name, data, ctype)}, headers=csrf(c))


def test_upload_resizes_and_strips_exif(users, fake_storage):
    res = upload(users["landlord"], jpeg_with_gps())
    assert res.status_code == 200
    photo = res.json()["photo"]
    assert photo["url"].startswith("https://") and photo["alt"]
    stored = Image.open(io.BytesIO(fake_storage["bytes"]))
    assert stored.format == "JPEG" and max(stored.size) == 1200  # 긴 변 1200px
    assert len(stored.getexif()) == 0  # 촬영 위치 등 메타데이터 제거
    assert fake_storage["user"] == users["landlord"].user["id"]


def test_transparent_png_gets_white_background(users, fake_storage):
    img = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    assert upload(users["landlord"], buf.getvalue(), "a.png", "image/png").status_code == 200
    assert Image.open(io.BytesIO(fake_storage["bytes"])).getpixel((5, 5)) == (255, 255, 255)


def test_fake_image_rejected(users, fake_storage):
    assert upload(users["landlord"], b"<?php echo 'not an image'; ?>").status_code == 422


def test_gif_rejected(users, fake_storage):
    buf = io.BytesIO()
    Image.new("RGB", (5, 5)).save(buf, "GIF")
    assert upload(users["landlord"], buf.getvalue(), "a.gif", "image/gif").status_code == 415


def test_too_large_rejected(users, fake_storage):
    assert upload(users["landlord"], b"0" * (5 * 1024 * 1024 + 10)).status_code == 413


def test_only_landlord(users, fake_storage):
    assert upload(users["seeker"], jpeg_with_gps((10, 10))).status_code == 403


def test_storage_not_configured_is_503(users, monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    res = upload(users["landlord"], jpeg_with_gps((10, 10)))
    assert res.status_code == 503 and res.json()["error"]["code"] == "PHOTO_STORAGE"


def test_upload_photo_calls_supabase_correctly(monkeypatch):
    """Supabase Storage REST 호출 모양 확인 (네트워크 없이)."""
    seen = {}

    def fake_post(url, content, headers, timeout):
        seen.update(url=url, headers=headers, size=len(content))
        return httpx.Response(200, json={"Key": "ok"})

    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co/")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "eyJlegacy.jwt.key")
    monkeypatch.setenv("PHOTO_BUCKET", "room-photos")
    monkeypatch.setattr(storage.httpx, "post", fake_post)
    url = storage.upload_photo("user-1", b"jpegbytes")
    assert seen["url"].startswith("https://abc.supabase.co/storage/v1/object/room-photos/user-1/")
    assert seen["headers"]["Authorization"] == "Bearer eyJlegacy.jwt.key"
    assert seen["headers"]["apikey"] == "eyJlegacy.jwt.key"
    assert url.startswith("https://abc.supabase.co/storage/v1/object/public/room-photos/user-1/")
    assert url.endswith(".jpg")


def test_uploaded_url_accepted_in_submission(users, fake_storage):
    """업로드 결과 URL 을 그대로 매물 등록에 쓸 수 있어야 함."""
    ll = users["landlord"]
    photo = upload(ll, jpeg_with_gps((50, 50))).json()["photo"]
    body = {"title": "사진 있는 방", "locationHint": {"zone": "back-gate", "detail": "후문"},
            "rent": 250000, "contact": {"method": "phone", "value": "010"}, "photos": [photo]}
    room_id = ll.post("/api/v1/rooms", json=body, headers=csrf(ll)).json()["roomId"]
    assert ll.get(f"/api/v1/rooms/{room_id}").json()["photos"] == [photo]
    with engine.begin() as conn:
        conn.execute(text("delete from rooms where id = :i"), {"i": room_id})


def test_new_secret_key_uses_apikey_header_only():
    headers = storage._auth_headers("sb_secret_abc")
    assert headers == {"apikey": "sb_secret_abc"}
