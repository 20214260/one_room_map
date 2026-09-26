import { z } from 'zod';
import {
  VerificationInputSchema,
  VerificationStatusSchema,
  emptyVerification,
  MAX_PROOF_BYTES,
  PROOF_TYPES,
  type VerificationStatus,
} from '../../contracts/verification';
import type { Gateway } from '../gateway';
import { ApiError } from '../errors';
import {
  UserSchema,
  RoleSchema,
  RoomSubmissionSchema,
  InquiryRequestSchema,
  RecommendationRequestSchema,
  type Role,
  type Room,
} from '../../contracts/schemas';
import { OwnerListingSchema, InboxItemSchema, ListingStatusSchema } from '../../contracts/landlord';
import { searchRooms, rulesSummary, submissionToRoom } from '../../domain/rooms';
import { createRulesDraft } from '../../domain/listing-draft';
import { mockRooms } from './data';
import { validatePhoto } from '../photos';
import {
  ChatTextSchema,
  StartChatSchema,
  StoredChatSchema,
  ReportReasonSchema,
  VisitDecisionSchema,
  type StoredChat,
  type ChatMessage,
  type ChatDetail,
  type ChatSummary,
} from '../../contracts/chat';

const KEY = 'sunroom.demo.v1';
const StateSchema = z.object({
  user: UserSchema.nullable(),
  listings: z.array(OwnerListingSchema),
  inquiries: z.array(InboxItemSchema.extend({ ownerId: z.string() })),
  chats: z.array(StoredChatSchema).default([]),
  verifications: z.record(VerificationStatusSchema).default({}),
});
type State = z.infer<typeof StateSchema>;
const initial = (): State => ({
  user: null,
  listings: [],
  inquiries: [],
  chats: [],
  verifications: {},
});
const id = () => globalThis.crypto.randomUUID();

export function createMockGateway(): Gateway {
  let state = initial();
  let hydrated = false;
  function read() {
    if (!hydrated && typeof window !== 'undefined') {
      try {
        const raw = window.sessionStorage.getItem(KEY);
        if (raw) state = StateSchema.parse(JSON.parse(raw));
      } catch {
        state = initial();
      }
      hydrated = true;
    }
    return state;
  }
  function save(next: State) {
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        throw new ApiError(
          'STORAGE_FULL',
          '시연 저장 공간이 부족해요. 사진 수를 줄이거나 크기를 줄여 주세요.',
        );
      }
    }
    state = next;
  }
  async function wait(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    read();
  }
  function user(role?: Role) {
    const u = read().user;
    if (!u) throw new ApiError('UNAUTHORIZED', '로그인 후 이용해 주세요.', 401);
    if (role && u.role !== role)
      throw new ApiError('FORBIDDEN', '집주인 계정에서 이용할 수 있어요.', 403);
    return u;
  }
  function verification(): VerificationStatus {
    const u = user('landlord');
    if (u.id === 'demo-landlord')
      return {
        ...emptyVerification,
        status: 'approved',
        message: '기존 시연 계정입니다. 실제 소유권 인증이 아닙니다.',
      };
    return read().verifications[u.id] ?? emptyVerification;
  }
  function requireApproved() {
    if (verification().status !== 'approved')
      throw new ApiError(
        'VERIFICATION_REQUIRED',
        '집주인 인증을 신청한 뒤 승인받아야 매물을 등록할 수 있어요.',
        403,
      );
  }
  function owned(roomId: string) {
    const u = user('landlord');
    const row = read().listings.find((r) => r.id === roomId && r.ownerId === u.id);
    if (!row) throw new ApiError('NOT_FOUND', '관리할 매물을 찾을 수 없어요.', 404);
    return row;
  }
  function publicRooms(): Room[] {
    return [
      ...mockRooms,
      ...read()
        .listings.filter((r) => r.status === 'published')
        .map((r) => {
          const room = submissionToRoom(r.submission, r.id);
          return {
            ...room,
            source: {
              ...room.source,
              note: '시연용 직접 등록 매물입니다. 실제 거래 대상이 아니에요.',
            },
          };
        }),
    ];
  }
  function chatFor(id: string) {
    const u = user();
    const chat = read().chats.find(
      (c) => c.id === id && (c.ownerId === u.id || c.seekerId === u.id),
    );
    if (!chat) throw new ApiError('NOT_FOUND', '대화를 찾을 수 없어요.', 404);
    return chat;
  }
  function snapshot(chat: StoredChat) {
    const listing = read().listings.find((r) => r.id === chat.room.id);
    if (!listing) return { ...chat.room, status: 'deleted' as const };
    const room = submissionToRoom(listing.submission, listing.id);
    return {
      ...chat.room,
      title: room.title,
      photoUrl: room.photos[0]?.url ?? null,
      location: room.neighborhood,
      deposit: room.deposit,
      rent: room.rent,
      maintenance: room.maintenance,
      status: listing.status,
    };
  }
  function summary(chat: StoredChat): ChatSummary {
    const u = user();
    const mine = u.id === chat.ownerId;
    const lastSeen = mine ? chat.seenOwner : chat.seenSeeker;
    const seenIndex = chat.messages.findIndex((m) => m.id === lastSeen);
    return {
      id: chat.id,
      room: snapshot(chat),
      otherPartyName: mine ? chat.seekerName : chat.ownerName,
      unreadCount: chat.messages.slice(seenIndex + 1).filter((m) => m.senderId !== u.id).length,
      lastMessage: chat.messages.at(-1) ?? null,
      updatedAt: chat.messages.at(-1)?.createdAt ?? new Date(0).toISOString(),
      blocked: !!chat.blockedBy,
    };
  }
  function detail(chat: StoredChat): ChatDetail {
    return { ...summary(chat), messages: structuredClone(chat.messages) };
  }
  function message(
    senderId: string,
    kind: ChatMessage['kind'],
    text: string,
    visitAt: string | null = null,
    proposalId: string | null = null,
    decision: ChatMessage['decision'] = null,
  ): ChatMessage {
    return {
      id: id(),
      senderId,
      kind,
      text,
      createdAt: new Date().toISOString(),
      visitAt,
      proposalId,
      decision,
    };
  }
  function writable(chat: StoredChat) {
    if (chat.blockedBy)
      throw new ApiError('CHAT_BLOCKED', '차단된 대화에는 메시지를 보낼 수 없어요.', 403);
    if (snapshot(chat).status === 'closed' || snapshot(chat).status === 'deleted')
      throw new ApiError('ROOM_CLOSED', '거래가 종료되어 새 메시지를 보낼 수 없어요.', 409);
  }
  function updateChat(next: StoredChat) {
    save({ ...read(), chats: read().chats.map((c) => (c.id === next.id ? next : c)) });
  }
  const api: Gateway = {
    async listChats(signal) {
      await wait(signal);
      user();
      return {
        items: state.chats
          .filter((c) => c.ownerId === user().id || c.seekerId === user().id)
          .map(summary)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      };
    },
    async getChat(chatId, signal) {
      await wait(signal);
      return detail(chatFor(chatId));
    },
    async startChat(roomId, text, signal) {
      await wait(signal);
      const u = user('seeker');
      StartChatSchema.parse({ roomId, message: text });
      const existing = state.chats.find((c) => c.room.id === roomId && c.seekerId === u.id);
      if (existing) {
        writable(existing);
        const next = {
          ...existing,
          messages: [...existing.messages, message(u.id, 'text', ChatTextSchema.parse(text))],
        };
        updateChat(next);
        return detail(next);
      }
      const listing = state.listings.find((r) => r.id === roomId && r.status === 'published');
      if (!listing)
        throw new ApiError('NOT_FOUND', '직접 등록한 공개 매물에만 대화를 시작할 수 있어요.', 404);
      const room = submissionToRoom(listing.submission, listing.id);
      const chat: StoredChat = {
        id: id(),
        room: {
          id: room.id,
          title: room.title,
          photoUrl: room.photos[0]?.url ?? null,
          location: room.neighborhood,
          deposit: room.deposit,
          rent: room.rent,
          maintenance: room.maintenance,
          status: 'published',
        },
        ownerId: listing.ownerId,
        seekerId: u.id,
        ownerName: '집주인',
        seekerName: u.name,
        messages: [message(u.id, 'text', ChatTextSchema.parse(text))],
        seenOwner: null,
        seenSeeker: null,
        blockedBy: null,
        reports: [],
      };
      save({ ...state, chats: [...state.chats, chat] });
      return detail(chat);
    },
    async sendChatMessage(chatId, text, signal) {
      await wait(signal);
      const chat = chatFor(chatId);
      writable(chat);
      const item = message(user().id, 'text', ChatTextSchema.parse(text));
      updateChat({ ...chat, messages: [...chat.messages, item] });
      return item;
    },
    async markChatRead(chatId, signal) {
      await wait(signal);
      const chat = chatFor(chatId);
      const last = chat.messages.at(-1)?.id ?? null;
      updateChat(
        user().id === chat.ownerId ? { ...chat, seenOwner: last } : { ...chat, seenSeeker: last },
      );
    },
    async proposeVisit(chatId, visitAt, signal) {
      await wait(signal);
      const chat = chatFor(chatId);
      writable(chat);
      const date = new Date(visitAt);
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())
        throw new ApiError('INVALID_VISIT', '미래의 방문 시간을 선택해 주세요.', 400);
      const item = message(
        user().id,
        'visit_proposal',
        '방문 시간을 제안했어요.',
        date.toISOString(),
      );
      updateChat({ ...chat, messages: [...chat.messages, item] });
      return item;
    },
    async respondVisit(chatId, proposalId, decision, signal) {
      await wait(signal);
      const chat = chatFor(chatId);
      writable(chat);
      VisitDecisionSchema.parse(decision);
      const proposal = chat.messages.find(
        (m) => m.id === proposalId && m.kind === 'visit_proposal',
      );
      if (!proposal || proposal.senderId === user().id)
        throw new ApiError('NOT_FOUND', '방문 제안을 찾을 수 없어요.', 404);
      if (chat.messages.some((m) => m.kind === 'visit_response' && m.proposalId === proposalId))
        throw new ApiError('INVALID_TRANSITION', '이미 답변한 방문 제안이에요.', 409);
      const item = message(
        user().id,
        'visit_response',
        decision === 'accepted' ? '방문 시간을 수락했어요.' : '방문 시간을 거절했어요.',
        proposal.visitAt,
        proposalId,
        decision,
      );
      updateChat({ ...chat, messages: [...chat.messages, item] });
      return item;
    },
    async blockChat(chatId, signal) {
      await wait(signal);
      const chat = chatFor(chatId);
      const next = { ...chat, blockedBy: user().id };
      updateChat(next);
      return detail(next);
    },
    async reportChat(chatId, reason, signal) {
      await wait(signal);
      const chat = chatFor(chatId);
      ReportReasonSchema.parse(reason);
      if (!chat.reports.some((r) => r.userId === user().id))
        updateChat({ ...chat, reports: [...chat.reports, { userId: user().id, reason }] });
    },
    async list(search, signal) {
      await wait(signal);
      const items = searchRooms(publicRooms(), search);
      return structuredClone({ items, total: items.length });
    },
    async get(roomId, signal) {
      await wait(signal);
      const room = publicRooms().find((r) => r.id === roomId);
      if (!room) throw new ApiError('NOT_FOUND', '이 방은 더 이상 조회할 수 없어요.', 404);
      return structuredClone(room);
    },
    async recommend(input, signal) {
      RecommendationRequestSchema.parse(input);
      const rooms = await Promise.all(input.roomIds.map((roomId) => api.get(roomId, signal)));
      return rulesSummary(rooms, input.filters, '샘플 환경에서는 규칙 기반 요약을 제공해요.');
    },
    async me(signal) {
      await wait(signal);
      return structuredClone(read().user);
    },
    async demoLogin(role) {
      RoleSchema.parse(role);
      const u = {
        id: `demo-${role}`,
        name: role === 'landlord' ? '시연 집주인' : '시연 사용자',
        email: `${role}@sunroom.example`,
        provider: 'email' as const,
        role,
      };
      save({ ...read(), user: u });
      return structuredClone(u);
    },
    async getOwnerVerification(signal) {
      await wait(signal);
      return structuredClone(verification());
    },
    async submitOwnerVerification(input, proof, signal) {
      await wait(signal);
      const u = user('landlord');
      VerificationInputSchema.parse(input);
      if (
        !PROOF_TYPES.includes(proof.type as (typeof PROOF_TYPES)[number]) ||
        proof.size > MAX_PROOF_BYTES ||
        proof.size === 0
      )
        throw new ApiError('INVALID_PROOF', 'PDF·JPG·PNG 파일을 5MB 이하로 선택해 주세요.');
      // Demo only records a status. Names, addresses and evidence never enter sessionStorage.
      const next: VerificationStatus = {
        status: 'reviewing',
        applicationId: id(),
        submittedAt: new Date().toISOString(),
        message:
          '시연에서는 실제 서류를 전송하거나 판정하지 않습니다. 관리자 심사 대기 상태를 보여줘요.',
      };
      save({ ...read(), verifications: { ...read().verifications, [u.id]: next } });
      return structuredClone(next);
    },
    async register(email, _password, role = 'seeker') {
      const u = UserSchema.parse({
        id: `demo-${id()}`,
        name: '임시 가입자',
        email,
        provider: 'email',
        role,
      });
      save({ ...read(), user: u });
      return structuredClone(u);
    },
    async login() {
      throw new ApiError('DEMO', '시연 환경에서는 아래 역할별 체험 버튼으로 로그인해 주세요.');
    },
    async logout() {
      save({ ...read(), user: null });
    },
    async oauth() {
      throw new ApiError(
        'DEMO',
        '소셜 로그인은 연결 준비 중이에요. 역할별 체험 버튼을 이용해 주세요.',
      );
    },
    async submitRoom(input, signal) {
      await wait(signal);
      const u = user('landlord');
      requireApproved();
      const submission = RoomSubmissionSchema.omit({ pastedListingText: true }).parse(input);
      const roomId = `owner-${id()}`;
      save({
        ...state,
        listings: [
          ...state.listings,
          {
            id: roomId,
            ownerId: u.id,
            submission,
            status: 'published',
            updatedAt: new Date().toISOString(),
          },
        ],
      });
      return { roomId, status: 'published' };
    },
    async myRooms(signal) {
      await wait(signal);
      const u = user('landlord');
      return { items: structuredClone(state.listings.filter((r) => r.ownerId === u.id)) };
    },
    async updateRoom(roomId, input, signal) {
      await wait(signal);
      const row = owned(roomId);
      const submission = RoomSubmissionSchema.omit({ pastedListingText: true }).parse(input);
      const next = { ...row, submission, updatedAt: new Date().toISOString() };
      save({ ...state, listings: state.listings.map((r) => (r.id === roomId ? next : r)) });
      return structuredClone(next);
    },
    async setRoomStatus(roomId, status, signal) {
      await wait(signal);
      const row = owned(roomId);
      ListingStatusSchema.parse(status);
      const next = { ...row, status, updatedAt: new Date().toISOString() };
      save({ ...state, listings: state.listings.map((r) => (r.id === roomId ? next : r)) });
      return structuredClone(next);
    },
    async deleteRoom(roomId, signal) {
      await wait(signal);
      owned(roomId);
      save({
        ...state,
        listings: state.listings.filter((r) => r.id !== roomId),
        inquiries: state.inquiries.filter((i) => i.roomId !== roomId),
      });
    },
    async inquire(input, signal) {
      await wait(signal);
      user();
      const parsed = InquiryRequestSchema.parse(input);
      const row = state.listings.find((r) => r.id === parsed.roomId && r.status === 'published');
      if (!row)
        throw new ApiError(
          'NOT_FOUND',
          '시연에서는 집주인이 직접 등록한 공개 매물에 문의할 수 있어요.',
          404,
        );
      if (row.ownerId === user().id)
        throw new ApiError('OWN_ROOM', '내 매물에는 문의할 수 없어요.');
      // Reply contact is validated but deliberately not stored in this browser demo.
      save({
        ...state,
        inquiries: [
          ...state.inquiries,
          {
            id: id(),
            ownerId: row.ownerId,
            roomId: row.id,
            roomTitle: row.submission.title,
            message: parsed.message,
            createdAt: new Date().toISOString(),
            read: false,
          },
        ],
      });
      return { status: 'sent' };
    },
    async inbox(signal) {
      await wait(signal);
      const u = user('landlord');
      return {
        items: state.inquiries
          .filter((i) => i.ownerId === u.id)
          .map((i) => InboxItemSchema.parse(i)),
      };
    },
    async readInquiry(inquiryId, signal) {
      await wait(signal);
      const u = user('landlord');
      if (!state.inquiries.some((i) => i.id === inquiryId && i.ownerId === u.id))
        throw new ApiError('NOT_FOUND', '문의를 찾을 수 없어요.', 404);
      save({
        ...state,
        inquiries: state.inquiries.map((i) => (i.id === inquiryId ? { ...i, read: true } : i)),
      });
    },
    async generateDraft(input, signal) {
      await wait(signal);
      user('landlord');
      return createRulesDraft(input);
    },
    async uploadPhoto(file, signal) {
      await wait(signal);
      user('landlord');
      requireApproved();
      validatePhoto(file);
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('사진을 읽지 못했어요.'));
        reader.readAsDataURL(file);
      });
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return { photo: { url, alt: '등록자가 제공한 방 사진' } };
    },
  };
  return api;
}
