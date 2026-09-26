"""AI 추천·매물 설명 초안 테스트. 실제 Gemini·DB 없이 실행됨.

- Gemini: httpx MockTransport 로 응답을 흉내 냄 (키가 URL 이 아니라 헤더로 가는지도 확인)
- 규칙 기반 결과가 프론트 rulesSummary / createRulesDraft 와 같은지
- 근거 검증: DB 에 없는 숫자·옵션을 말하면 mode: rules 로 대체되는지
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://x:x@localhost:5432/x")

import copy
import json
import uuid
from datetime import timezone
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.attributes import set_committed_value
from sqlalchemy.pool import StaticPool

from app import gemini
from app.db import Base, get_db
from app.draft import DraftRequest, generate_draft
from app.main import app
from app.models import RoomRow, SessionRow, UserRow
from app.recommend import FALLBACK_REASONS, recommend
from app.search import Filters
from app.security import _hits

ROOMS = {r["id"]: r for r in json.loads(Path(__file__).with_name("fixture_frontend.json").read_text("utf-8"))["rooms"]}
A, B = ROOMS["sun-01"], ROOMS["sun-02"]  # 월 부담 37만 / 31만, 학교 380m / 510m
ORIGIN = "http://127.0.0.1:5173"


class FakeGemini:
    def __init__(self, payload=None, status=200, exc=None):
        self.payload, self.status, self.exc = payload, status, exc
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.exc:
            raise self.exc
        body = {"candidates": [{"content": {"parts": [{"text": json.dumps(self.payload, ensure_ascii=False)}]}}]}
        return httpx.Response(self.status, json=body)

    @property
    def sent(self) -> dict:
        return json.loads(self.requests[-1].content)


@pytest.fixture
def ai(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    def use(**kwargs):
        fake = FakeGemini(**kwargs)
        monkeypatch.setattr(gemini, "transport", httpx.MockTransport(fake))
        return fake

    return use


def ai_items(a_reasons, b_reasons=(), a_tradeoffs=(), summary="두 방의 비용과 거리를 비교했어요."):
    ev = lambda xs: [{"field": f, "text": t} for f, t in xs]  # noqa: E731
    return {"summary": summary, "items": [
        {"roomId": "sun-01", "reasons": ev(a_reasons), "tradeoffs": ev(a_tradeoffs)},
        {"roomId": "sun-02", "reasons": ev(b_reasons), "tradeoffs": []},
    ]}


# ── 추천 ───────────────────────────────────────────────────────────
def test_no_key_returns_frontend_rules_summary(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    res = recommend([A, B], Filters(options=["elevator"]), "조용한 방")
    assert res["mode"] == "rules" and res["fallbackReason"] == FALLBACK_REASONS["not_configured"]
    assert res["items"][0] == {
        "roomId": "sun-01",
        "reasons": [{"field": "monthly", "text": "월세 + 관리비 37만원 / 월"},
                    {"field": "schoolDistance", "text": "학교까지 도보 경로 380m"}],
        "tradeoffs": [{"field": "options", "text": "선택한 조건 중 충족하지 않거나 확인되지 않은 항목이 있어요."}],
    }
    assert "샘플 매물의 비교 예시예요. 실제 매물·실측 거리 정보가 아니에요." in res["limitations"]


def test_grounded_ai_answer(ai):
    fake = ai(payload=ai_items(
        a_reasons=[("schoolDistance", "학교까지 380m로 더 가까워요."), ("options", "에어컨과 세탁기가 있어요.")],
        a_tradeoffs=[("monthly", "월 부담이 37만원으로 6만원 더 들어요.")],
        b_reasons=[("monthly", "월세와 관리비를 합쳐 31만원이에요.")],
    ))
    res = recommend([A, B], Filters(), "통학이 편한 방")
    assert res["mode"] == "ai" and res["fallbackReason"] is None
    assert [i["roomId"] for i in res["items"]] == ["sun-01", "sun-02"]
    # 키는 URL 이 아니라 헤더로, 매물 사실은 DB 값으로, 사용자 선호는 구분된 참고 자료로
    req = fake.requests[-1]
    assert req.headers["x-goog-api-key"] == "test-key" and "test-key" not in str(req.url)
    prompt = fake.sent["contents"][0]["parts"][0]["text"]
    assert '"monthlyWon": 370000' in prompt and "<<<\n통학이 편한 방\n>>>" in prompt


@pytest.mark.parametrize("text", [
    "월세가 30만원이에요.",           # DB 에 없는 금액
    "학교까지 도보 5분이에요.",        # 도보 시간 추정
    "관리비 5만원, 월세 28만원이에요.",  # 다른 방(sun-02) 월세를 sun-01 것처럼
])
def test_ungrounded_numbers_fall_back(ai, text):
    ai(payload=ai_items(a_reasons=[("monthly", text)]))
    res = recommend([A, B], Filters(), "")
    assert res["mode"] == "rules" and res["fallbackReason"] == FALLBACK_REASONS["ungrounded"]


def test_unknown_option_claim_falls_back(ai):
    a = copy.deepcopy(A)
    a["options"]["washer"] = None
    ai(payload=ai_items(a_reasons=[("options", "세탁기가 있어요.")]))
    assert recommend([a, B], Filters(), "")["mode"] == "rules"
    ai(payload=ai_items(a_reasons=[("options", "세탁기는 정보 없음이라 확인이 필요해요.")]))
    assert recommend([a, B], Filters(), "")["mode"] == "ai"


@pytest.mark.parametrize("payload", [
    {"summary": "요약", "items": [{"roomId": "sun-01", "reasons": [], "tradeoffs": []}]},  # 한 방 누락
    {"summary": "요약", "items": [{"roomId": "sun-01", "reasons": [], "tradeoffs": []},
                                  {"roomId": "evil", "reasons": [], "tradeoffs": []}]},    # 외부 ID
    {"summary": "요약", "items": [{"roomId": "sun-01", "reasons": [{"field": "view", "text": "전망"}], "tradeoffs": []},
                                  {"roomId": "sun-02", "reasons": [], "tradeoffs": []}]},  # 미지원 근거 필드
    {"summary": "", "items": []},
])
def test_invalid_structure_falls_back(ai, payload):
    ai(payload=payload)
    assert recommend([A, B], Filters(), "")["mode"] == "rules"


def test_busy_model_retries_fallback_model(ai, monkeypatch):
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    monkeypatch.delenv("GEMINI_FALLBACK_MODEL", raising=False)
    good = ai_items(a_reasons=[("monthly", "월 부담이 37만원이에요.")])
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if len(calls) == 1:
            return httpx.Response(503, json={"error": {"code": 503}})
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(good, ensure_ascii=False)}]}}]})

    monkeypatch.setattr(gemini, "transport", httpx.MockTransport(handler))
    assert recommend([A, B], Filters(), "")["mode"] == "ai"
    assert [p.split("/")[-1] for p in calls] == ["gemini-3.8-flash:generateContent", "gemini-3.5-flash:generateContent"]


@pytest.mark.parametrize("kwargs,reason", [
    ({"status": 429}, "rate_limited"),
    ({"status": 500}, "error"),
    ({"exc": httpx.ReadTimeout("slow")}, "timeout"),
])
def test_ai_failures_fall_back(ai, kwargs, reason):
    ai(payload={}, **kwargs)
    res = recommend([A, B], Filters(), "")
    assert res["mode"] == "rules" and res["fallbackReason"] == FALLBACK_REASONS[reason]


# ── 매물 설명 초안 ──────────────────────────────────────────────────
DRAFT = DraftRequest(
    title="정문 원룸", locationHint={"zone": "front-gate", "detail": "공대 후문 앞"}, rent=320000,
    options={"aircon": True, "washer": False},
    pastedListingText="보증금 300만 / 관리비 5만 / 연락 010-1234-5678 카톡 아이디: owner77",
)


def test_draft_rules_matches_frontend(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    res = generate_draft(DRAFT)
    assert res == {
        "mode": "rules",
        "description": "정문 원룸\n공대 후문 앞에 위치한 방입니다.\n보증금 300만원, 월세 32만원, 관리비 5만원입니다.\n"
                       "제공 옵션은 에어컨입니다.\n입주 일정과 자세한 조건은 문의로 확인해 주세요.",
        "hints": {"deposit": 3000000, "maintenance": 50000},
        "limitations": ["입력한 정보와 게시글의 금액만 정리한 기본 초안이에요. AI 분석 결과가 아니에요.",
                        "관리비 포함 항목·채광·방음·도보 거리는 추정하지 않았어요."],
    }


def test_draft_ai_grounded_and_contacts_masked(ai):
    fake = ai(payload={
        "description": "공대 후문 앞 원룸이에요. 보증금 300만원, 월세 32만원, 관리비 5만원이에요. 에어컨이 있고 세탁기는 없어요. 문의하기로 연락해 주세요.",
        "hints": {"deposit": 3000000, "maintenance": 50000, "rent": 320000},
    })
    res = generate_draft(DRAFT)
    assert res["mode"] == "ai"
    assert res["hints"] == {"deposit": 3000000, "maintenance": 50000}  # 이미 입력한 월세는 제안 안 함
    prompt = fake.sent["contents"][0]["parts"][0]["text"]
    assert "010-1234-5678" not in prompt and "owner77" not in prompt and "[연락처]" in prompt


@pytest.mark.parametrize("description,hints", [
    ("햇살이 잘 드는 방이에요.", {}),                           # 입력에 없는 채광
    ("정문까지 도보 3분이에요.", {}),                           # 입력에 없는 거리
    ("23평 넓은 방이에요.", {}),                                # 면적 추정
    ("010-1234-5678로 연락 주세요.", {}),                        # 연락처
    ("세탁기가 있어요.", {}),                                   # '없음'으로 입력한 옵션
    ("냉장고가 있어요.", {}),                                   # 입력하지 않은 옵션
    ("관리비 7만원이에요.", {}),                                # 없는 금액
])
def test_draft_ungrounded_falls_back(ai, description, hints):
    ai(payload={"description": description, "hints": hints})
    res = generate_draft(DRAFT)
    assert res["mode"] == "rules" and res["limitations"][0] == "AI 초안이 입력한 정보와 맞지 않아 기본 초안을 보여드려요."


def test_draft_drops_unsupported_hints_only(ai):
    ai(payload={"description": "공대 후문 앞 원룸이에요.", "hints": {"deposit": 5000000, "maintenance": 50000}})
    res = generate_draft(DRAFT)
    assert res["mode"] == "ai" and res["hints"] == {"maintenance": 50000}  # 게시글에 없는 보증금 500만은 버림


def test_draft_free_maintenance_is_zero(ai):
    req = DraftRequest(title="후문 원룸", rent=250000, pastedListingText="보증금 100만, 관리비 없음")
    ai(payload={"description": "보증금 100만원, 월세 25만원이고 관리비는 0원이에요.", "hints": {"deposit": 1000000, "maintenance": 0}})
    res = generate_draft(req)
    assert res["mode"] == "ai" and res["hints"] == {"deposit": 1000000, "maintenance": 0}


# ── API 경로 (메모리 SQLite) ────────────────────────────────────────
@compiles(JSONB, "sqlite")
def _jsonb_on_sqlite(_type, _compiler, **_kw):
    return "JSON"


def _utc_on_load(target, _context):
    for name in ("expires_at", "last_seen_at", "created_at"):
        value = getattr(target, name, None)
        if value is not None and value.tzinfo is None:
            set_committed_value(target, name, value.replace(tzinfo=timezone.utc))


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    models = (UserRow, SessionRow, RoomRow)
    for m in models:
        event.listen(m, "load", _utc_on_load)
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=[m.__table__ for m in models])
    maker = sessionmaker(bind=engine)
    with maker() as s:
        for r in (A, B):
            s.add(RoomRow(id=r["id"], title=r["title"], neighborhood=r["neighborhood"], description=r["description"],
                          lat=r["coordinates"]["lat"], lng=r["coordinates"]["lng"], deposit=r["deposit"], rent=r["rent"],
                          maintenance=r["maintenance"], area=r["area"], floor=r["floor"], options=r["options"],
                          near_commercial=r["nearCommercial"], photos=r["photos"], school_distance=r["schoolDistance"],
                          facilities=r["facilities"], distance_source=r["distanceSource"], source=r["source"],
                          status="published"))
        s.add(RoomRow(id="hidden-1", title="숨김", status="hidden", photos=[], options={}, facilities=[]))
        s.commit()

    def override():
        with maker() as s:
            yield s

    app.dependency_overrides[get_db] = override
    _hits.clear()
    yield TestClient(app, headers={"Origin": ORIGIN})
    app.dependency_overrides.pop(get_db, None)
    for m in models:
        event.remove(m, "load", _utc_on_load)


def csrf(c):
    return {"X-CSRF-Token": c.get("/api/v1/auth/csrf").json()["token"]}


def register(c, role):
    email = f"ai-{role}-{uuid.uuid4().hex[:6]}@example.com"
    res = c.post("/api/v1/auth/register", headers=csrf(c),
                 json={"email": email, "password": "abcd1234", "role": role, "agreed": True})
    assert res.status_code == 200


def test_recommendations_route(client):
    body = {"roomIds": ["sun-01", "sun-02"], "filters": {"options": []}, "prompt": "가까운 방"}
    res = client.post("/api/v1/recommendations", json=body, headers=csrf(client))  # 비회원 가능
    assert res.status_code == 200 and res.json()["mode"] == "rules"
    assert [i["roomId"] for i in res.json()["items"]] == ["sun-01", "sun-02"]
    assert client.post("/api/v1/recommendations", json=body).status_code == 403  # CSRF 없음
    for ids, code in ((["sun-01", "hidden-1"], 404), (["sun-01", "nope"], 404),
                      (["sun-01", "sun-01"], 422), (["sun-01", "sun-02", "hidden-1"], 422), ([], 422)):
        assert client.post("/api/v1/recommendations", json=body | {"roomIds": ids}, headers=csrf(client)).status_code == code
    assert client.post("/api/v1/recommendations", json=body | {"prompt": "가" * 501},
                       headers=csrf(client)).status_code == 422


def test_draft_route_landlord_only(client):
    body = {"title": "정문 원룸", "rent": 320000, "pastedListingText": "보증금 300만"}
    assert client.post("/api/v1/rooms/draft", json=body, headers=csrf(client)).status_code == 401
    register(client, "seeker")
    assert client.post("/api/v1/rooms/draft", json=body, headers=csrf(client)).status_code == 403
    landlord = TestClient(app, headers={"Origin": ORIGIN})
    register(landlord, "landlord")
    res = landlord.post("/api/v1/rooms/draft", json=body, headers=csrf(landlord))
    assert res.status_code == 200 and res.json()["mode"] == "rules" and res.json()["hints"] == {"deposit": 3000000}
    assert landlord.post("/api/v1/rooms/draft", json=body | {"pastedListingText": "가" * 2001},
                         headers=csrf(landlord)).status_code == 422
