"""배포용: 정적으로 내보낸 프론트(`dist/client`)를 API 와 같은 포트에서 서비스.

대회 서버는 팀당 포트가 하나(INTERNAL_PORT)라 FastAPI 가 /api/v1 과 화면을 같이 맡음.
FRONTEND_DIST 가 비어 있으면(로컬 개발) 아무것도 등록하지 않음 → 기존 vite 개발 서버 그대로 사용.

- /_next/static/...  : 파일 그대로 (이름에 해시가 있어 오래 캐시)
- /admin 등 페이지    : admin.html
- 페이지 이동(RSC: 1 헤더) : admin.rsc (vinext 클라이언트 내비게이션 데이터)
- 없는 경로           : 404.html
"""

import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response

IMMUTABLE = "public, max-age=31536000, immutable"
# 빌드 결과물 중 공개하지 않을 것 (Cloudflare 설정, 빌드 매니페스트)
HIDDEN = {".vite", "_headers", ".assetsignore"}


def mount_frontend(app: FastAPI) -> None:
    raw = os.getenv("FRONTEND_DIST", "").strip()
    if not raw:
        return
    root = Path(raw).resolve()
    if not (root / "index.html").is_file():
        raise RuntimeError(f"FRONTEND_DIST 에 index.html 이 없음: {root}")

    def safe(rel: str) -> Path | None:
        target = (root / rel).resolve()
        if target != root and root not in target.parents:
            return None  # ../ 로 폴더 밖 접근 차단
        if rel.split("/", 1)[0] in HIDDEN:
            return None
        return target if target.is_file() else None

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str, request: Request):
        path = path.strip("/")
        if path.startswith("api/"):
            return Response(status_code=404)  # 없는 API 는 화면 대신 404
        if request.headers.get("rsc") == "1":
            rsc = safe(f"{path or 'index'}.rsc")
            if rsc:
                return FileResponse(rsc, media_type="text/x-component", headers={"Cache-Control": "no-cache"})
            return Response(status_code=404)
        if path and (asset := safe(path)):
            cache = IMMUTABLE if path.startswith("_next/static/") else "no-cache"
            return FileResponse(asset, headers={"Cache-Control": cache})
        page = safe(f"{path}.html") if path else root / "index.html"
        if page:
            return FileResponse(page, media_type="text/html", headers={"Cache-Control": "no-cache"})
        return FileResponse(root / "404.html", status_code=404, media_type="text/html")
