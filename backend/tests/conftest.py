"""테스트 파일보다 먼저 .env 를 읽음.

DB 없이 도는 테스트(test_ai·test_oauth·test_verification)는 DATABASE_URL 이 없을 때만 자리표시자를 넣음.
이 파일이 없으면 이름순으로 먼저 실행되는 test_ai 의 자리표시자가 진짜 주소보다 먼저 자리를 잡아
뒤에 오는 실DB 테스트가 localhost 에 접속하려다 멈춤.
"""

from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
