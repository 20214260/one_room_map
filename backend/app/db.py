import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()

# Supabase 대시보드 > Connect > Session pooler 연결 문자열
# 예: postgresql+psycopg://postgres.<ref>:<비밀번호>@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres
url = os.environ["DATABASE_URL"]
# Supabase에서 복사한 postgresql:// 주소도 그대로 쓸 수 있게 드라이버를 psycopg(v3)로 고정
if url.startswith("postgresql://"):
    url = "postgresql+psycopg://" + url[len("postgresql://"):]
engine = create_engine(url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
