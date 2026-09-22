'use client';
import { track } from '../../services/analytics';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowDown, ArrowUp, Scale, Check, Minus, Info } from 'lucide-react';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Header } from '../../shared/Header';
import { useApp } from '../../shared/AppProvider';
import {
  type Room,
  optionIds,
  optionLabels,
  facilityIds,
  facilityLabels,
} from '../../contracts/schemas';
import { money, monthlyCost, distance, compareWinner } from '../../domain/rooms';
import { RoomPhoto } from '../../shared/RoomPhoto';
import { ErrorState } from '../../shared/Status';
import { RecommendationPanel } from '../recommendations/RecommendationPanel';
import { RoomDetail } from '../listings/RoomDetail';
type Row = {
  label: string;
  direction: 'lower' | 'higher' | 'none';
  get: (r: Room) => number | null;
  format: (n: number | null) => string;
  highlight?: boolean;
};
const rows: Row[] = [
  { label: '월 부담액', direction: 'lower', get: monthlyCost, format: money, highlight: true },
  { label: '보증금', direction: 'lower', get: (r) => r.deposit, format: money },
  { label: '월세', direction: 'lower', get: (r) => r.rent, format: money },
  { label: '관리비', direction: 'lower', get: (r) => r.maintenance, format: money },
  {
    label: '전용 면적',
    direction: 'higher',
    get: (r) => r.area,
    format: (n) => (n === null ? '정보 없음' : `${n}m²`),
  },
  {
    label: '층',
    direction: 'none',
    get: (r) => r.floor,
    format: (n) => (n === null ? '정보 없음' : `${n}층`),
  },
  {
    label: '학교까지 도보 경로',
    direction: 'lower',
    get: (r) => r.schoolDistance,
    format: distance,
  },
  ...facilityIds.map((id) => ({
    label: `${facilityLabels[id]} 도보 경로`,
    direction: 'lower' as const,
    get: (r: Room) => r.facilities.find((f) => f.type === id)?.distance ?? null,
    format: distance,
  })),
];
export function CompareScreen() {
  const { api, selected, setSelected } = useApp();
  const [ids, setIds] = useState<string[] | null>(null),
    [rooms, setRooms] = useState<Room[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [detail, setDetail] = useState<string | null>(null);
  useEffect(() => {
    const param = new URLSearchParams(location.search).get('ids');
    const values = param ? param.split(',') : selected;
    const valid =
      values.length === 2 &&
      new Set(values).size === 2 &&
      values.every((id) => /^[a-zA-Z0-9_-]{1,100}$/.test(id));
    setIds(valid ? values : []);
    if (valid) setSelected(values);
  }, []);
  useEffect(() => {
    if (ids === null) return;
    if (ids.length !== 2) {
      setLoading(false);
      return;
    }
    const c = new AbortController();
    setLoading(true);
    setError('');
    Promise.all(ids.map((id) => api.get(id, c.signal)))
      .then((r) => {
        setRooms(r);
        track('comparison_open', ids);
        track('comparison_complete', ids);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [ids, api, retry]);
  const body = loading ? (
    <div className="compare-loading">
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-80 w-full" />
    </div>
  ) : error ? (
    <ErrorState message={error} retry={() => setRetry((x) => x + 1)} />
  ) : rooms.length !== 2 ? (
    <div className="status-box compare-empty">
      <Scale size={42} />
      <h2>두 개의 방을 담아 주세요</h2>
      <p>
        방 찾기 화면에서 ‘비교 담기’를 눌러
        <br />
        비용과 생활 조건을 나란히 확인할 수 있어요.
      </p>
      <Link className="btn primary" href="/">
        방 둘러보기
      </Link>
    </div>
  ) : (
    <>
      <div className="versus-cards">
        {rooms.map((r, i) => (
          <article key={r.id} className={`versus-card side-${i}`}>
            <div className="versus-photo">
              <RoomPhoto room={r} priority />
              <span className="versus-letter">{i === 0 ? 'A' : 'B'}</span>
              {r.source.kind === 'sample' && <span className="photo-badge">샘플 매물</span>}
            </div>
            <div>
              <p>{r.neighborhood}</p>
              <h2>{r.title}</h2>
              <button className="text-button" onClick={() => setDetail(r.id)}>
                상세 정보 보기 ↗
              </button>
            </div>
          </article>
        ))}
        <div className="versus-divider">VS</div>
      </div>
      <section className="comparison-table-section">
        <div className="section-heading">
          <h2>같은 기준으로, 나란히</h2>
          <span>
            <i />
            항목별 유리한 값
          </span>
        </div>
        <Table className="comparison-table">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">비교 항목</TableHead>
              <TableHead scope="col">
                A <span>{rooms[0].title}</span>
              </TableHead>
              <TableHead scope="col">
                B <span>{rooms[1].title}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const values = rooms.map(row.get),
                winner = compareWinner(values[0], values[1], row.direction);
              return (
                <TableRow className={row.highlight ? 'highlight-row' : ''} key={row.label}>
                  <TableHead scope="row">
                    {row.label}
                    <small>
                      {row.direction === 'lower' ? (
                        <>
                          <ArrowDown size={12} />
                          낮을수록 유리
                        </>
                      ) : row.direction === 'higher' ? (
                        <>
                          <ArrowUp size={12} />
                          넓을수록 유리
                        </>
                      ) : (
                        '선호에 따라 달라요'
                      )}
                    </small>
                  </TableHead>
                  {values.map((value, i) => (
                    <TableCell key={i} className={winner === i ? 'winning' : ''}>
                      {row.format(value)}
                      {winner === i && <Check size={15} />}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
            {optionIds.map((id) => (
              <TableRow key={id}>
                <TableHead scope="row">{optionLabels[id]}</TableHead>
                {rooms.map((r) => (
                  <TableCell key={r.id}>
                    {r.options[id] === true ? (
                      <span className="option-yes">
                        <Check size={15} />
                        있음
                      </span>
                    ) : r.options[id] === false ? (
                      <span className="option-no">
                        <Minus size={15} />
                        없음
                      </span>
                    ) : (
                      '정보 없음'
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="comparison-footnote">
          <Info size={16} />
          <p>
            월 부담액은 월세 + 관리비예요. 보증금 이자와 별도 공과금은 제외했어요.
            <br />
            종합 순위는 매기지 않으며, 누락된 값은 유리한 값으로 판단하지 않아요.
          </p>
        </div>
      </section>
      <RecommendationPanel rooms={rooms} />
    </>
  );
  return (
    <>
      <Header />
      <main className="compare-shell">
        <Link href="/" className="back-link">
          <ArrowLeft size={17} />방 찾기로 돌아가기
        </Link>
        <div className="compare-title">
          <div>
            <p className="eyebrow">나의 두 가지 선택</p>
            <h1>나란히 보면, 더 확실해져요.</h1>
            <p>한 달의 비용부터 매일의 생활까지 비교해 보세요.</p>
          </div>
          <span className="compare-title-icon">
            <Scale size={36} />
          </span>
        </div>
        {body}
        <footer className="page-footer">
          <span className="footer-brand">순룸</span>
          <span>좋은 방보다, 나에게 맞는 방.</span>
        </footer>
      </main>
      <RoomDetail id={detail} onClose={() => setDetail(null)} />
    </>
  );
}
