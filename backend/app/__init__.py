# .env 는 어떤 모듈보다 먼저 읽어야 COOKIE_SECURE, FRONTEND_ORIGINS 같은 설정이 반영됨
from dotenv import load_dotenv

load_dotenv()
