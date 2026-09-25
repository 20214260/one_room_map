'use client';
import { track } from '../../services/analytics';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Minus, Footprints, Scale, Info, MessageCircle } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { optionIds, optionLabels, facilityLabels, type Room } from '../../contracts/schemas';
import { money, monthlyCost, distance } from '../../domain/rooms';
import { useApp } from '../../shared/AppProvider';
import { RoomPhoto } from '../../shared/RoomPhoto';
import { ErrorState } from '../../shared/Status';
import { Skeleton } from '@/components/ui/skeleton';
import { InquiryForm } from './InquiryForm';
export function RoomDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { api, selected, toggleRoom, user } = useApp();
  const [room, setRoom] = useState<Room | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setRoom(null);
    setError('');
    if (!id) return;
    const c = new AbortController();
    api
      .get(id, c.signal)
      .then((r) => {
        setRoom(r);
        track('room_detail_view', [r.id]);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [id, api, attempt]);
  return (
    <Sheet
      open={!!id}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <SheetContent className="detail-sheet">
        <SheetTitle className="sr-only">매물 상세</SheetTitle>
        <SheetDescription className="sr-only">
          비용, 옵션과 데이터 출처를 확인하세요.
        </SheetDescription>
        {error ? (
          <ErrorState message={error} retry={() => setAttempt((x) => x + 1)} />
        ) : !room ? (
          <Skeleton className="m-6 h-96" />
        ) : (
          <>
            <div className="detail-photo">
              <RoomPhoto room={room} />
              <span className="photo-badge">
                {room.source.kind === 'sample' ? '샘플 매물 · 참고 이미지' : '매물 사진'}
              </span>
            </div>
            <div className="detail-body">
              <p className="eyebrow">{room.neighborhood}</p>
              <h2>{room.title}</h2>
              <p>{room.description}</p>
              {room.source.kind === 'owner' && room.photos.length > 1 && (
                <div className="owner-detail-gallery">
                  {room.photos.map((p, i) => (
                    <img key={i} src={p.url} alt={p.alt || `방 사진 ${i + 1}`} loading="lazy" />
                  ))}
                </div>
              )}
              <div className="cost-highlight">
                <span>
                  월 부담액 <small>월세 + 관리비</small>
                </span>
                <strong>
                  {money(monthlyCost(room))}
                  {monthlyCost(room) !== null ? '원' : ''}
                </strong>
              </div>
              <dl className="facts-grid">
                {[
                  ['보증금', money(room.deposit)],
                  ['월세', money(room.rent)],
                  ['관리비', money(room.maintenance)],
                  ['전용 면적', room.area === null ? '정보 없음' : `${room.area}m²`],
                  ['층', room.floor === null ? '정보 없음' : `${room.floor}층`],
                  ['학교까지 도보 경로', distance(room.schoolDistance)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="field-help">보증금 이자와 별도 공과금은 월 부담액에 포함하지 않아요.</p>
              <section>
                <h3>옵션, 하나씩 확인해요</h3>
                <div className="detail-options">
                  {optionIds.map((id) => (
                    <span key={id} className={room.options[id] === true ? 'available' : ''}>
                      {room.options[id] === true ? <Check size={16} /> : <Minus size={16} />}{' '}
                      {optionLabels[id]}{' '}
                      <small>
                        {room.options[id] === null || room.options[id] === undefined
                          ? '정보 없음'
                          : room.options[id]
                            ? '있음'
                            : '없음'}
                      </small>
                    </span>
                  ))}
                </div>
              </section>
              <section>
                <h3>
                  <Footprints size={19} /> 주변 생활 정보
                </h3>
                <p className="field-help">
                  {room.distanceSource?.kind === 'sample'
                    ? '샘플 도보 거리 · 실측 아님'
                    : '공공데이터 및 도보 경로 API 기준'}
                </p>
                {room.facilities.map((f) => (
                  <div className="facility-line" key={f.type}>
                    <span>{facilityLabels[f.type]}</span>
                    <strong>{distance(f.distance)}</strong>
                  </div>
                ))}
              </section>
              <section className="source-block">
                <h3>
                  <Info size={17} /> 이 정보는 어디에서 왔나요?
                </h3>
                <p>
                  <b>매물 정보</b> {room.source.name}
                </p>
                <p>
                  기준일 {room.source.collectedAt} · {room.source.license}
                </p>
                <p>{room.source.note}</p>
                {room.source.url && (
                  <a href={room.source.url} target="_blank" rel="noreferrer">
                    매물 출처 확인
                  </a>
                )}
                <p>
                  <b>주변 환경</b> {room.distanceSource?.name ?? '정보 없음'}
                </p>
                {room.distanceSource && (
                  <>
                    <p>기준일 {room.distanceSource.collectedAt}</p>
                    <p>{room.distanceSource.note}</p>
                    {room.distanceSource.url && (
                      <a href={room.distanceSource.url} target="_blank" rel="noreferrer">
                        주변 환경 출처 확인
                      </a>
                    )}
                  </>
                )}
                {room.source.kind === 'sample' && (
                  <p className="field-help">
                    사진: Pexels · Unsplash / 실제 순천 매물 사진이 아닌 공간 참고 이미지
                  </p>
                )}
              </section>
              {room.source.kind === 'owner' && <InquiryForm key={room.id} roomId={room.id} />}
            </div>
            <div className="detail-footer">
              {room.source.kind === 'owner' && user?.role !== 'landlord' && (
                <Link
                  className="btn primary chat-detail-cta"
                  href={
                    user
                      ? `/chats?room=${encodeURIComponent(room.id)}`
                      : `/login?returnTo=${encodeURIComponent(`/chats?room=${encodeURIComponent(room.id)}`)}`
                  }
                >
                  <MessageCircle size={17} /> 채팅으로 문의하기
                </Link>
              )}
              <button
                className={`btn ${selected.includes(room.id) ? 'secondary' : 'primary'}`}
                onClick={() => toggleRoom(room.id)}
              >
                <Scale size={18} />
                {selected.includes(room.id) ? '비교에서 빼기' : '이 방 비교에 담기'}
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
