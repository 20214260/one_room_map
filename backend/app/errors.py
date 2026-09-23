"""API_CONTRACT.md 오류 형식: {"error": {"code": ..., "message": ...}}

프론트는 code만 보고 문구를 고르므로 message에 DB/외부 API 오류 원문을 넣지 말 것.
"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiException(Exception):
    def __init__(self, status: int, code: str, message: str = ""):
        self.status, self.code, self.message = status, code, message


def _body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiException)
    async def api_error(_: Request, e: ApiException):
        return JSONResponse(_body(e.code, e.message), status_code=e.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, e: RequestValidationError):
        return JSONResponse(_body("INVALID_INPUT", "입력 형식 오류"), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, e: StarletteHTTPException):
        code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(e.status_code, "REQUEST_FAILED")
        return JSONResponse(_body(code, ""), status_code=e.status_code)

    @app.exception_handler(Exception)
    async def unknown_error(_: Request, e: Exception):
        return JSONResponse(_body("INTERNAL", "서버 오류"), status_code=500)
