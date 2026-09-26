"""Gemini 호출 (REST). 키는 서버 .env 에만 두고 프론트·응답·로그에 넣지 않음.

필요한 .env
  GEMINI_API_KEY=...            (Google AI Studio 에서 발급. 비어 있으면 AI 없이 규칙 기반으로 동작)
  GEMINI_MODEL=gemini-3.8-flash (선택)
  GEMINI_FALLBACK_MODEL=gemini-3.5-flash (선택. 기본 모델이 혼잡(503)·시간 초과일 때 한 번 더 시도, 비우면 재시도 안 함)

호출하는 쪽은 AiUnavailable 을 잡아서 규칙 기반 결과로 대체해야 함 (API_CONTRACT: 실패는 mode: rules).
"""

import json
import os

import httpx

API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MODEL = "gemini-3.8-flash"
DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash"
# 프론트 AI 요청 제한(20초) 안에 두 번 시도가 끝나도록
ATTEMPT_TIMEOUT = 9.0

# 테스트에서 httpx.MockTransport 로 바꿔 끼움
transport: httpx.BaseTransport | None = None


class AiUnavailable(Exception):
    """AI 결과를 쓸 수 없음. reason: not_configured | timeout | rate_limited | error | invalid_output"""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def configured() -> bool:
    return bool(os.getenv("GEMINI_API_KEY"))


def _models() -> list[str]:
    primary = os.getenv("GEMINI_MODEL") or DEFAULT_MODEL
    fallback = os.getenv("GEMINI_FALLBACK_MODEL", DEFAULT_FALLBACK_MODEL)
    return [primary] + ([fallback] if fallback and fallback != primary else [])


def generate_json(system: str, prompt: str, schema: dict, timeout: float = ATTEMPT_TIMEOUT) -> dict:
    """JSON 스키마로 제한한 응답을 dict 로 반환. 실패하면 AiUnavailable."""
    key = os.getenv("GEMINI_API_KEY", "")
    if not key:
        raise AiUnavailable("not_configured")
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": schema,
            "temperature": 0.2,
        },
    }
    reason = "error"
    with httpx.Client(transport=transport, timeout=timeout) as client:
        for model in _models():
            try:
                res = client.post(API.format(model=model), headers={"x-goog-api-key": key}, json=body)
            except httpx.TimeoutException:
                reason = "timeout"
                continue  # 느린 모델 대신 예비 모델로
            except httpx.HTTPError:
                raise AiUnavailable("error")
            if res.status_code in (500, 503):
                reason = "error"
                continue  # 일시적 혼잡 → 예비 모델로
            if res.status_code == 429:
                raise AiUnavailable("rate_limited")
            if res.status_code != 200:
                raise AiUnavailable("error")
            return _parse(res)
    raise AiUnavailable(reason)


def _parse(res: httpx.Response) -> dict:
    try:
        parts = res.json()["candidates"][0]["content"]["parts"]
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        data = json.loads(text)
    except (KeyError, IndexError, TypeError, ValueError):
        raise AiUnavailable("invalid_output")
    if not isinstance(data, dict):
        raise AiUnavailable("invalid_output")
    return data
