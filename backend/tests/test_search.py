"""search.py 가 프론트 src/domain/rooms.ts 의 searchRooms 와 같은 결과를 내는지 확인.

fixture_frontend.json 은 프론트 코드를 직접 실행해서 뽑은 기대값 (mock 매물 6개 × 검색 120가지).
"""

import json
from pathlib import Path

import pytest

from app.search import Search, search_rooms

FIXTURE = json.loads((Path(__file__).parent / "fixture_frontend.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", FIXTURE["cases"])
def test_same_result_as_frontend(case):
    got = [r["id"] for r in search_rooms(FIXTURE["rooms"], Search.model_validate(case["search"]))]
    assert got == case["expected"]


def test_unpublished_room_hidden():
    rooms = [dict(FIXTURE["rooms"][0], published=False)] + FIXTURE["rooms"][1:]
    ids = [r["id"] for r in search_rooms(rooms, Search())]
    assert "sun-01" not in ids and len(ids) == 5
