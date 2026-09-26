"""POST /recommendations. 계약: docs/API_CONTRACT.md "AI 요청과 응답", schemas.ts RecommendationRequestSchema.

비회원도 사용 가능 (CSRF·Origin 은 같은 규칙). 매물 사실은 요청 본문이 아니라 DB 에서 다시 읽음.
"""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import ApiException
from ..models import PUBLIC_STATUS, RoomRow, to_room
from ..recommend import recommend
from ..search import Filters
from ..security import client_ip, rate_limit, verify_csrf

router = APIRouter(tags=["ai"])


class RecommendationRequest(BaseModel):
    roomIds: list[str] = Field(min_length=1, max_length=2)
    filters: Filters = Filters()
    prompt: str = Field(default="", max_length=500)

    @field_validator("roomIds")
    @classmethod
    def unique(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v):
            raise ValueError("중복 ID")
        return v


@router.post("/recommendations", dependencies=[Depends(verify_csrf)])
def recommendations(body: RecommendationRequest, request: Request, db: Session = Depends(get_db)):
    """→ Recommendation. 대상이 없거나 비공개면 404"""
    rate_limit(f"recommend:{client_ip(request)}", limit=20, per_seconds=600)
    rows = {r.id: r for r in db.scalars(select(RoomRow).where(RoomRow.id.in_(body.roomIds),
                                                                 RoomRow.status == PUBLIC_STATUS)).all()}
    if len(rows) != len(body.roomIds):
        raise ApiException(404, "NOT_FOUND", "매물 없음 또는 비공개")
    return recommend([to_room(rows[i]) for i in body.roomIds], body.filters, body.prompt)
