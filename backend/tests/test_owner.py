"""집주인 매물 등록·관리·문의 테스트. 실제 DB 필요.

docs/LANDLORD_HANDOFF.md 의 권한·상태 규칙을 확인함.
"""

import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import engine
from app.main import app
from tests.verified import approve_landlord
from app.security import _hits

ORIGIN = "http://127.0.0.1:5173"
SUBMISSION = {
    "title": "정문 1분 풀옵션 원룸",
    "locationHint": {"zone": "front-gate", "detail": "공대 후문 도보 3분"},
    "coordinates": {"lat": 34.9712, "lng": 127.4805},
    "rent": 320000,
    "contact": {"method": "phone", "value": "010-1234-5678"},
    "deposit": 3000000,
    "maintenance": 0,
    "area": 23.1,
    "floor": 2,
    "options": {"aircon": True, "washer": False},
    "description": "2018년 신축",
    "photos": [{"url": "https://example.com/a.jpg", "alt": "정면"}],
    "pastedListingText": "원문은 저장하면 안 됨 SECRET-PASTE",
}


def csrf(c):
    return {"X-CSRF-Token": c.get("/api/v1/auth/csrf").json()["token"]}


def make_user(role):
    """역할별 로그인된 클라이언트를 만듦. 테스트 끝나면 사용자·매물 삭제."""
    c = TestClient(app, headers={"Origin": ORIGIN})
    email = f"t-{role}-{uuid.uuid4().hex[:8]}@example.com"
    res = c.post("/api/v1/auth/register", headers=csrf(c),
                 json={"email": email, "password": "abcd1234", "role": role, "agreed": True})
    assert res.status_code == 200
    c.user = res.json()
    if role == "landlord":
        approve_landlord(c.user["id"])
    return c


@pytest.fixture
def users():
    _hits.clear()
    made = {"landlord": make_user("landlord"), "other": make_user("landlord"), "seeker": make_user("seeker")}
    yield made
    with engine.begin() as conn:
        for c in made.values():
            conn.execute(text("delete from rooms where owner_id = cast(:id as uuid)"), {"id": c.user["id"]})
            conn.execute(text("delete from users where id = cast(:id as uuid)"), {"id": c.user["id"]})


def submit(c, body=SUBMISSION):
    return c.post("/api/v1/rooms", json=body, headers=csrf(c))


def test_submit_then_public_search_and_detail(users):
    ll = users["landlord"]
    res = submit(ll)
    assert res.status_code == 200
    room_id, status = res.json()["roomId"], res.json()["status"]
    assert room_id.startswith("owner-") and status in ("published", "pending_review")

    detail = ll.get(f"/api/v1/rooms/{room_id}")
    assert detail.status_code == 200
    room = detail.json()
    assert room["source"]["kind"] == "owner" and room["neighborhood"] == "공대 후문 도보 3분"
    assert room["coordinates"] == {"lat": 34.9712, "lng": 127.4805}
    assert room["maintenance"] == 0 and room["options"]["washer"] is False and room["options"]["desk"] is None
    ids = [r["id"] for r in ll.get("/api/v1/rooms").json()["items"]]
    assert room_id in ids


def test_public_room_never_contains_contact_or_paste(users):
    ll = users["landlord"]
    room_id = submit(ll).json()["roomId"]
    for raw in (ll.get(f"/api/v1/rooms/{room_id}").text, ll.get("/api/v1/rooms").text):
        assert "010-1234-5678" not in raw and "SECRET-PASTE" not in raw and "ownerId" not in raw


def test_paste_text_is_not_stored(users):
    ll = users["landlord"]
    submit(ll)
    raw = ll.get("/api/v1/owner/rooms").text
    assert "SECRET-PASTE" not in raw and "pastedListingText" not in raw


def test_only_landlord_can_submit(users):
    assert submit(users["seeker"]).status_code == 403
    guest = TestClient(app, headers={"Origin": ORIGIN})
    assert submit(guest).status_code == 401


def test_minimal_submission_and_zone_anchor(users):
    body = {k: SUBMISSION[k] for k in ("title", "locationHint", "rent", "contact")}
    room_id = submit(users["landlord"], body).json()["roomId"]
    room = users["landlord"].get(f"/api/v1/rooms/{room_id}").json()
    assert room["coordinates"] == {"lat": 34.9716, "lng": 127.4801}  # 좌표 생략 → 정문 앵커
    assert room["deposit"] is None and room["area"] is None and room["photos"] == []


def test_explicit_null_coordinates_are_kept(users):
    body = {k: SUBMISSION[k] for k in ("title", "locationHint", "rent", "contact")} | {"coordinates": None}
    room_id = submit(users["landlord"], body).json()["roomId"]
    assert users["landlord"].get(f"/api/v1/rooms/{room_id}").json()["coordinates"] is None


@pytest.mark.parametrize("bad", [
    {"rent": -1},
    {"title": "   "},
    {"title": "가" * 61},
    {"locationHint": {"zone": "moon", "detail": "x"}},
    {"photos": [{"url": "data:image/png;base64,AAAA", "alt": "x"}]},
    {"options": {"sauna": True}},
    {"coordinates": {"lat": 91, "lng": 0}},
])
def test_invalid_submission_is_422(users, bad):
    assert submit(users["landlord"], SUBMISSION | bad).status_code == 422


def test_owner_listing_shape_and_isolation(users):
    ll, other = users["landlord"], users["other"]
    room_id = submit(ll).json()["roomId"]
    items = ll.get("/api/v1/owner/rooms").json()["items"]
    assert len(items) == 1
    item = items[0]
    assert item["id"] == room_id and item["ownerId"] == ll.user["id"]
    assert item["submission"]["contact"]["value"] == "010-1234-5678"  # 본인에게만 보임
    assert item["updatedAt"].endswith("Z")
    assert other.get("/api/v1/owner/rooms").json()["items"] == []
    # 남의 매물 수정·상태·삭제는 404 (존재 여부도 숨김)
    assert other.patch(f"/api/v1/owner/rooms/{room_id}", json=SUBMISSION, headers=csrf(other)).status_code == 404
    assert other.patch(f"/api/v1/owner/rooms/{room_id}/status", json={"status": "hidden"},
                       headers=csrf(other)).status_code == 404
    assert other.delete(f"/api/v1/owner/rooms/{room_id}", headers=csrf(other)).status_code == 404


def test_update_replaces_submission(users):
    ll = users["landlord"]
    room_id = submit(ll).json()["roomId"]
    res = ll.patch(f"/api/v1/owner/rooms/{room_id}", json=SUBMISSION | {"rent": 290000, "title": "수정됨"},
                   headers=csrf(ll))
    assert res.status_code == 200 and res.json()["submission"]["rent"] == 290000
    assert ll.get(f"/api/v1/rooms/{room_id}").json()["title"] == "수정됨"


def test_status_hide_close_republish(users):
    ll = users["landlord"]
    room_id = submit(ll).json()["roomId"]
    st = lambda s: ll.patch(f"/api/v1/owner/rooms/{room_id}/status", json={"status": s}, headers=csrf(ll))
    assert st("hidden").json()["status"] == "hidden"
    assert ll.get(f"/api/v1/rooms/{room_id}").status_code == 404  # 숨기면 공개 조회에서 제외
    assert st("closed").json()["status"] == "closed"
    assert st("published").json()["status"] in ("published", "pending_review")
    assert st("pending_review").status_code == 409  # 집주인이 검수 대기로 못 바꿈


def test_pending_room_cannot_self_publish(users):
    ll = users["landlord"]
    room_id = submit(ll).json()["roomId"]
    with engine.begin() as conn:
        conn.execute(text("update rooms set status='pending_review' where id=:id"), {"id": room_id})
    res = ll.patch(f"/api/v1/owner/rooms/{room_id}/status", json={"status": "published"}, headers=csrf(ll))
    assert res.status_code == 409 and res.json()["error"]["code"] == "INVALID_TRANSITION"


def test_delete_room(users):
    ll = users["landlord"]
    room_id = submit(ll).json()["roomId"]
    assert ll.delete(f"/api/v1/owner/rooms/{room_id}", headers=csrf(ll)).status_code == 204
    assert ll.get(f"/api/v1/rooms/{room_id}").status_code == 404


def test_inquiry_flow(users):
    ll, seeker = users["landlord"], users["seeker"]
    room_id = submit(ll).json()["roomId"]
    body = {"roomId": room_id, "message": "  주말에 볼 수 있을까요?  ",
            "replyContact": {"method": "kakao", "value": "https://open.kakao.com/SECRET-REPLY"}}
    res = seeker.post(f"/api/v1/rooms/{room_id}/inquiries", json=body, headers=csrf(seeker))
    assert res.json() == {"status": "sent"}

    inbox = ll.get("/api/v1/owner/inquiries")
    assert "SECRET-REPLY" not in inbox.text  # 학생 연락처는 저장도 노출도 안 함
    item = inbox.json()["items"][0]
    assert item["roomTitle"] == SUBMISSION["title"] and item["message"] == "주말에 볼 수 있을까요?"
    assert item["read"] is False

    assert users["other"].get("/api/v1/owner/inquiries").json()["items"] == []
    assert users["other"].patch(f"/api/v1/owner/inquiries/{item['id']}/read",
                                headers=csrf(users["other"])).status_code == 404
    assert ll.patch(f"/api/v1/owner/inquiries/{item['id']}/read", headers=csrf(ll)).status_code == 204
    assert ll.get("/api/v1/owner/inquiries").json()["items"][0]["read"] is True


def test_inquiry_rules(users):
    ll, seeker = users["landlord"], users["seeker"]
    room_id = submit(ll).json()["roomId"]
    body = lambda rid: {"roomId": rid, "message": "안녕하세요", "replyContact": {"method": "phone", "value": "010"}}
    assert ll.post(f"/api/v1/rooms/{room_id}/inquiries", json=body(room_id), headers=csrf(ll)).status_code == 400
    assert seeker.post("/api/v1/rooms/sun-01/inquiries", json=body("sun-01"),
                       headers=csrf(seeker)).status_code == 404  # 샘플 매물엔 문의 불가
    assert seeker.post(f"/api/v1/rooms/{room_id}/inquiries", json=body("other-id"),
                       headers=csrf(seeker)).status_code == 422
    guest = TestClient(app, headers={"Origin": ORIGIN})
    assert guest.post(f"/api/v1/rooms/{room_id}/inquiries", json=body(room_id),
                      headers=csrf(guest)).status_code == 401
