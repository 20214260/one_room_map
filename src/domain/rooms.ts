import {
  emptyFilters,
  FiltersSchema,
  optionIds,
  type Filters,
  type Room,
  type Search,
  type Recommendation,
  type RoomSubmission,
} from '../contracts/schemas';
export function monthlyCost(room: Pick<Room, 'rent' | 'maintenance'>): number | null {
  return room.rent === null || room.maintenance === null ? null : room.rent + room.maintenance;
}
export function money(value: number | null): string {
  return value === null
    ? '정보 없음'
    : `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(value / 10000)}만`;
}
export function distance(value: number | null): string {
  return value === null
    ? '정보 없음'
    : value >= 1000
      ? `${(value / 1000).toFixed(1)}km`
      : `${value}m`;
}
// Proposed threshold, visible in filters and integration docs.
export const FACILITY_LIMIT_METERS = 500;
export function criteria(room: Room, f: Filters): boolean[] {
  const checks: boolean[] = [];
  for (const [limit, value] of [
    [f.maxRent, room.rent],
    [f.maxMaintenance, room.maintenance],
    [f.maxDeposit, room.deposit],
  ])
    if (limit !== null) checks.push(value !== null && value <= limit);
  if (f.nearCommercial !== null) checks.push(room.nearCommercial === f.nearCommercial);
  f.options.forEach((id) => checks.push(room.options[id] === true));
  f.facilities.forEach((id) =>
    checks.push(
      room.facilities.some(
        (x) => x.type === id && x.distance !== null && x.distance <= FACILITY_LIMIT_METERS,
      ),
    ),
  );
  return checks;
}
export function matches(room: Room, f: Filters): boolean {
  return criteria(room, f).every(Boolean);
}
export function filterCount(f: Filters) {
  return (
    [f.maxRent, f.maxMaintenance, f.maxDeposit, f.nearCommercial].filter((x) => x !== null).length +
    f.options.length +
    f.facilities.length
  );
}
export function searchRooms(rooms: Room[], s: Search): Room[] {
  const q = s.query.trim().toLocaleLowerCase(),
    b = s.bounds;
  const out = rooms.filter(
    (r) =>
      r.published &&
      (!q || `${r.title} ${r.neighborhood} ${r.description}`.toLocaleLowerCase().includes(q)) &&
      (!b ||
        (!!r.coordinates &&
          r.coordinates.lat >= b.south &&
          r.coordinates.lat <= b.north &&
          r.coordinates.lng >= b.west &&
          r.coordinates.lng <= b.east)) &&
      (!s.onlyMatches || matches(r, s.filters)),
  );
  function value(r: Room): number | null {
    if (s.sort === 'monthly') return monthlyCost(r);
    if (s.sort === 'distance') return r.schoolDistance;
    if (s.sort === 'deposit') return r.deposit;
    if (s.sort === 'area') return r.area === null ? null : -r.area;
    return -criteria(r, s.filters).filter(Boolean).length;
  }
  return out.sort(
    (a, b) => (value(a) ?? Infinity) - (value(b) ?? Infinity) || a.id.localeCompare(b.id),
  );
}
export function parseBudget(raw: string, maximum = 1000000): number | null {
  if (!raw.trim()) return null;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > maximum)
    throw new Error(`0~${maximum.toLocaleString()} 사이의 정수를 입력해 주세요.`);
  return Number(raw) * 10000;
}
export function toggleComparison(ids: string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  if (ids.length >= 2)
    throw new Error('비교는 최대 2개까지 가능해요. 먼저 선택한 방을 해제해 주세요.');
  return [...ids, id];
}
export function compareWinner(
  a: number | null,
  b: number | null,
  d: 'lower' | 'higher' | 'none',
): 0 | 1 | null {
  if (a === null || b === null || a === b || d === 'none') return null;
  return d === 'lower' ? (a < b ? 0 : 1) : a > b ? 0 : 1;
}
export function rulesSummary(
  rooms: Room[],
  filters: Filters,
  reason: string | null = null,
): Recommendation {
  return {
    mode: 'rules',
    summary:
      '월세와 관리비, 학교까지의 거리부터 비교해 보세요. 종합 점수 대신 확인된 항목만 정리했어요.',
    items: rooms.map((r) => {
      const costs = monthlyCost(r),
        c = criteria(r, filters);
      return {
        roomId: r.id,
        reasons: [
          ...(costs !== null
            ? [{ field: 'monthly' as const, text: `월세 + 관리비 ${money(costs)}원 / 월` }]
            : []),
          ...(r.schoolDistance !== null
            ? [
                {
                  field: 'schoolDistance' as const,
                  text: `학교까지 도보 경로 ${distance(r.schoolDistance)}`,
                },
              ]
            : []),
        ],
        tradeoffs: [
          ...(costs === null
            ? [
                {
                  field: 'monthly' as const,
                  text: '비용 정보가 부족해 월 부담액을 계산할 수 없어요.',
                },
              ]
            : []),
          ...(c.length && !c.every(Boolean)
            ? [
                {
                  field: 'options' as const,
                  text: '선택한 조건 중 충족하지 않거나 확인되지 않은 항목이 있어요.',
                },
              ]
            : []),
        ],
      };
    }),
    limitations: [
      '월 부담액은 월세 + 관리비이며, 보증금 이자·개별 공과금은 포함하지 않아요.',
      ...(rooms.some((r) => r.source.kind === 'sample')
        ? ['샘플 매물의 비교 예시예요. 실제 매물·실측 거리 정보가 아니에요.']
        : []),
      '자연어의 선호와 종합 순위는 규칙 기반 요약에 반영하지 않아요.',
    ],
    fallbackReason: reason,
  };
}
export function readFilters(params: URLSearchParams): Filters {
  try {
    return FiltersSchema.parse(JSON.parse(params.get('filters') ?? JSON.stringify(emptyFilters)));
  } catch {
    return { ...emptyFilters };
  }
}
export function safeReturnPath(raw: string | null): string {
  return raw?.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\') ? raw : '/';
}
// 정확 주소를 안 받는 대신 쓰는 대략적 앵커. 실서비스에선 카카오 지오코딩으로 대체.
const zoneAnchors: Record<RoomSubmission['locationHint']['zone'], { lat: number; lng: number } | null> = {
  'front-gate': { lat: 34.9716, lng: 127.4801 },
  'back-gate': { lat: 34.9702, lng: 127.4849 },
  other: null,
};
export function submissionToRoom(input: RoomSubmission, id: string): Room {
  const options = Object.fromEntries(
    optionIds.map((key) => [key, input.options?.[key] ?? null]),
  ) as Room['options'];
  return {
    id,
    title: input.title,
    neighborhood: input.locationHint.detail,
    description: input.description ?? '',
    coordinates: zoneAnchors[input.locationHint.zone],
    deposit: input.deposit ?? null,
    rent: input.rent,
    maintenance: input.maintenance ?? null,
    area: input.area ?? null,
    floor: input.floor ?? null,
    options,
    nearCommercial: null,
    photos: input.photos ?? [],
    schoolDistance: null,
    facilities: [],
    distanceSource: null,
    source: {
      name: '집주인·부동산 직접 등록',
      url: null,
      collectedAt: new Date().toISOString().slice(0, 10),
      license: '등록자 제공',
      kind: 'owner',
      note: '등록자가 직접 입력한 정보이며 아직 좌표·도보거리는 검증 전이에요.',
    },
    published: true,
  };
}
// 기존 게시판 글을 붙여넣었을 때 흔한 패턴(보증금/월세/관리비/연락처)을 뽑아내는 가벼운 보조 함수.
// 실제 서비스에서는 Gemini가 이 자리를 대신하고, 이건 AI 연결 전 샘플 동작용.
export function extractListingHints(text: string): {
  deposit: number | null;
  rent: number | null;
  maintenance: number | null;
  phone: string | null;
} {
  const won = (raw: string) => Number(raw.replace(/,/g, '')) * 10000;
  const deposit = text.match(/보증금\s*[:\s]*([\d,]+)\s*만/)?.[1];
  const rent = text.match(/월세\s*[:\s]*([\d,]+)\s*만/)?.[1];
  const maintenance = text.match(/관리비\s*[:\s]*([\d,]+)\s*만/)?.[1];
  const phone = text.match(/01[016789]-?\d{3,4}-?\d{4}/)?.[0] ?? null;
  return {
    deposit: deposit ? won(deposit) : null,
    rent: rent ? won(rent) : null,
    maintenance: maintenance ? won(maintenance) : null,
    phone,
  };
}
