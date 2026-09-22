'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Search,
  SlidersHorizontal,
  ChevronDown,
  X,
  RotateCcw,
  Sparkles,
  Map,
  LayoutGrid,
  Info,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Header } from '../../shared/Header';
import { useApp } from '../../shared/AppProvider';
import {
  type Room,
  type Bounds,
  type Sort,
  emptyFilters,
  optionLabels,
  facilityLabels,
} from '../../contracts/schemas';
import { filterCount, matches, money } from '../../domain/rooms';
import { FilterDialog } from '../filters/FilterDialog';
import { RoomCard } from '../listings/RoomCard';
import { RoomDetail } from '../listings/RoomDetail';
import { RoomMap } from '../maps/RoomMap';
import { CompareBar } from '../compare/CompareBar';
import { ErrorState, EmptyState, LoadingCards } from '../../shared/Status';
export function Explorer() {
  const { api, filters, setFilters, config } = useApp();
  const [query, setQuery] = useState(''),
    [debounced, setDebounced] = useState(''),
    [sort, setSort] = useState<Sort>('match'),
    [bounds, setBounds] = useState<Bounds | null>(null),
    [onlyMatches, setOnlyMatches] = useState(false),
    [rooms, setRooms] = useState<Room[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [filterOpen, setFilterOpen] = useState(false),
    [detail, setDetail] = useState<string | null>(null),
    [mobileView, setMobileView] = useState('list');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 280);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError('');
    api
      .list({ query: debounced, sort, filters, bounds, onlyMatches }, c.signal)
      .then((r) => setRooms(r.items))
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(e.message);
          setRooms([]);
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [api, debounced, sort, filters, bounds, onlyMatches, retry]);
  const urlReady = useRef(false);
  useEffect(() => {
    if (!urlReady.current) {
      urlReady.current = true;
      return;
    }
    const u = new URL(location.href);
    if (filterCount(filters)) u.searchParams.set('filters', JSON.stringify(filters));
    else u.searchParams.delete('filters');
    history.replaceState(history.state, '', u);
  }, [filters]);
  const changeBounds = useCallback((b: Bounds | null) => setBounds(b), []);
  const openRoom = useCallback((id: string) => setDetail(id), []);
  const count = filterCount(filters);
  const chips: [string, () => void][] = [];
  for (const [key, label] of [
    ['maxRent', '월세'],
    ['maxMaintenance', '관리비'],
    ['maxDeposit', '보증금'],
  ] as const)
    if (filters[key] !== null)
      chips.push([
        `${label} ${money(filters[key])}원 이하`,
        () => setFilters({ ...filters, [key]: null }),
      ]);
  if (filters.nearCommercial !== null)
    chips.push(['학교 주변 상권', () => setFilters({ ...filters, nearCommercial: null })]);
  filters.options.forEach((id) =>
    chips.push([
      optionLabels[id],
      () => setFilters({ ...filters, options: filters.options.filter((x) => x !== id) }),
    ]),
  );
  filters.facilities.forEach((id) =>
    chips.push([
      `${facilityLabels[id]} 500m`,
      () => setFilters({ ...filters, facilities: filters.facilities.filter((x) => x !== id) }),
    ]),
  );
  const reset = () => {
    setFilters({ ...emptyFilters });
    setQuery('');
    setBounds(null);
    setOnlyMatches(false);
  };
  return (
    <>
      <Header />
      <main className="explore-shell">
        <section className="explore-intro">
          <div>
            <div className="eyebrow">
              <span className="tiny-sun" />
              순천대학교의 자취 생활
            </div>
            <h1>
              학교 가까이, <span>내 생활에 딱 맞게.</span>
            </h1>
            <p>월세만 보지 말고, 나의 한 달을 비교해 보세요.</p>
          </div>
          <button className="intro-action" onClick={() => setFilterOpen(true)}>
            <span className="spark-circle">
              <SlidersHorizontal size={21} />
            </span>
            <span>
              <b>나에게 맞는 방 찾기</b>
              <small>예산과 생활 조건을 골라보세요</small>
            </span>
            <ArrowRight size={20} />
          </button>
        </section>
        <section className="filter-toolbar" aria-label="매물 검색 및 필터">
          <label className="search-input">
            <Search size={19} />
            <input
              aria-label="매물 검색"
              maxLength={100}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="매물 이름, 생활권으로 검색"
            />
            {query && (
              <button aria-label="검색어 지우기" onClick={() => setQuery('')}>
                <X size={16} />
              </button>
            )}
          </label>
          <div className="filter-buttons">
            <button
              onClick={() => setFilterOpen(true)}
              className={filters.maxRent !== null ? 'has-filter' : ''}
            >
              월세·관리비 <ChevronDown size={15} />
            </button>
            <button
              onClick={() => setFilterOpen(true)}
              className={filters.maxDeposit !== null ? 'has-filter' : ''}
            >
              보증금 <ChevronDown size={15} />
            </button>
            <button
              onClick={() => setFilterOpen(true)}
              className={filters.facilities.length ? 'has-filter' : ''}
            >
              생활권·편의시설 <ChevronDown size={15} />
            </button>
            <button
              onClick={() => setFilterOpen(true)}
              className={filters.options.length ? 'has-filter' : ''}
            >
              옵션 <ChevronDown size={15} />
            </button>
            <button className="all-filter" onClick={() => setFilterOpen(true)}>
              <SlidersHorizontal size={17} />
              전체 필터{count > 0 && <b>{count}</b>}
            </button>
          </div>
        </section>
        {chips.length > 0 && (
          <div className="applied-filters">
            {chips.map(([label, remove]) => (
              <span className="filter-chip" key={label}>
                <button onClick={() => setFilterOpen(true)} aria-label={`${label} 수정`}>
                  {label}
                </button>
                <button aria-label={`${label} 삭제`} onClick={remove}>
                  <X size={13} />
                </button>
              </span>
            ))}
            <button className="text-button" onClick={() => setFilters({ ...emptyFilters })}>
              <RotateCcw size={13} />
              초기화
            </button>
          </div>
        )}
        <div className="workspace-heading">
          <div>
            <h2>
              캠퍼스 주변의 방 <span>{loading ? '…' : rooms.length}</span>
            </h2>
            <p>
              {count
                ? `내 조건에 맞는 방 ${rooms.filter((r) => matches(r, filters)).length}개`
                : '가까운 곳부터, 나에게 맞는 공간을 찾아보세요.'}
            </p>
          </div>
          <Tabs value={mobileView} onValueChange={setMobileView} className="mobile-view-tabs">
            <TabsList aria-label="보기 방식">
              <TabsTrigger value="list">
                <LayoutGrid size={15} />
                목록
              </TabsTrigger>
              <TabsTrigger value="map">
                <Map size={15} />
                지도
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="list-controls">
            <label>
              <Checkbox checked={onlyMatches} onCheckedChange={(v) => setOnlyMatches(v === true)} />
              내 조건만
            </label>
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger aria-label="매물 정렬">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  ['match', '조건 일치순'],
                  ['monthly', '월 부담액 낮은순'],
                  ['deposit', '보증금 낮은순'],
                  ['distance', '학교 가까운순'],
                  ['area', '면적 넓은순'],
                ].map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className={`explore-workspace view-${mobileView}`}>
          <div className="list-column">
            {error ? (
              <ErrorState message={error} retry={() => setRetry((x) => x + 1)} />
            ) : loading ? (
              <LoadingCards />
            ) : !rooms.length ? (
              <EmptyState reset={reset} />
            ) : (
              <div className="room-grid">
                {rooms.map((room, i) => (
                  <RoomCard key={room.id} room={room} index={i} onOpen={openRoom} />
                ))}
              </div>
            )}
            <div className="data-note">
              <Info size={16} />
              <p>
                {config.mode === 'mock'
                  ? '지금 보고 있는 방은 시연용 샘플이에요. 실제 매물·사진·가격·거리가 아니에요.'
                  : '정보는 각 매물의 수집일 기준이에요. 누락된 값은 추정하지 않아요.'}
                <span>월 부담액 = 월세 + 관리비 · 보증금 이자 및 별도 공과금 제외</span>
              </p>
            </div>
          </div>
          <div className="map-column">
            <RoomMap
              rooms={rooms}
              filters={filters}
              onBounds={changeBounds}
              onSelect={openRoom}
              busy={loading}
            />
            <div className="comparison-tip">
              <span className="tip-icon">
                <Sparkles size={20} />
              </span>
              <div>
                <h3>마음에 드는 방이 두 개라면?</h3>
                <p>
                  비교에 담고, 비용부터 생활 조건까지
                  <br />
                  나란히 확인해 보세요.
                </p>
              </div>
            </div>
          </div>
        </div>
        <footer className="page-footer">
          <span className="footer-brand">순룸</span>
          <span>순천대 앞, 나의 첫 공간.</span>
          <span>샘플 사진 · Pexels / Unsplash</span>
        </footer>
      </main>
      <FilterDialog open={filterOpen} onOpenChange={setFilterOpen} />
      <RoomDetail id={detail} onClose={() => setDetail(null)} />
      <CompareBar />
    </>
  );
}
