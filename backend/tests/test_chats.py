"""채팅 테스트. docs/CHAT_HANDOFF.md '서버에서 꼭 지킬 조건' 1~6 을 하나씩 확인."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import engine
from app.main import app
from app.security import _hits

ORIGIN = "http://127.0.0.1:5173"
ROOM = {"title": "채팅 테스트 방", "locationHint": {"zone": "front-gate", "detail": "정문 1분"},
        "rent": 300000, "contact": {"method": "phone", "value": "010-5555-6666"},
        "photos": [{"url": "https://example.com/p.jpg", "alt": "사진"}]}


def csrf(c):
    return {"X-CSRF-Token": c.get("/api/v1/auth/csrf").json()["token"]}


def make_user(role):
    c = TestClient(app, headers={"Origin": ORIGIN})
    email = f"chat-{role}-{uuid.uuid4().hex[:8]}@example.com"
    c.user = c.post("/api/v1/auth/register", headers=csrf(c),
                    json={"email": email, "password": "abcd1234", "role": role, "agreed": True}).json()
    return c


@pytest.fixture
def ctx():
    _hits.clear()
    u = {"owner": make_user("landlord"), "seeker": make_user("seeker"),
         "seeker2": make_user("seeker"), "stranger": make_user("landlord")}
    u["room"] = u["owner"].post("/api/v1/rooms", json=ROOM, headers=csrf(u["owner"])).json()["roomId"]
    yield u
    with engine.begin() as conn:
        for k in ("owner", "seeker", "seeker2", "stranger"):
            uid = u[k].user["id"]
            conn.execute(text("delete from chats where owner_id = cast(:i as uuid) or seeker_id = cast(:i as uuid)"), {"i": uid})
            conn.execute(text("delete from rooms where owner_id = cast(:i as uuid)"), {"i": uid})
            conn.execute(text("delete from users where id = cast(:i as uuid)"), {"i": uid})


def start(c, room, msg="안녕하세요, 방 볼 수 있을까요?"):
    return c.post("/api/v1/chats", json={"roomId": room, "message": msg}, headers=csrf(c))


def send(c, chat_id, msg):
    return c.post(f"/api/v1/chats/{chat_id}/messages", json={"message": msg}, headers=csrf(c))


def future(hours=24):
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat().replace("+00:00", "Z")


# 1. 참가자만
def test_start_and_both_sides_see_it(ctx):
    res = start(ctx["seeker"], ctx["room"])
    assert res.status_code == 200
    chat = res.json()
    assert chat["room"]["id"] == ctx["room"] and chat["room"]["status"] == "published"
    assert chat["room"]["photoUrl"] == "https://example.com/p.jpg" and chat["otherPartyName"] == "집주인"
    assert len(chat["messages"]) == 1 and chat["messages"][0]["senderId"] == ctx["seeker"].user["id"]
    assert chat["messages"][0]["createdAt"].endswith("Z")
    owner_view = ctx["owner"].get("/api/v1/chats").json()["items"]
    assert [c["id"] for c in owner_view] == [chat["id"]] and owner_view[0]["unreadCount"] == 1
    assert "***" in owner_view[0]["otherPartyName"]  # 학생 이름(이메일 앞부분) 가림


def test_non_participant_gets_404_everywhere(ctx):
    chat_id = start(ctx["seeker"], ctx["room"]).json()["id"]
    s = ctx["stranger"]
    assert s.get("/api/v1/chats").json()["items"] == []
    assert s.get(f"/api/v1/chats/{chat_id}").status_code == 404
    assert send(s, chat_id, "끼어들기").status_code == 404
    assert s.patch(f"/api/v1/chats/{chat_id}/read", headers=csrf(s)).status_code == 404
    assert s.post(f"/api/v1/chats/{chat_id}/block", headers=csrf(s)).status_code == 404
    assert s.post(f"/api/v1/chats/{chat_id}/reports", json={"reason": "spam"}, headers=csrf(s)).status_code == 404


def test_no_contact_or_owner_id_in_chat(ctx):
    raw = start(ctx["seeker"], ctx["room"]).text + ctx["owner"].get("/api/v1/chats").text
    assert "010-5555-6666" not in raw and "ownerId" not in raw and "email" not in raw


# 2. 시작 규칙
def test_only_seeker_can_start(ctx):
    assert start(ctx["stranger"], ctx["room"]).status_code == 403


def test_sample_room_cannot_start(ctx):
    assert start(ctx["seeker"], "sun-01").status_code == 404


def test_same_room_same_seeker_reuses_chat(ctx):
    a = start(ctx["seeker"], ctx["room"]).json()
    b = start(ctx["seeker"], ctx["room"], "한 번 더").json()
    assert a["id"] == b["id"] and len(b["messages"]) == 2
    c = start(ctx["seeker2"], ctx["room"]).json()
    assert c["id"] != a["id"]


# 3. 메시지 규칙
@pytest.mark.parametrize("msg", ["   ", "가" * 501])
def test_message_length(ctx, msg):
    chat_id = start(ctx["seeker"], ctx["room"]).json()["id"]
    assert send(ctx["owner"], chat_id, msg).status_code == 422


def test_reply_and_order(ctx):
    chat_id = start(ctx["seeker"], ctx["room"]).json()["id"]
    r = send(ctx["owner"], chat_id, "  네 가능해요  ")
    assert r.status_code == 200 and r.json()["text"] == "네 가능해요" and r.json()["kind"] == "text"
    send(ctx["seeker"], chat_id, "감사합니다")
    texts = [m["text"] for m in ctx["seeker"].get(f"/api/v1/chats/{chat_id}").json()["messages"]]
    assert texts == ["안녕하세요, 방 볼 수 있을까요?", "네 가능해요", "감사합니다"]


def test_block_stops_both_sides(ctx):
    chat_id = start(ctx["seeker"], ctx["room"]).json()["id"]
    res = ctx["owner"].post(f"/api/v1/chats/{chat_id}/block", headers=csrf(ctx["owner"]))
    assert res.json()["blocked"] is True and len(res.json()["messages"]) == 1  # 기록은 유지
    for who in ("owner", "seeker"):
        r = send(ctx[who], chat_id, "보내기")
        assert r.status_code == 403 and r.json()["error"]["code"] == "CHAT_BLOCKED"


def test_hidden_room_still_chats_closed_room_does_not(ctx):
    chat_id = start(ctx["seeker"], ctx["room"]).json()["id"]
    o = ctx["owner"]
    o.patch(f"/api/v1/owner/rooms/{ctx['room']}/status", json={"status": "hidden"}, headers=csrf(o))
    assert send(ctx["seeker"], chat_id, "아직 되나요?").status_code == 200
    o.patch(f"/api/v1/owner/rooms/{ctx['room']}/status", json={"status": "closed"}, headers=csrf(o))
    r = send(ctx["seeker"], chat_id, "거래 끝났나요?")
    assert r.status_code == 409 and r.json()["error"]["code"] == "ROOM_CLOSED"


def test_deleted_room_keeps_history_read_only(ctx):
    chat_id = start(ctx["seeker"], ctx["room"]).json()["id"]
    o = ctx["owner"]
    assert o.delete(f"/api/v1/owner/rooms/{ctx['room']}", headers=csrf(o)).status_code == 204
    chat = ctx["seeker"].get(f"/api/v1/chats/{chat_id}").json()
    assert chat["room"]["status"] == "deleted" and chat["room"]["title"] == ROOM["title"]
    assert len(chat["messages"]) == 1
    assert send(ctx["seeker"], chat_id, "안녕").status_code == 409


# 4. 읽지 않은 수
def test_unread_count(ctx):
    chat_id = start(ctx["seeker"], ctx["room"]).json()["id"]
    send(ctx["seeker"], chat_id, "두 번째")
    unread = lambda c: c.get(f"/api/v1/chats/{chat_id}").json()["unreadCount"]
    assert unread(ctx["owner"]) == 2 and unread(ctx["seeker"]) == 0  # 내 메시지는 안 셈
    assert ctx["owner"].patch(f"/api/v1/chats/{chat_id}/read", headers=csrf(ctx["owner"])).status_code == 204
    assert unread(ctx["owner"]) == 0
    send(ctx["seeker"], chat_id, "세 번째")
    assert unread(ctx["owner"]) == 1


# 5. 방문 제안
def test_visit_proposal_and_single_response(ctx):
    chat_id = start(ctx["seeker"], ctx["room"]).json()["id"]
    o, s = ctx["owner"], ctx["seeker"]
    at = future()
    p = o.post(f"/api/v1/chats/{chat_id}/visits", json={"visitAt": at}, headers=csrf(o))
    assert p.status_code == 200 and p.json()["kind"] == "visit_proposal" and p.json()["visitAt"].endswith("Z")
    pid = p.json()["id"]
    # 제안한 본인은 답변 불가
    assert o.post(f"/api/v1/chats/{chat_id}/visits/{pid}/response", json={"decision": "accepted"},
                  headers=csrf(o)).status_code == 404
    r = s.post(f"/api/v1/chats/{chat_id}/visits/{pid}/response", json={"decision": "accepted"}, headers=csrf(s))
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "visit_response" and body["proposalId"] == pid and body["decision"] == "accepted"
    assert body["visitAt"] == p.json()["visitAt"]
    again = s.post(f"/api/v1/chats/{chat_id}/visits/{pid}/response", json={"decision": "declined"}, headers=csrf(s))
    assert again.status_code == 409


def test_visit_must_be_future(ctx):
    chat_id = start(ctx["seeker"], ctx["room"]).json()["id"]
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    r = ctx["seeker"].post(f"/api/v1/chats/{chat_id}/visits", json={"visitAt": past}, headers=csrf(ctx["seeker"]))
    assert r.status_code == 400 and r.json()["error"]["code"] == "INVALID_VISIT"


# 6. 신고
def test_report_once_per_reporter(ctx):
    chat_id = start(ctx["seeker"], ctx["room"]).json()["id"]
    s = ctx["seeker"]
    for reason in ("spam", "other"):
        r = s.post(f"/api/v1/chats/{chat_id}/reports", json={"reason": reason}, headers=csrf(s))
        assert r.json() == {"status": "received"}
    with engine.connect() as conn:
        n = conn.execute(text("select count(*) from chat_reports where chat_id = cast(:c as uuid)"),
                         {"c": chat_id}).scalar()
    assert n == 1
    assert len(s.get(f"/api/v1/chats/{chat_id}").json()["messages"]) == 1  # 신고해도 기록 유지


def test_guest_is_401(ctx):
    guest = TestClient(app, headers={"Origin": ORIGIN})
    assert guest.get("/api/v1/chats").status_code == 401
