'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronRight,
  Flag,
  MessageCircle,
  Send,
  ShieldOff,
  Sparkles,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Header } from '../../shared/Header';
import { useApp } from '../../shared/AppProvider';
import { money } from '../../domain/rooms';
import type { ChatDetail, ChatMessage, ChatSummary } from '../../contracts/chat';
import './chat.css';

const starter = [
  '아직 방을 볼 수 있나요?',
  '관리비에 포함된 항목이 궁금해요',
  '방문 가능한 시간을 알려주세요',
];
const time = (iso: string) =>
  new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
const changed = () => window.dispatchEvent(new Event('sunroom:chat-changed'));

export function ChatScreen() {
  const { api, user, authLoading, authError, config } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get('id');
  const roomId = params.get('room');
  const [items, setItems] = useState<ChatSummary[]>([]);
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chatError, setChatError] = useState('');
  const [text, setText] = useState('');
  const [visitAt, setVisitAt] = useState('');
  const [visitOpen, setVisitOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [safetyAction, setSafetyAction] = useState<'block' | 'report' | null>(null);
  const [reason, setReason] = useState<'spam' | 'inappropriate' | 'other'>('spam');
  const [busy, setBusy] = useState(false);
  const [draftRoom, setDraftRoom] = useState<{
    id: string;
    title: string;
    photo: string | null;
    location: string;
    rent: number | null;
    deposit: number | null;
  } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const list = await api.listChats(signal);
      if (!signal?.aborted) {
        setItems(list.items);
        setError('');
        setLoading(false);
        changed();
      }
      return list.items;
    },
    [api],
  );
  const openChat = useCallback(
    async (id: string, signal?: AbortSignal) => {
      const chat = await api.getChat(id, signal);
      if (signal?.aborted) return;
      setDetail(chat);
      setChatError('');
      if (chat.unreadCount) {
        await api.markChatRead(id, signal);
        if (!signal?.aborted) {
          setDetail({ ...chat, unreadCount: 0 });
          await refresh(signal);
        }
      }
    },
    [api, refresh],
  );

  useEffect(() => {
    if (!user || authLoading) return;
    const c = new AbortController();
    Promise.resolve()
      .then(() => refresh(c.signal))
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => c.abort();
  }, [user, authLoading, refresh]);
  useEffect(() => {
    if (!user || !selectedId) {
      queueMicrotask(() => setDetail(null));
      return;
    }
    const c = new AbortController();
    Promise.resolve()
      .then(() => {
        if (c.signal.aborted) return;
        setDetail(null);
        setDraftRoom(null);
        setChatError('');
        return openChat(selectedId, c.signal);
      })
      .catch((e) => {
        if (!c.signal.aborted) setChatError(e.message);
      });
    return () => c.abort();
  }, [user, selectedId, openChat]);
  useEffect(() => {
    if (!roomId || selectedId || !user || user.role !== 'seeker') return;
    const existing = items.find((i) => i.room.id === roomId);
    if (existing) {
      router.replace(`/chats?id=${encodeURIComponent(existing.id)}`);
      return;
    }
    if (draftRoom?.id === roomId) return;
    const c = new AbortController();
    queueMicrotask(() => {
      if (!c.signal.aborted) {
        setDetail(null);
        setDraftRoom(null);
      }
    });
    api
      .get(roomId, c.signal)
      .then((room) => {
        if (room.source.kind !== 'owner') throw new Error('집주인이 등록한 방만 채팅할 수 있어요.');
        setDraftRoom({
          id: room.id,
          title: room.title,
          photo: room.photos[0]?.url ?? null,
          location: room.neighborhood,
          rent: room.rent,
          deposit: room.deposit,
        });
        setChatError('');
      })
      .catch((e) => {
        if (!c.signal.aborted) setChatError(e.message);
      });
    return () => c.abort();
  }, [api, roomId, selectedId, user, items, router, draftRoom?.id]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [detail?.messages.length]);
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible' || busy) return;
      api
        .listChats()
        .then((list) => {
          setItems(list.items);
          changed();
        })
        .catch(() => {});
      if (selectedId)
        api
          .getChat(selectedId)
          .then((chat) => {
            setDetail((current) =>
              current?.id === chat.id ? { ...chat, unreadCount: 0 } : current,
            );
            if (chat.unreadCount)
              api
                .markChatRead(chat.id)
                .then(changed)
                .catch(() => {});
          })
          .catch(() => {});
    }, 12000);
    return () => clearInterval(timer);
  }, [api, user, selectedId, busy]);

  async function act(action: () => Promise<unknown>, message?: string) {
    setBusy(true);
    try {
      await action();
      if (selectedId) await openChat(selectedId);
      await refresh();
      if (message) toast.success(message);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(e?: FormEvent) {
    e?.preventDefault();
    const value = text.trim();
    if (!value || busy || value.length > 500) return;
    setBusy(true);
    try {
      if (roomId && !selectedId && draftRoom?.id === roomId) {
        const chat = await api.startChat(draftRoom.id, value);
        setText('');
        setDraftRoom(null);
        router.replace(`/chats?id=${encodeURIComponent(chat.id)}`);
      } else if (detail) {
        await api.sendChatMessage(detail.id, value);
        setText('');
        await openChat(detail.id);
      }
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }
  const active = selectedId
    ? detail?.id === selectedId
      ? detail
      : null
    : roomId
      ? draftRoom?.id === roomId
        ? draftRoom
        : null
      : null;
  const disabled =
    !!detail &&
    (detail.blocked || detail.room.status === 'closed' || detail.room.status === 'deleted');
  const exit = () => {
    setText('');
    setVisitOpen(false);
    router.push('/chats');
  };

  if (authLoading)
    return (
      <>
        <Header />
        <main className="chat-shell" aria-busy="true">
          계정을 확인하고 있어요…
        </main>
      </>
    );
  if (!user)
    return (
      <>
        <Header />
        <main className="chat-gate">
          <MessageCircle size={34} />
          <h1>대화는 로그인 후 시작할 수 있어요</h1>
          <p>{authError || '집주인과 사용자 모두 계정별 대화를 안전하게 관리할 수 있어요.'}</p>
          <Link
            className="btn primary"
            href={`/login?returnTo=${encodeURIComponent(`/chats${roomId ? `?room=${encodeURIComponent(roomId)}` : ''}`)}`}
          >
            {config.mode === 'mock' ? '역할별 체험 로그인' : '로그인하기'}
          </Link>
        </main>
      </>
    );
  return (
    <>
      <Header />
      <main className={`chat-shell ${selectedId || roomId ? 'chat-has-selection' : ''}`}>
        <div className="chat-title">
          <div>
            <p className="eyebrow">SUNROOM · CONVERSATIONS</p>
            <h1>
              대화로 이어지는
              <br />
              <em>나의 다음 방.</em>
            </h1>
            <p>매물마다 대화를 모아두고, 방문 시간까지 편하게 정해 보세요.</p>
          </div>
          <span className="chat-title-icon">
            <MessageCircle size={32} />
          </span>
        </div>
        <div className="chat-workspace">
          <aside className="chat-list" aria-label="대화 목록">
            <div className="chat-list-head">
              <div>
                <h2>메시지</h2>
                <span>{items.length}</span>
              </div>
              <p>새 메시지가 있는 대화부터 살펴보세요.</p>
            </div>
            {loading ? (
              <p className="chat-list-empty">대화를 불러오고 있어요…</p>
            ) : error ? (
              <div className="chat-list-empty" role="alert">
                <p>{error}</p>
                <button
                  onClick={() => {
                    setLoading(true);
                    void refresh().catch((e) => {
                      setError(e.message);
                      setLoading(false);
                    });
                  }}
                >
                  다시 시도
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="chat-list-empty">
                <MessageCircle size={30} />
                <b>아직 시작한 대화가 없어요</b>
                <p>
                  {user.role === 'seeker'
                    ? '집주인이 등록한 방에서 첫 메시지를 보내 보세요.'
                    : '방을 등록하면 관심 있는 사용자의 메시지가 여기에 도착해요.'}
                </p>
                <Link href={user.role === 'seeker' ? '/' : '/landlord'}>
                  {' '}
                  {user.role === 'seeker' ? '방 둘러보기' : '내 매물 보기'}{' '}
                  <ChevronRight size={15} />
                </Link>
              </div>
            ) : (
              items.map((item) => (
                <Link
                  key={item.id}
                  className={`chat-list-item ${selectedId === item.id ? 'is-active' : ''}`}
                  href={`/chats?id=${encodeURIComponent(item.id)}`}
                >
                  <div className="chat-thumb">
                    {item.room.photoUrl ? (
                      <img src={item.room.photoUrl} alt="" />
                    ) : (
                      <MessageCircle size={19} />
                    )}
                  </div>
                  <div className="chat-list-copy">
                    <div>
                      <strong>{item.otherPartyName}</strong>
                      <small>{time(item.updatedAt)}</small>
                    </div>
                    <b>{item.room.title}</b>
                    <p>
                      {item.lastMessage?.kind === 'text'
                        ? item.lastMessage.text
                        : (item.lastMessage?.text ?? '대화를 시작했어요.')}
                    </p>
                  </div>
                  {item.unreadCount > 0 && (
                    <span
                      className="chat-unread"
                      aria-label={`읽지 않은 메시지 ${item.unreadCount}개`}
                    >
                      {item.unreadCount > 99 ? '99+' : item.unreadCount}
                    </span>
                  )}
                </Link>
              ))
            )}
            <div className="chat-list-foot">
              <Check size={14} /> 이 대화는 참여한 사람에게만 보여요.
            </div>
          </aside>
          <section className="chat-panel" aria-label="선택한 대화">
            {user.role === 'landlord' && roomId && !selectedId ? (
              <div className="chat-placeholder">
                <MessageCircle size={38} />
                <h2>집주인은 받은 대화에서 답장할 수 있어요</h2>
                <button onClick={exit}>목록으로 돌아가기</button>
              </div>
            ) : chatError ? (
              <div className="chat-placeholder" role="alert">
                <h2>대화를 열지 못했어요</h2>
                <p>{chatError}</p>
                <button
                  onClick={() => {
                    if (selectedId) void openChat(selectedId).catch((e) => setChatError(e.message));
                    else if (roomId) router.refresh();
                  }}
                >
                  다시 시도
                </button>
                <button onClick={exit}>목록으로</button>
              </div>
            ) : !active ? (
              <div className="chat-placeholder">
                <span>
                  <Sparkles size={30} />
                </span>
                <h2>
                  {selectedId || roomId
                    ? '대화를 준비하고 있어요…'
                    : '어떤 방의 이야기를 나눌까요?'}
                </h2>
                <p>
                  목록에서 대화를 선택하거나, 관심 있는 방의 상세 정보에서 채팅을 시작해 보세요.
                </p>
                <Link href="/">
                  방 살펴보기 <ChevronRight size={16} />
                </Link>
              </div>
            ) : (
              <>
                <div className="chat-panel-head">
                  <button className="chat-back" aria-label="대화 목록으로" onClick={exit}>
                    <ArrowLeft size={21} />
                  </button>
                  <span className="chat-person-mark">
                    <MessageCircle size={19} />
                  </span>
                  <div>
                    <strong>{detail?.otherPartyName ?? '집주인에게 첫 메시지'}</strong>
                    <small>
                      {user.role === 'landlord' ? '방을 찾는 사용자' : '집주인'} · 연락처는 공개되지
                      않아요
                    </small>
                  </div>
                  {detail && (
                    <div className="chat-actions">
                      <button
                        type="button"
                        aria-label="대화 옵션"
                        aria-expanded={menuOpen}
                        onClick={() => setMenuOpen((v) => !v)}
                      >
                        ···
                      </button>
                      {menuOpen && (
                        <div className="chat-action-menu">
                          <button
                            onClick={() => {
                              setMenuOpen(false);
                              setSafetyAction('block');
                            }}
                          >
                            <ShieldOff size={15} /> 대화 차단
                          </button>
                          <button
                            onClick={() => {
                              setMenuOpen(false);
                              setSafetyAction('report');
                            }}
                          >
                            <Flag size={15} /> 대화 신고
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="chat-room-card">
                  <div className="chat-thumb">
                    {(detail?.room.photoUrl ?? draftRoom?.photo) ? (
                      <img
                        src={(detail?.room.photoUrl ?? draftRoom?.photo) || ''}
                        alt="매물 사진"
                      />
                    ) : (
                      <MessageCircle size={20} />
                    )}
                  </div>
                  <div>
                    <small>{detail?.room.location ?? draftRoom?.location}</small>
                    <strong>{detail?.room.title ?? draftRoom?.title}</strong>
                    <span>
                      보증금 {money(detail?.room.deposit ?? draftRoom?.deposit ?? null)} · 월세{' '}
                      {money(detail?.room.rent ?? draftRoom?.rent ?? null)}
                    </span>
                  </div>
                  {detail?.room.status === 'closed' || detail?.room.status === 'deleted' ? (
                    <span className="chat-status">
                      {detail.room.status === 'closed' ? '거래 완료' : '삭제된 매물'}
                    </span>
                  ) : detail?.room.status === 'hidden' ? (
                    <span className="chat-status">비공개 매물</span>
                  ) : null}
                </div>
                <div
                  className="chat-messages"
                  role="log"
                  aria-label="메시지 내역"
                  aria-live="polite"
                >
                  <div className="chat-safety">
                    <Check size={15} /> 방문 전에 비용과 조건을 채팅으로 확인해 보세요. 연락처는
                    표시되지 않아요.
                  </div>
                  {roomId && !selectedId && draftRoom?.id === roomId ? (
                    <div className="chat-first">
                      <Sparkles size={22} />
                      <b>첫 인사를 보내 볼까요?</b>
                      <p>궁금한 점을 골라 입력하거나 직접 메시지를 써 주세요.</p>
                    </div>
                  ) : (
                    detail?.messages.map((m) => (
                      <Message
                        key={m.id}
                        message={m}
                        mine={m.senderId === user.id}
                        messages={detail.messages}
                        disabled={disabled || busy}
                        respond={(decision) => {
                          void act(
                            () => api.respondVisit(detail.id, m.id, decision),
                            '방문 제안에 답했어요.',
                          );
                          if (decision === 'declined') setVisitOpen(true);
                        }}
                      />
                    ))
                  )}
                  <div ref={bottom} />
                </div>
                {disabled ? (
                  <div className="chat-disabled">
                    {detail?.blocked
                      ? '차단된 대화입니다. 이전 메시지는 읽을 수 있어요.'
                      : '거래가 종료된 매물입니다. 이전 메시지는 읽을 수 있어요.'}
                  </div>
                ) : (
                  <div className="chat-compose">
                    <div className="chat-quick">
                      {starter.map((q) => (
                        <button key={q} type="button" onClick={() => setText(q)}>
                          {q}
                        </button>
                      ))}
                    </div>
                    {detail && (
                      <>
                        <button
                          className="chat-visit-toggle"
                          onClick={() => setVisitOpen((v) => !v)}
                        >
                          <CalendarDays size={16} /> 방문 시간 제안{' '}
                          {visitOpen ? <X size={15} /> : <ChevronRight size={15} />}
                        </button>
                        {visitOpen && (
                          <form
                            className="chat-visit-form"
                            onSubmit={(e) => {
                              e.preventDefault();
                              const parsed = new Date(visitAt);
                              if (
                                !Number.isFinite(parsed.getTime()) ||
                                parsed.getTime() <= Date.now()
                              ) {
                                toast.error('미래의 방문 시간을 선택해 주세요.');
                                return;
                              }
                              void act(
                                () => api.proposeVisit(detail.id, parsed.toISOString()),
                                '방문 시간을 제안했어요.',
                              );
                              setVisitOpen(false);
                              setVisitAt('');
                            }}
                          >
                            <label>
                              방문 날짜와 시간
                              <input
                                aria-label="방문 날짜와 시간"
                                type="datetime-local"
                                required
                                value={visitAt}
                                onChange={(e) => setVisitAt(e.target.value)}
                              />
                            </label>
                            <button disabled={busy} type="submit">
                              시간 보내기
                            </button>
                          </form>
                        )}
                      </>
                    )}
                    <form className="chat-send-form" onSubmit={send}>
                      <label className="sr-only" htmlFor="chat-message">
                        메시지 입력
                      </label>
                      <textarea
                        id="chat-message"
                        placeholder="집주인에게 궁금한 점을 물어보세요…"
                        maxLength={500}
                        rows={2}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={onKeyDown}
                        disabled={busy}
                      />
                      <button
                        type="submit"
                        disabled={!text.trim() || busy}
                        aria-label="메시지 보내기"
                      >
                        <Send size={18} />
                      </button>
                    </form>
                    <small>Enter로 보내기 · Shift + Enter로 줄바꿈 · {text.length}/500</small>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </main>
      <Dialog
        open={!!safetyAction}
        onOpenChange={(open) => {
          if (!open) setSafetyAction(null);
        }}
      >
        <DialogContent className="chat-safety-dialog">
          <DialogTitle>
            {safetyAction === 'block' ? '대화를 차단할까요?' : '대화를 신고할까요?'}
          </DialogTitle>
          <DialogDescription>
            {safetyAction === 'block'
              ? '차단하면 양쪽 모두 새 메시지를 보낼 수 없고, 이전 기록은 볼 수 있어요.'
              : '신고 이유를 선택해 주세요. 신고 내용은 검토를 위해 전달돼요.'}
          </DialogDescription>
          {safetyAction === 'report' && (
            <label className="chat-reason">
              신고 이유
              <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
                <option value="spam">스팸·광고</option>
                <option value="inappropriate">불쾌한 대화</option>
                <option value="other">기타</option>
              </select>
            </label>
          )}
          <div className="chat-safety-buttons">
            <button type="button" onClick={() => setSafetyAction(null)}>
              취소
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!detail || !safetyAction) return;
                const action = safetyAction;
                setSafetyAction(null);
                void act(
                  () =>
                    action === 'block'
                      ? api.blockChat(detail.id)
                      : api.reportChat(detail.id, reason),
                  action === 'block' ? '대화를 차단했어요.' : '신고를 접수했어요.',
                );
              }}
            >
              {safetyAction === 'block' ? '차단하기' : '신고하기'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Message({
  message,
  mine,
  messages,
  disabled,
  respond,
}: {
  message: ChatMessage;
  mine: boolean;
  messages: ChatMessage[];
  disabled: boolean;
  respond: (decision: 'accepted' | 'declined') => void;
}) {
  const answered = messages.find((m) => m.kind === 'visit_response' && m.proposalId === message.id);
  return (
    <div className={`chat-bubble-row ${mine ? 'mine' : ''}`}>
      <div className={`chat-bubble ${message.kind !== 'text' ? 'chat-visit-bubble' : ''}`}>
        {message.kind !== 'text' && (
          <span className="chat-bubble-label">
            <CalendarDays size={15} /> 방문 일정
          </span>
        )}
        <p>
          {message.kind === 'visit_proposal'
            ? `${time(message.visitAt!)}에 방문할 수 있을까요?`
            : message.text}
        </p>
        {message.kind === 'visit_proposal' && (
          <>
            {answered ? (
              <strong className="chat-visit-answer">
                {answered.decision === 'accepted' ? '방문 확정' : '방문 거절'}
              </strong>
            ) : !mine && !disabled ? (
              <div className="chat-response">
                <button onClick={() => respond('accepted')}>수락하기</button>
                <button onClick={() => respond('declined')}>다른 시간 제안</button>
              </div>
            ) : null}
          </>
        )}
        <small>{time(message.createdAt)}</small>
      </div>
    </div>
  );
}
