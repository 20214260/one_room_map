'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Plus,
  ArrowUpRight,
  House,
  MessageCircle,
  Eye,
  Pencil,
  Trash2,
  Inbox,
  LoaderCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useApp } from '../../shared/AppProvider';
import { LandlordGuard } from './LandlordGuard';
import {
  type OwnerListing,
  type InboxItem,
  type ListingStatus,
  listingStatusLabels,
} from '../../contracts/landlord';
import { money, submissionToRoom } from '../../domain/rooms';
import { RoomPhoto } from '../../shared/RoomPhoto';

export function LandlordDashboard() {
  return (
    <LandlordGuard>
      <Dashboard />
    </LandlordGuard>
  );
}
function Dashboard() {
  const { api, user, config } = useApp();
  const [rooms, setRooms] = useState<OwnerListing[]>([]);
  const [inquiries, setInquiries] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [inboxError, setInboxError] = useState('');
  const [tab, setTab] = useState<'rooms' | 'inquiries'>('rooms');
  const [filter, setFilter] = useState('all'),
    [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(''),
    [deleting, setDeleting] = useState<OwnerListing | null>(null);
  useEffect(() => {
    const c = new AbortController();
    Promise.allSettled([api.myRooms(c.signal), api.inbox(c.signal)]).then(([list, inbox]) => {
      if (c.signal.aborted) return;
      if (list.status === 'fulfilled') setRooms(list.value.items);
      else setError(list.reason.message);
      if (inbox.status === 'fulfilled') setInquiries(inbox.value.items);
      else setInboxError(inbox.reason.message);
      setLoading(false);
    });
    return () => c.abort();
  }, [api, user?.id, attempt]);
  function reload() {
    setLoading(true);
    setError('');
    setInboxError('');
    setAttempt((v) => v + 1);
  }
  async function status(row: OwnerListing, next: ListingStatus) {
    setBusy(row.id);
    try {
      const updated = await api.setRoomStatus(row.id, next);
      setRooms((rows) => rows.map((r) => (r.id === row.id ? updated : r)));
      toast.success(`매물이 ${listingStatusLabels[updated.status]} 상태로 바뀌었어요.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(deleting.id);
    try {
      await api.deleteRoom(deleting.id);
      setRooms((rows) => rows.filter((r) => r.id !== deleting.id));
      setInquiries((items) => items.filter((i) => i.roomId !== deleting.id));
      setDeleting(null);
      toast.success('매물을 삭제했어요.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function markRead(item: InboxItem) {
    setBusy(item.id);
    try {
      await api.readInquiry(item.id);
      setInquiries((items) => items.map((i) => (i.id === item.id ? { ...i, read: true } : i)));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  const shown = rooms.filter((r) => filter === 'all' || r.status === filter);
  const unread = inquiries.filter((i) => !i.read).length;
  return (
    <main className="owner-shell">
      <section className="owner-hero">
        <div>
          <p className="eyebrow">SUNROOM · OWNER SPACE</p>
          <h1>
            좋은 방의 다음 이야기를,
            <br />
            <em>여기서 시작해요.</em>
          </h1>
          <p>{user?.name}님, 등록한 방과 새로운 문의를 한눈에 확인하세요.</p>
          <Link href="/landlord/new" className="btn primary">
            <Plus size={18} />새 매물 등록
          </Link>
          <Link href="/chats" className="owner-chat-link">
            <MessageCircle size={17} /> 채팅 관리 <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="owner-hero-art" aria-hidden="true">
          <img src="/images/room-1.jpg" alt="" />
          <span>
            Every room,
            <br />
            <b>a new beginning.</b>
          </span>
          <i>
            <House size={22} /> 나의 방, 다음의 일상
          </i>
        </div>
      </section>
      {config.mode === 'mock' && (
        <p className="owner-demo-note">
          시연 모드 · 매물은 검수 없이 시연 목록에 공개돼요. 같은 탭에서 사용자로 전환해 확인할 수
          있으며, 탭을 닫으면 데이터가 사라져요. 실제 개인정보는 입력하지 마세요.
        </p>
      )}
      <div className="owner-stats">
        {[
          { icon: House, label: '등록한 매물', value: rooms.length },
          {
            icon: Eye,
            label: '공개 중인 방',
            value: rooms.filter((r) => r.status === 'published').length,
          },
          { icon: MessageCircle, label: '새로운 문의', value: unread },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label}>
            <span>
              <Icon size={18} />
              {label}
            </span>
            <strong>
              {loading ? '—' : value}
              <small>건</small>
            </strong>
          </div>
        ))}
      </div>
      <div className="owner-tabs" role="tablist" aria-label="집주인 메뉴">
        <button role="tab" aria-selected={tab === 'rooms'} onClick={() => setTab('rooms')}>
          내 매물 <span>{rooms.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'inquiries'} onClick={() => setTab('inquiries')}>
          받은 문의 {unread > 0 && <span>{unread}</span>}
        </button>
      </div>
      {loading ? (
        <div className="owner-empty" role="status">
          <LoaderCircle className="spin" />
          <p>내 공간을 불러오고 있어요.</p>
        </div>
      ) : tab === 'rooms' ? (
        <>
          <div className="owner-section-head">
            <h2>나의 매물</h2>
            <select
              aria-label="매물 상태 필터"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">모든 상태</option>
              {Object.entries(listingStatusLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {error ? (
            <div className="owner-empty" role="alert">
              <p>{error}</p>
              <button className="btn secondary" onClick={reload}>
                다시 불러오기
              </button>
            </div>
          ) : shown.length ? (
            <div className="owner-listings">
              {shown.map((row) => (
                <article className="owner-listing" key={row.id}>
                  <div className="owner-card-photo">
                    <RoomPhoto room={submissionToRoom(row.submission, row.id)} />
                    <span className={`owner-status ${row.status}`}>
                      {listingStatusLabels[row.status]}
                    </span>
                  </div>
                  <div className="owner-card-body">
                    <p className="owner-muted">{row.submission.locationHint.detail}</p>
                    <h3>{row.submission.title}</h3>
                    <strong className="owner-price">
                      {money(row.submission.deposit ?? null)} / {money(row.submission.rent)}
                      <small> 보증금 / 월세</small>
                    </strong>
                    <p className="owner-muted">
                      관리비 {money(row.submission.maintenance ?? null)} ·{' '}
                      {new Date(row.updatedAt).toLocaleDateString('ko-KR')} 수정
                    </p>
                    <div className="owner-card-actions">
                      <Link
                        className="btn secondary"
                        href={`/landlord/edit?id=${encodeURIComponent(row.id)}`}
                      >
                        <Pencil size={15} />
                        수정하기
                      </Link>
                      <button
                        className="owner-icon-button"
                        aria-label={`${row.submission.title} 삭제`}
                        disabled={!!busy}
                        onClick={() => setDeleting(row)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                    <div className="owner-status-actions">
                      {row.status === 'pending_review' ? (
                        <span>검수 후 공개돼요</span>
                      ) : (
                        <>
                          <button
                            disabled={!!busy}
                            onClick={() =>
                              status(row, row.status === 'published' ? 'hidden' : 'published')
                            }
                          >
                            {row.status === 'published' ? '비공개로 전환' : '다시 공개'}
                          </button>
                          {row.status !== 'closed' && (
                            <button disabled={!!busy} onClick={() => status(row, 'closed')}>
                              거래 완료 처리
                            </button>
                          )}
                        </>
                      )}
                      {busy === row.id && <LoaderCircle size={14} className="spin" />}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="owner-empty">
              <House size={36} />
              <h3>
                {rooms.length ? '이 상태의 매물이 아직 없어요' : '첫 번째 방을 소개해 주세요'}
              </h3>
              <p>사진과 기본 정보를 올리면 방을 찾는 학생에게 보여줄 수 있어요.</p>
              <Link className="btn primary" href="/landlord/new">
                매물 등록하기 <ArrowUpRight size={17} />
              </Link>
            </div>
          )}
        </>
      ) : (
        <section className="owner-inbox">
          <div className="owner-section-head">
            <h2>받은 문의</h2>
            <button className="back-link" onClick={reload}>
              새로고침
            </button>
          </div>
          <p className="owner-muted">
            연락처는 공개하지 않아요.{' '}
            {config.mode === 'mock'
              ? '시연에서는 메시지 수신·읽음만 확인하며 실제 알림이나 답장은 전송하지 않아요.'
              : '답장 중계 기능은 백엔드 연결 후 제공될 예정이에요.'}
          </p>
          {inboxError ? (
            <p className="inline-error" role="alert">
              {inboxError}
            </p>
          ) : inquiries.length ? (
            inquiries
              .slice()
              .reverse()
              .map((item) => (
                <article key={item.id} className={`owner-inquiry ${item.read ? '' : 'unread'}`}>
                  <div>
                    <strong>{item.roomTitle}</strong>
                    <span>{new Date(item.createdAt).toLocaleString('ko-KR')}</span>
                  </div>
                  <p>{item.message}</p>
                  {item.read ? (
                    <small>확인한 문의</small>
                  ) : (
                    <button
                      disabled={!!busy}
                      className="btn secondary"
                      onClick={() => markRead(item)}
                    >
                      읽음으로 표시
                    </button>
                  )}
                </article>
              ))
          ) : (
            <div className="owner-empty">
              <Inbox size={36} />
              <h3>아직 도착한 문의가 없어요</h3>
              <p>등록한 방에 문의가 오면 여기에 모아드릴게요.</p>
            </div>
          )}
        </section>
      )}
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogTitle>이 매물을 삭제할까요?</DialogTitle>
          <DialogDescription>
            “{deleting?.submission.title}”와 연결된 문의가 삭제됩니다. 삭제 후에는 되돌릴 수 없어요.
          </DialogDescription>
          <div className="owner-dialog-actions">
            <button className="btn secondary" disabled={!!busy} onClick={() => setDeleting(null)}>
              취소
            </button>
            <button className="btn primary" disabled={!!busy} onClick={remove}>
              삭제하기
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
