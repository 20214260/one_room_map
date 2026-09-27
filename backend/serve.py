"""배포 서버 실행 진입점 (Supervisor 가 실행). 로컬 개발은 README 의 uvicorn --reload 그대로.

backend/.env 의 INTERNAL_HOST / INTERNAL_PORT 로 수신 (대회 서버: 127.0.0.1:3107).
대회 서버 nginx 는 화면(~/html)을 직접 서비스하고 /api/* 만 이 앱으로 넘기면서 앞의 /api 를 뗌
(/api/v1/rooms → /v1/rooms). API_PATH_PREFIX=/api 면 떼어진 접두사를 다시 붙여 기존 라우트 그대로 처리.
HTTPS 는 앞단 프록시가 처리하므로 프록시 헤더(X-Forwarded-*)는 로컬 프록시에서 온 것만 신뢰.
"""

import os
from pathlib import Path

import uvicorn
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))


class RestorePrefix:
    """프록시가 떼어 낸 경로 접두사를 복원하는 ASGI 미들웨어."""

    def __init__(self, app, prefix: str):
        self.app, self.prefix = app, prefix.rstrip("/")

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket") and not scope["path"].startswith(self.prefix + "/"):
            scope = dict(scope, path=self.prefix + scope["path"],
                         raw_path=self.prefix.encode() + scope.get("raw_path", scope["path"].encode()))
        await self.app(scope, receive, send)


def create_app():
    from app.main import app

    prefix = os.getenv("API_PATH_PREFIX", "").strip()
    return RestorePrefix(app, prefix) if prefix else app


if __name__ == "__main__":
    import sys

    sys.path.insert(0, str(Path(__file__).parent))
    uvicorn.run(
        create_app(),
        host=os.getenv("INTERNAL_HOST", "127.0.0.1"),
        port=int(os.getenv("INTERNAL_PORT", "8000")),
        proxy_headers=True,
        forwarded_allow_ips="127.0.0.1",
    )
