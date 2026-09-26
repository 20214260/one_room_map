"""집주인 인증 테스트. 실제 DB·Supabase 없이 실행됨 (메모리 SQLite, 증빙은 임시 폴더).

OWNER_VERIFICATION_HANDOFF 완료 조건:
새 집주인 가입 → 신청 전/심사 중 등록 API 403 → 관리자 승인 → 등록 가능.
일반 사용자·다른 집주인은 남의 신청을 볼 수 없고, 관리자만 결정할 수 있음.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://x:x@localhost:5432/x")

import io
import uuid
from datetime import timezone

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.attributes import set_committed_value
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import OwnerVerificationRow, RoomRow, SessionRow, UserRow
from app.routers import owner as owner_router
from app.security import _hits

ORIGIN = "http://127.0.0.1:5173"
ADMIN_EMAIL = "admin@example.com"
PDF = b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"
SUBMISSION = {
    "title": "정문 1분 풀옵션 원룸",
    "locationHint": {"zone": "front-gate", "detail": "공대 후문 도보 3분"},
    "rent": 320000,
    "contact": {"method": "phone", "value": "010-1234-5678"},
}


@compiles(JSONB, "sqlite")
def _jsonb_on_sqlite(_type, _compiler, **_kw):
    return "JSON"


def _utc_on_load(target, _context):
    """SQLite 는 timestamptz 를 시간대 없이 돌려줌. 운영(Postgres)과 같게 UTC 로 맞춤."""
    for name in ("expires_at", "last_seen_at", "created_at", "submitted_at", "reviewed_at"):
        value = getattr(target, name, None)
        if value is not None and value.tzinfo is None:
            set_committed_value(target, name, value.replace(tzinfo=timezone.utc))


MODELS = (UserRow, SessionRow, OwnerVerificationRow, RoomRow)


@pytest.fixture
def db(monkeypatch, tmp_path):
    monkeypatch.setenv("ADMIN_EMAILS", ADMIN_EMAIL)
    monkeypatch.setenv("PROOF_DIR", str(tmp_path / "proofs"))
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)  # 증빙은 로컬 비공개 폴더로
    for model in MODELS:
        event.listen(model, "load", _utc_on_load)
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=[m.__table__ for m in MODELS])
    maker = sessionmaker(bind=engine)

    def override():
        s = maker()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = override
    _hits.clear()
    s = maker()
    yield s
    s.close()
    app.dependency_overrides.pop(get_db, None)
    for model in MODELS:
        event.remove(model, "load", _utc_on_load)


def csrf(c):
    return {"X-CSRF-Token": c.get("/api/v1/auth/csrf").json()["token"]}


def make_user(role, email=None):
    c = TestClient(app, headers={"Origin": ORIGIN})
    email = email or f"t-{role}-{uuid.uuid4().hex[:8]}@example.com"
    res = c.post("/api/v1/auth/register", headers=csrf(c),
                 json={"email": email, "password": "abcd1234", "role": role, "agreed": True})
    assert res.status_code == 200, res.text
    c.user = res.json()
    return c


def apply(c, data=PDF, name="proof.pdf", mime="application/pdf", **fields):
    form = {"ownerName": "홍길동", "buildingAddress": "전남 순천시 중앙로 255", "consent": "true"} | fields
    return c.post("/api/v1/owner/verification", headers=csrf(c), data=form,
                  files={"proof": (name, data, mime)})


def status(c):
    res = c.get("/api/v1/owner/verification")
    assert res.status_code == 200
    return res.json()


def decide(admin, c, decision, message=None, application_id=None):
    app_id = application_id or status(c)["applicationId"]
    return admin.post(f"/api/v1/admin/verifications/{c.user['id']}/decision", headers=csrf(admin),
                      json={"applicationId": app_id, "status": decision, "message": message})


def owner_writes(c, room_id):
    """승인이 필요한 쓰기 API 전부의 상태 코드."""
    h = csrf(c)
    return {
        "submit": c.post("/api/v1/rooms", json=SUBMISSION, headers=h).status_code,
        "update": c.patch(f"/api/v1/owner/rooms/{room_id}", json=SUBMISSION, headers=h).status_code,
        "status": c.patch(f"/api/v1/owner/rooms/{room_id}/status", json={"status": "hidden"}, headers=h).status_code,
        "photo": c.post("/api/v1/owner/photos", headers=h, files={"file": ("a.jpg", _jpeg(), "image/jpeg")}).status_code,
        "delete": c.delete(f"/api/v1/owner/rooms/{room_id}", headers=h).status_code,
    }


def _jpeg():
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 180, 150)).save(buf, "JPEG")
    return buf.getvalue()


def _own_room(db, c):
    """승인 전부터 있던 매물 (기존 계정 가정). 수정·삭제 차단 확인용."""
    room_id = f"owner-{uuid.uuid4().hex[:12]}"
    db.add(RoomRow(id=room_id, title="기존 매물", owner_id=uuid.UUID(c.user["id"]), status="published",
                   rent=300000, photos=[], options={}, facilities=[], zone="front-gate", location_detail="정문"))
    db.commit()
    return room_id


@pytest.fixture
def fake_photo_storage(monkeypatch):
    monkeypatch.setattr(owner_router, "upload_photo", lambda uid, jpeg: f"https://example.com/{uid}.jpg")


def test_full_flow_new_landlord_to_approved(db, fake_photo_storage):
    landlord, admin = make_user("landlord"), make_user("seeker", ADMIN_EMAIL)

    # 가입 직후 not_submitted 가 DB 에 저장됨
    assert db.get(OwnerVerificationRow, uuid.UUID(landlord.user["id"])).status == "not_submitted"
    assert status(landlord) == {"status": "not_submitted", "applicationId": None, "submittedAt": None, "message": None}

    # 신청 전: 모든 쓰기 API 403 VERIFICATION_REQUIRED
    room_id = _own_room(db, landlord)
    assert set(owner_writes(landlord, room_id).values()) == {403}
    res = landlord.post("/api/v1/rooms", json=SUBMISSION, headers=csrf(landlord))
    assert res.json()["error"]["code"] == "VERIFICATION_REQUIRED"

    # 신청 → 심사 중. 여전히 403, 심사 중 재신청 409
    res = apply(landlord)
    assert res.status_code == 200, res.text
    s = res.json()
    assert s["status"] == "reviewing" and s["applicationId"] and s["submittedAt"].endswith("Z")
    assert set(s) == {"status", "applicationId", "submittedAt", "message"}  # 이름·주소·서류 경로 비노출
    assert set(owner_writes(landlord, room_id).values()) == {403}
    assert apply(landlord).status_code == 409

    # 관리자 목록·증빙 확인
    items = admin.get("/api/v1/admin/verifications").json()["items"]
    mine = next(i for i in items if i["userId"] == landlord.user["id"])
    assert mine["ownerName"] == "홍길동" and mine["proof"]["mime"] == "application/pdf"
    assert mine["aiReview"] is None  # AI 미연결 → 관리자가 직접 심사
    proof = admin.get(f"/api/v1/admin/verifications/{landlord.user['id']}/proof")
    assert proof.status_code == 200 and proof.content == PDF
    assert proof.headers["cache-control"] == "no-store" and "attachment" in proof.headers["content-disposition"]

    # 관리자 승인 → 등록 가능
    assert decide(admin, landlord, "approved").status_code == 200
    assert status(landlord)["status"] == "approved"
    assert owner_writes(landlord, room_id) == {"submit": 200, "update": 200, "status": 200, "photo": 200, "delete": 204}


def test_only_admin_decides_and_others_cannot_see(db):
    landlord, other = make_user("landlord"), make_user("landlord")
    seeker, admin = make_user("seeker"), make_user("seeker", ADMIN_EMAIL)
    assert apply(landlord).status_code == 200
    app_id = status(landlord)["applicationId"]

    # 일반 사용자는 인증 API 자체를 못 씀
    assert seeker.get("/api/v1/owner/verification").status_code == 403
    assert apply(seeker).status_code == 403
    # 다른 집주인은 자기 상태만 보임 (남의 신청을 지정할 경로가 없음)
    assert status(other)["status"] == "not_submitted" and status(other)["applicationId"] != app_id
    # 관리자 API 는 관리자만
    for c in (landlord, other, seeker):
        assert c.get("/api/v1/admin/verifications").status_code == 403
        assert c.get(f"/api/v1/admin/verifications/{landlord.user['id']}/proof").status_code == 403
        assert decide(c, landlord, "approved", application_id=app_id).status_code == 403
    # 비로그인
    anon = TestClient(app, headers={"Origin": ORIGIN})
    assert anon.get("/api/v1/owner/verification").status_code == 401
    assert anon.get("/api/v1/admin/verifications").status_code == 401
    assert status(landlord)["status"] == "reviewing"


def test_admin_decision_rules(db):
    landlord, admin = make_user("landlord"), make_user("seeker", ADMIN_EMAIL)
    assert apply(landlord).status_code == 200
    first = status(landlord)["applicationId"]

    assert decide(admin, landlord, "approved", application_id=str(uuid.uuid4())).status_code == 409
    assert decide(admin, landlord, "needs_info").status_code == 422  # 사유 필수
    res = decide(admin, landlord, "needs_info", "등기사항증명서 전체 페이지를 올려 주세요.")
    assert res.status_code == 200
    s = status(landlord)
    assert s["status"] == "needs_info" and s["message"] == "등기사항증명서 전체 페이지를 올려 주세요."
    assert decide(admin, landlord, "approved", application_id=first).status_code == 409  # reviewing 아님

    # 보완 후 재신청 → 새 신청 번호, 이전 증빙 파일 삭제
    old_path = db.get(OwnerVerificationRow, uuid.UUID(landlord.user["id"])).proof_path
    assert apply(landlord).status_code == 200
    db.expire_all()
    row = db.get(OwnerVerificationRow, uuid.UUID(landlord.user["id"]))
    assert str(row.application_id) != first and row.message is None and row.proof_path != old_path
    assert not (__import__("pathlib").Path(os.environ["PROOF_DIR"]) / old_path.split(":", 1)[1]).exists()

    assert decide(admin, landlord, "approved").status_code == 200
    assert apply(landlord).status_code == 409  # 승인 후 재신청 불가
    # 권한 철회 → 다시 등록 불가
    assert decide(admin, landlord, "rejected", "소유권 확인 불가").status_code == 200
    res = landlord.post("/api/v1/rooms", json=SUBMISSION, headers=csrf(landlord))
    assert res.status_code == 403 and res.json()["error"]["code"] == "VERIFICATION_REQUIRED"


def test_admin_cannot_approve_self(db):
    admin = make_user("landlord", ADMIN_EMAIL)
    assert apply(admin).status_code == 200
    assert decide(admin, admin, "approved").status_code == 403


def test_client_cannot_set_status(db):
    landlord = make_user("landlord")
    res = apply(landlord, status="approved")  # 알 수 없는 필드는 무시
    assert res.json()["status"] == "reviewing"
    res = landlord.patch("/api/v1/owner/verification", headers=csrf(landlord), json={"status": "approved"})
    assert res.status_code == 405


@pytest.mark.parametrize("data,name,mime,code", [
    (b"", "a.pdf", "application/pdf", 422),
    (b"<?php system($_GET['c']); ?>", "a.pdf", "application/pdf", 415),
    (PDF, "a.png", "image/png", 415),  # 형식 위장
    (PDF.replace(b"/Catalog", b"/Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >>"), "a.pdf", "application/pdf", 422),
    (PDF.replace(b"/Catalog", b"/Catalog /Names << /J#61vaScript 2 0 R >>"), "a.pdf", "application/pdf", 422),
    (PDF.replace(b"/Catalog", b"/Catalog /Encrypt 3 0 R"), "a.pdf", "application/pdf", 422),
    (b"%PDF-1.7\n" + b"0" * 100, "a.pdf", "application/pdf", 422),  # 끝 표시 없음
    (b"%PDF-1.7\n" + b"0" * (5 * 1024 * 1024) + b"%%EOF", "a.pdf", "application/pdf", 413),
    (b"\x89PNG\r\n\x1a\n" + b"garbage", "a.png", "image/png", 422),
], ids=["empty", "php", "pdf-as-png", "pdf-js", "pdf-hex-name", "pdf-encrypted", "pdf-no-eof",
        "too-large", "broken-png"])
def test_proof_file_checks(db, data, name, mime, code):
    landlord = make_user("landlord")
    assert apply(landlord, data=data, name=name, mime=mime).status_code == code
    assert status(landlord)["status"] == "not_submitted"


def test_image_proof_reencoded_without_metadata(db):
    landlord, admin = make_user("landlord"), make_user("seeker", ADMIN_EMAIL)
    img = Image.new("RGB", (60, 40), (255, 255, 255))
    exif = Image.Exif()
    exif[0x010F] = "SecretCamera"
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    assert apply(landlord, data=buf.getvalue() + b"TRAILING-PAYLOAD", name="a.jpg", mime="image/jpeg").status_code == 200
    stored = admin.get(f"/api/v1/admin/verifications/{landlord.user['id']}/proof").content
    assert b"SecretCamera" not in stored and b"TRAILING-PAYLOAD" not in stored
    assert Image.open(io.BytesIO(stored)).format == "JPEG"


def test_invalid_form_rejected(db):
    landlord = make_user("landlord")
    assert apply(landlord, consent="false").status_code == 422
    assert apply(landlord, ownerName="홍").status_code == 422
    assert apply(landlord, buildingAddress="순천").status_code == 422
