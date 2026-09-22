'use client';
import { ArrowUpRight, Footprints, Check } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { type Room, optionLabels } from '../../contracts/schemas';
import { money, monthlyCost, distance, matches, filterCount } from '../../domain/rooms';
import { useApp } from '../../shared/AppProvider';
import { RoomPhoto } from '../../shared/RoomPhoto';
export function RoomCard({
  room,
  onOpen,
  index,
}: {
  room: Room;
  onOpen: (id: string) => void;
  index: number;
}) {
  const { selected, toggleRoom, filters } = useApp();
  const chosen = selected.includes(room.id);
  const match = matches(room, filters);
  return (
    <article className={`room-card ${chosen ? 'selected' : ''}`}>
      <button
        className="room-image"
        onClick={() => onOpen(room.id)}
        aria-label={`${room.title} 상세 보기`}
      >
        <RoomPhoto room={room} priority={index < 2} />
        <span className="photo-badge">
          {room.source.kind === 'sample' ? '샘플 매물' : '등록 매물'}
        </span>
        {filterCount(filters) > 0 && (
          <span className={`match-badge ${match ? '' : 'no-match'}`}>
            {match ? (
              <>
                <Check size={12} />
                조건 일치
              </>
            ) : (
              '조건 확인 필요'
            )}
          </span>
        )}
        <span className="photo-open">
          <ArrowUpRight size={18} />
        </span>
      </button>
      <div className="card-body">
        <div className="card-location">{room.neighborhood}</div>
        <button className="room-title" onClick={() => onOpen(room.id)}>
          <h3>{room.title}</h3>
        </button>
        <p className="room-price">
          월세{' '}
          <strong>
            {money(room.deposit)} / {money(room.rent)}
          </strong>
        </p>
        <p className="room-meta">
          관리비 {money(room.maintenance)}
          {room.maintenance !== null ? '원' : ''}
          <span>·</span>
          {room.area === null ? '면적 정보 없음' : `${room.area}m²`}
          <span>·</span>
          {room.floor === null ? '층 정보 없음' : `${room.floor}층`}
        </p>
        <div className="option-tags">
          {Object.entries(room.options)
            .filter(([, v]) => v === true)
            .slice(0, 3)
            .map(([k]) => (
              <span key={k}>{optionLabels[k as keyof typeof optionLabels]}</span>
            ))}
          <span className="walk-tag">
            <Footprints size={13} />
            {distance(room.schoolDistance)}
          </span>
        </div>
        <div className="card-bottom">
          <span>
            월 부담액{' '}
            <strong>
              {money(monthlyCost(room))}
              {monthlyCost(room) !== null ? '원' : ''}
            </strong>
          </span>
          <label className={`compare-checkbox ${chosen ? 'checked' : ''}`}>
            <Checkbox
              checked={chosen}
              aria-label={`${room.title} 비교 선택`}
              onCheckedChange={() => toggleRoom(room.id)}
            />
            <span>{chosen ? '선택됨' : '비교 담기'}</span>
          </label>
        </div>
      </div>
    </article>
  );
}
