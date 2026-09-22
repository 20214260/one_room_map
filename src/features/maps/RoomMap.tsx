'use client';
import { useEffect, useRef, useState } from 'react';
import {
  GraduationCap,
  MapPin,
  Plus,
  Minus,
  LocateFixed,
  ArrowUpRight,
  LoaderCircle,
} from 'lucide-react';
import type { Room, Bounds, Filters } from '../../contracts/schemas';
import { matches, money } from '../../domain/rooms';
import { useApp } from '../../shared/AppProvider';
import { createKakaoView, type KakaoView } from './kakao';
export function RoomMap({
  rooms,
  filters,
  onBounds,
  onSelect,
  busy,
}: {
  rooms: Room[];
  filters: Filters;
  onBounds: (b: Bounds | null) => void;
  onSelect: (id: string) => void;
  busy: boolean;
}) {
  const { config } = useApp();
  const element = useRef<HTMLDivElement>(null),
    view = useRef<KakaoView | null>(null),
    latest = useRef({ onBounds, onSelect, rooms, filters });
  latest.current = { onBounds, onSelect, rooms, filters };
  const [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [ready, setReady] = useState(false),
    [zone, setZone] = useState('all');
  useEffect(() => {
    if (!config.kakaoMapKey || !element.current) return;
    let active = true;
    setError('');
    setReady(false);
    createKakaoView(
      element.current,
      config.kakaoMapKey,
      (b) => latest.current.onBounds(b),
      (id) => latest.current.onSelect(id),
    )
      .then((v) => {
        if (!active) {
          v.destroy();
          return;
        }
        view.current = v;
        v.render(latest.current.rooms, latest.current.filters);
        setReady(true);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      view.current?.destroy();
      view.current = null;
    };
  }, [config.kakaoMapKey, attempt]);
  useEffect(() => view.current?.render(rooms, filters), [rooms, filters]);
  function changeZone(next: string) {
    setZone(next);
    onBounds(
      next === 'all'
        ? null
        : next === 'front'
          ? { south: 34.9675, north: 34.975, west: 127.475, east: 127.482 }
          : { south: 34.965, north: 34.974, west: 127.482, east: 127.488 },
    );
  }
  const positions: Record<string, [number, number]> = {
    'sun-01': [34, 39],
    'sun-02': [43, 65],
    'sun-03': [73, 51],
    'sun-04': [52, 27],
    'sun-05': [80, 77],
    'sun-06': [15, 65],
  };
  return (
    <aside className="map-panel">
      <div className="map-title">
        <span>
          <MapPin size={17} />
          <b>캠퍼스 주변, 한눈에</b>
        </span>
        <span className="live-label">
          {config.kakaoMapKey ? '카카오맵' : config.mode === 'mock' ? '샘플 위치' : '지도 준비 중'}
        </span>
      </div>
      <div className="map-surface">
        <div ref={element} className="kakao-container" />
        {!config.kakaoMapKey && config.mode === 'mock' && (
          <>
            <svg
              className="demo-map"
              viewBox="0 0 480 560"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <rect width="480" height="560" fill="#f1f2ec" />
              <path d="M280 0h200v160l-80 50-95-36-46-85z" fill="#e0ebd7" />
              <path d="M0 480 100 427l50 49-25 84H0z" fill="#e0ebd7" />
              <g fill="#e5e7df" stroke="#f8f9f5" strokeWidth="3">
                <path d="M10 35h83v104H10zM110 30h92v60h-92zM107 108h100v54H107zM20 187h89v66H20zM126 181h67v89h-67zM12 293h75v73H12zM114 316h102v59H114zM10 401h103v49H10zM250 221h58v74h-58zM338 227h108v61H338zM264 326h79v81H264zM359 333h105v55H359zM162 455h82v77H162zM282 447h108v77H282z" />
              </g>
              <g fill="none" stroke="#fff" strokeWidth="16">
                <path d="M230-20 213 202 232 395 269 590M-20 288 188 287 484 308M-20 161 231 166 496 202M-20 466 168 428 496 424" />
              </g>
              <path d="M90-20 101 181 101 414 178 579" fill="none" stroke="#fff" strokeWidth="9" />
              <path
                d="M-20 377 173 382 296 310 506 83"
                fill="none"
                stroke="#f5dfb5"
                strokeWidth="10"
              />
              <path
                d="M402-30 413 111 364 232 346 417 484 579"
                fill="none"
                stroke="#d0e6e9"
                strokeWidth="13"
              />
              <g fill="#9a9e94" fontSize="13" fontFamily="sans-serif">
                <text x="105" y="239">
                  정문 생활권
                </text>
                <text x="301" y="380">
                  후문 생활권
                </text>
                <text x="252" y="456">
                  대학로 일대
                </text>
              </g>
            </svg>
            <div className="campus-marker">
              <GraduationCap size={25} />
              <span>
                순천대학교<small>캠퍼스 기준점</small>
              </span>
            </div>
            <div className="demo-pin-layer">
              {rooms
                .filter((r) => r.coordinates)
                .map((r) => {
                  const p = positions[r.id] ?? [50, 50];
                  return (
                    <button
                      key={r.id}
                      className={`map-marker ${matches(r, filters) ? 'matching' : 'muted-marker'}`}
                      style={{ left: `${p[0]}%`, top: `${p[1]}%` }}
                      onClick={() => onSelect(r.id)}
                      aria-label={`${r.title} 지도에서 상세 보기`}
                    >
                      월 {money(r.rent)}
                    </button>
                  );
                })}
            </div>
            <div className="map-area-switch">
              <button className={zone === 'all' ? 'active' : ''} onClick={() => changeZone('all')}>
                전체
              </button>
              <button
                className={zone === 'front' ? 'active' : ''}
                onClick={() => changeZone('front')}
              >
                정문
              </button>
              <button
                className={zone === 'back' ? 'active' : ''}
                onClick={() => changeZone('back')}
              >
                후문
              </button>
            </div>
            <div className="map-demo-caption">위치·도로는 시연용 모식도예요.</div>
          </>
        )}
        {!config.kakaoMapKey && config.mode === 'http' && (
          <div className="map-message">
            <MapPin />
            <p>
              지도를 준비 중이에요.
              <br />
              목록에서 방을 계속 살펴볼 수 있어요.
            </p>
          </div>
        )}
        {config.kakaoMapKey && !ready && !error && (
          <div className="map-message">
            <LoaderCircle className="spin" />
            지도를 불러오는 중
          </div>
        )}
        {error && (
          <div className="map-message" role="alert">
            <MapPin />
            <p>{error}</p>
            <button className="btn secondary" onClick={() => setAttempt((x) => x + 1)}>
              지도 다시 시도
            </button>
          </div>
        )}
        <div className="map-control">
          <button
            aria-label="캠퍼스 주변으로 되돌리기"
            onClick={() => {
              if (config.kakaoMapKey) view.current?.reset();
              else changeZone('all');
            }}
          >
            <LocateFixed size={19} />
          </button>
          {config.kakaoMapKey && (
            <>
              <button aria-label="지도 확대" onClick={() => view.current?.zoom(-1)}>
                <Plus size={20} />
              </button>
              <button aria-label="지도 축소" onClick={() => view.current?.zoom(1)}>
                <Minus size={20} />
              </button>
            </>
          )}
        </div>
        {busy && (
          <span className="map-loading">
            <LoaderCircle size={13} className="spin" />
            매물 갱신 중
          </span>
        )}
        <div className="map-legend">
          <span>
            <i />
            조건 일치
          </span>
          <span>
            <i className="gray" />
            조건 확인 필요
          </span>
        </div>
      </div>
      <div className="map-footer">
        <span>
          <b>{rooms.filter((r) => r.coordinates).length}개</b> 방을 보고 있어요
        </span>
        <span>
          핀을 눌러 상세 보기 <ArrowUpRight size={14} />
        </span>
      </div>
      {rooms.some((r) => !r.coordinates) && (
        <p className="field-help">위치 정보가 없는 방은 목록에서 확인할 수 있어요.</p>
      )}
    </aside>
  );
}
