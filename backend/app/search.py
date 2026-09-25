"""매물 검색·정렬. 프론트 src/domain/rooms.ts 의 searchRooms / criteria 와 동작이 같아야 함.

mock 모드와 http 모드에서 같은 조건이면 같은 결과가 나오도록, 로직을 바꿀 땐 두 파일을 같이 고칠 것.
"""

from typing import Literal

from pydantic import BaseModel, Field, NonNegativeInt, model_validator

OptionId = Literal["aircon", "washer", "fridge", "induction", "desk", "closet", "elevator"]
FacilityId = Literal["convenience", "market", "bus"]
SortId = Literal["match", "monthly", "deposit", "distance", "area"]

# 팀 합의 전 임시 기준 (프론트 FACILITY_LIMIT_METERS 와 동일)
FACILITY_LIMIT_METERS = 500


class Filters(BaseModel):
    maxRent: NonNegativeInt | None = None
    maxMaintenance: NonNegativeInt | None = None
    maxDeposit: NonNegativeInt | None = None
    nearCommercial: bool | None = None
    options: list[OptionId] = []
    facilities: list[FacilityId] = []


class Bounds(BaseModel):
    south: float
    north: float
    west: float
    east: float

    @model_validator(mode="after")
    def check_order(self):
        if not (self.south < self.north and self.west < self.east):
            raise ValueError("bounds 범위가 올바르지 않음")
        return self


class Search(BaseModel):
    query: str = Field(default="", max_length=100)
    sort: SortId = "match"
    filters: Filters = Filters()
    bounds: Bounds | None = None
    onlyMatches: bool = False


def monthly_cost(room: dict) -> int | None:
    if room["rent"] is None or room["maintenance"] is None:
        return None
    return room["rent"] + room["maintenance"]


def criteria(room: dict, f: Filters) -> list[bool]:
    checks: list[bool] = []
    for limit, value in (
        (f.maxRent, room["rent"]),
        (f.maxMaintenance, room["maintenance"]),
        (f.maxDeposit, room["deposit"]),
    ):
        if limit is not None:
            checks.append(value is not None and value <= limit)
    if f.nearCommercial is not None:
        checks.append(room["nearCommercial"] == f.nearCommercial)
    for opt in f.options:
        checks.append(room["options"].get(opt) is True)
    for fac in f.facilities:
        checks.append(
            any(
                x["type"] == fac
                and x.get("distance") is not None
                and x["distance"] <= FACILITY_LIMIT_METERS
                for x in room["facilities"]
            )
        )
    return checks


def matches(room: dict, f: Filters) -> bool:
    return all(criteria(room, f))


def search_rooms(rooms: list[dict], s: Search) -> list[dict]:
    q = s.query.strip().lower()
    b = s.bounds

    def keep(r: dict) -> bool:
        if not r["published"]:
            return False
        if q and q not in f"{r['title']} {r['neighborhood']} {r['description']}".lower():
            return False
        if b:
            c = r["coordinates"]
            if not c or not (b.south <= c["lat"] <= b.north and b.west <= c["lng"] <= b.east):
                return False
        if s.onlyMatches and not matches(r, s.filters):
            return False
        return True

    def value(r: dict) -> float | None:
        if s.sort == "monthly":
            return monthly_cost(r)
        if s.sort == "distance":
            return r["schoolDistance"]
        if s.sort == "deposit":
            return r["deposit"]
        if s.sort == "area":
            return None if r["area"] is None else -r["area"]
        return -sum(criteria(r, s.filters))

    # 값 오름차순, 미상(null)은 마지막, 동률은 ID 순
    def key(r: dict):
        v = value(r)
        return (v is None, v if v is not None else 0, r["id"])

    return sorted(filter(keep, rooms), key=key)
