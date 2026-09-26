"""실DB 테스트 공용: 새로 가입한 집주인을 인증 승인 상태로 만듦 (sql/005 적용 필요).

인증 신청·심사 흐름 자체는 test_verification.py 에서 확인함.
"""

from sqlalchemy import text

from app.db import engine


def approve_landlord(user_id: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("insert into owner_verifications (user_id, status) values (cast(:id as uuid), 'approved') "
                 "on conflict (user_id) do update set status = 'approved'"),
            {"id": user_id},
        )
