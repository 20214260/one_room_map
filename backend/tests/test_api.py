"""실제 DB에 붙여서 API 응답을 확인. .env 의 DATABASE_URL 로 연결 (Supabase 또는 로컬 Postgres).

DB에 sql/002_seed.sql 샘플 6개가 들어 있어야 함.
"""

import json
from pathlib import Path
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import engine
from app.main import app

FIXTURE = json.loads((Path(__file__).parent / "fixture_frontend.json").read_text(encoding="utf-8"))
MOCK = {r["id"]: r for r in FIXTURE["rooms"]}
client = TestClient(app)


def test_db_connection():
    with engine.connect() as conn:
        assert conn.execute(text("select 1")).scalar() == 1


def test_detail_matches_frontend_mock():
    """DB에서 꺼낸 매물이 프론트 mock 매물과 필드 하나까지 같아야 http 모드 전환 시 화면이 그대로임."""
    for room_id, expected in MOCK.items():
        res = client.get(f"/api/v1/rooms/{room_id}")
        assert res.status_code == 200, room_id
        assert res.json() == expected, room_id


@pytest.mark.parametrize("case", FIXTURE["cases"][::7])
def test_list_same_as_frontend(case):
    res = client.get(f"/api/v1/rooms?search={quote(json.dumps(case['search'], ensure_ascii=False))}")
    assert res.status_code == 200
    body = res.json()
    # 실제 DB에는 집주인이 등록한 매물도 있으므로 샘플 6개(sun-*)만 골라서 순서까지 비교
    samples = [r["id"] for r in body["items"] if r["id"] in MOCK]
    assert samples == case["expected"]
    assert body["total"] == len(body["items"]) >= len(case["expected"])


def test_list_without_search_param():
    body = client.get("/api/v1/rooms").json()
    assert {r["id"] for r in body["items"]} >= set(MOCK)  # 샘플 6개는 항상 포함


def test_not_found_error_format():
    res = client.get("/api/v1/rooms/nope")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "NOT_FOUND"


def test_bad_search_is_422():
    res = client.get("/api/v1/rooms?search=" + quote('{"sort":"cheap"}'))
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "INVALID_SEARCH"


@pytest.fixture
def owner_rooms():
    """집주인 매물 2개 (공개 1, 검수 대기 1)를 넣고 테스트 뒤 지움."""
    source = {
        "name": "집주인·부동산 직접 등록", "url": None, "collectedAt": "2026-09-24",
        "license": "등록자 제공", "kind": "owner", "note": "테스트",
    }
    common = {
        "opts": json.dumps({"aircon": True}),
        "src": json.dumps(source, ensure_ascii=False),
        "c": json.dumps({"method": "phone", "value": "010-0000-0000"}),
    }
    with engine.begin() as conn:
        conn.execute(text(
            "insert into rooms (id, title, neighborhood, deposit, rent, options, status, contact, "
            "zone, location_detail, source) values (:id, :t, '정문', null, 300000, cast(:opts as jsonb), "
            ":st, cast(:c as jsonb), 'front-gate', '정문 1분', cast(:src as jsonb))"
        ), [
            {"id": "test-owner-pub", "t": "테스트 공개 매물", "st": "published", **common},
            {"id": "test-owner-pending", "t": "테스트 검수 대기", "st": "pending_review", **common},
        ])
    yield
    with engine.begin() as conn:
        conn.execute(text("delete from rooms where id like 'test-owner-%'"))


def test_pending_review_room_is_hidden(owner_rooms):
    ids = [r["id"] for r in client.get("/api/v1/rooms").json()["items"]]
    assert "test-owner-pub" in ids and "test-owner-pending" not in ids
    assert client.get("/api/v1/rooms/test-owner-pending").status_code == 404


def test_owner_room_never_leaks_private_fields(owner_rooms):
    raw = client.get("/api/v1/rooms/test-owner-pub").text
    assert "010-0000-0000" not in raw
    room = json.loads(raw)
    for private in ("contact", "ownerId", "owner_id", "zone", "status"):
        assert private not in room
    # 모르는 옵션은 false 가 아니라 null, 보증금 미상도 null
    assert room["options"]["aircon"] is True and room["options"]["washer"] is None
    assert room["deposit"] is None and room["source"]["kind"] == "owner"


def test_cors_allows_frontend_with_credentials():
    res = client.get("/api/v1/rooms", headers={"Origin": "http://localhost:5173"})
    assert res.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert res.headers["access-control-allow-credentials"] == "true"
