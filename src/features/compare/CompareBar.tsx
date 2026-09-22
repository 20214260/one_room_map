'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Scale, X, ArrowRight, Plus } from 'lucide-react';
import { useApp } from '../../shared/AppProvider';
import type { Room } from '../../contracts/schemas';
import { RoomPhoto } from '../../shared/RoomPhoto';
export function CompareBar() {
  const { selected, toggleRoom, api, filters } = useApp();
  const [rooms, setRooms] = useState<Room[]>([]);
  useEffect(() => {
    const c = new AbortController();
    Promise.all(selected.map((id) => api.get(id, c.signal)))
      .then(setRooms)
      .catch(() => {
        if (!c.signal.aborted) setRooms([]);
      });
    return () => c.abort();
  }, [selected, api]);
  if (!selected.length) return null;
  return (
    <div className="compare-bar">
      <div className="bar-intro">
        <span className="bar-icon">
          <Scale size={22} />
        </span>
        <div>
          <b>어떤 방이 더 좋을까?</b>
          <span>{selected.length} / 2개 선택</span>
        </div>
      </div>
      <div className="bar-slots">
        {[0, 1].map((i) => {
          const r = rooms.find((r) => r.id === selected[i]);
          return (
            <div className={`bar-slot ${selected[i] ? 'filled' : ''}`} key={i}>
              {r && <RoomPhoto room={r} />}
              <span>
                {r ? (
                  r.title
                ) : selected[i] ? (
                  '매물 불러오는 중'
                ) : (
                  <>
                    <Plus size={16} /> 방을 하나 더 담아 주세요
                  </>
                )}
              </span>
              {selected[i] && (
                <button
                  aria-label={`${r?.title ?? '매물'} 비교 해제`}
                  onClick={() => toggleRoom(selected[i])}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {selected.length === 2 ? (
        <Link
          className="btn primary"
          href={`/compare?ids=${selected.join(',')}&filters=${encodeURIComponent(JSON.stringify(filters))}`}
        >
          2개 방 비교하기 <ArrowRight size={17} />
        </Link>
      ) : (
        <button className="btn primary" disabled>
          방을 하나 더 선택해 주세요
        </button>
      )}
    </div>
  );
}
