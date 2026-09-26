import { z } from 'zod';
import {
  VerificationStatusSchema,
  VerificationInputSchema,
  MAX_PROOF_BYTES,
  PROOF_TYPES,
  type VerificationStatus,
  type VerificationInput,
} from '../contracts/verification';
import { createMockGateway } from './mock/landlord-gateway';
import { ApiError } from './errors';
export { ApiError } from './errors';
import { validatePhoto } from './photos';
import {
  ChatDetailSchema,
  ChatsResponseSchema,
  ChatMessageSchema,
  StartChatSchema,
  ChatTextSchema,
  VisitDecisionSchema,
  ReportReasonSchema,
  type ChatDetail,
  type ChatSummary,
  type ChatMessage,
  type VisitDecision,
} from '../contracts/chat';
import {
  OwnerListingSchema,
  OwnerListingsSchema,
  InboxSchema,
  ListingStatusSchema,
  DraftRequestSchema,
  DraftResponseSchema,
  UploadResponseSchema,
  type OwnerListing,
  type ListingStatus,
  type InboxItem,
  type DraftRequest,
  type DraftResponse,
  type UploadResponse,
} from '../contracts/landlord';
import {
  RoomSchema,
  RoomsResponseSchema,
  UserSchema,
  RecommendationSchema,
  RecommendationRequestSchema,
  RoomSubmissionSchema,
  RoomSubmissionResponseSchema,
  InquiryRequestSchema,
  InquiryResponseSchema,
  type AppConfig,
  type Room,
  type Search,
  type RecommendationRequest,
  type Recommendation,
  type User,
  type Role,
  type RoomSubmission,
  type RoomSubmissionResponse,
  type InquiryRequest,
  type InquiryResponse,
} from '../contracts/schemas';
import { rulesSummary, safeReturnPath } from '../domain/rooms';
export interface Gateway {
  list(search: Search, signal?: AbortSignal): Promise<{ items: Room[]; total: number }>;
  get(id: string, signal?: AbortSignal): Promise<Room>;
  recommend(request: RecommendationRequest, signal?: AbortSignal): Promise<Recommendation>;
  submitRoom(input: RoomSubmission, signal?: AbortSignal): Promise<RoomSubmissionResponse>;
  inquire(input: InquiryRequest, signal?: AbortSignal): Promise<InquiryResponse>;
  listChats(signal?: AbortSignal): Promise<{ items: ChatSummary[] }>;
  getChat(id: string, signal?: AbortSignal): Promise<ChatDetail>;
  startChat(roomId: string, message: string, signal?: AbortSignal): Promise<ChatDetail>;
  sendChatMessage(id: string, message: string, signal?: AbortSignal): Promise<ChatMessage>;
  markChatRead(id: string, signal?: AbortSignal): Promise<void>;
  proposeVisit(id: string, visitAt: string, signal?: AbortSignal): Promise<ChatMessage>;
  respondVisit(
    id: string,
    proposalId: string,
    decision: VisitDecision,
    signal?: AbortSignal,
  ): Promise<ChatMessage>;
  blockChat(id: string, signal?: AbortSignal): Promise<ChatDetail>;
  reportChat(
    id: string,
    reason: 'spam' | 'inappropriate' | 'other',
    signal?: AbortSignal,
  ): Promise<void>;
  me(signal?: AbortSignal): Promise<User | null>;
  login(email: string, password: string): Promise<User>;
  register(email: string, password: string, role?: Role): Promise<User>;
  demoLogin(role: Role): Promise<User>;
  getOwnerVerification(signal?: AbortSignal): Promise<VerificationStatus>;
  submitOwnerVerification(
    input: VerificationInput,
    proof: File,
    signal?: AbortSignal,
  ): Promise<VerificationStatus>;
  myRooms(signal?: AbortSignal): Promise<{ items: OwnerListing[] }>;
  updateRoom(id: string, input: RoomSubmission, signal?: AbortSignal): Promise<OwnerListing>;
  setRoomStatus(id: string, status: ListingStatus, signal?: AbortSignal): Promise<OwnerListing>;
  deleteRoom(id: string, signal?: AbortSignal): Promise<void>;
  inbox(signal?: AbortSignal): Promise<{ items: InboxItem[] }>;
  readInquiry(id: string, signal?: AbortSignal): Promise<void>;
  generateDraft(input: DraftRequest, signal?: AbortSignal): Promise<DraftResponse>;
  uploadPhoto(file: File, signal?: AbortSignal): Promise<UploadResponse>;
  logout(): Promise<void>;
  oauth(provider: 'kakao' | 'google', returnTo: string): Promise<string>;
}
const publicErrors: Record<string, string> = {
  EMAIL_EXISTS: '이미 가입된 이메일이에요. 로그인을 시도해 주세요.',
  INVALID_CREDENTIALS: '이메일 또는 비밀번호를 확인해 주세요.',
  RATE_LIMITED: '요청이 많아요. 잠시 후 다시 시도해 주세요.',
  ACCOUNT_LINK_REQUIRED: '동일 이메일의 계정이 있어요. 기존 로그인 방식으로 로그인해 주세요.',
  OAUTH_CANCELLED: '로그인이 취소되었어요. 다시 시도할 수 있어요.',
  FORBIDDEN: '이 작업을 할 권한이 없어요.',
  INVALID_TRANSITION: '현재 상태에서는 변경할 수 없어요. 목록을 새로고침해 주세요.',
  CHAT_BLOCKED: '차단된 대화에는 메시지를 보낼 수 없어요.',
  ROOM_CLOSED: '거래가 종료되어 새 메시지를 보낼 수 없어요.',
  VERIFICATION_REQUIRED: '매물 등록 전에 집주인 인증을 완료해 주세요.',
};
export function createGateway(config: AppConfig): Gateway {
  if (config.mode === 'mock') return createMockGateway();
  const base = config.apiBaseUrl.replace(/\/$/, '');
  async function request<T>(
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    options: { method?: string; body?: unknown; signal?: AbortSignal; timeout?: number } = {},
  ): Promise<T> {
    const controller = new AbortController(),
      abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timer = setTimeout(abort, options.timeout ?? 12000);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      const multipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
      if (options.body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
      if (options.method && options.method !== 'GET') {
        const csrf = await fetch(`${base}/auth/csrf`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!csrf.ok)
          throw new ApiError('CSRF', '요청을 준비하지 못했어요. 다시 시도해 주세요.', csrf.status);
        headers['X-CSRF-Token'] = z
          .object({ token: z.string().min(1) })
          .parse(await csrf.json()).token;
      }
      const response = await fetch(`${base}${path}`, {
        method: options.method ?? 'GET',
        headers,
        credentials: 'include',
        body: multipart
          ? (options.body as FormData)
          : options.body === undefined
            ? undefined
            : JSON.stringify(options.body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        const parsed = z.object({ error: z.object({ code: z.string() }) }).safeParse(json);
        const code = parsed.success ? parsed.data.error.code : 'REQUEST_FAILED';
        throw new ApiError(
          code,
          publicErrors[code] ??
            (response.status === 404
              ? '이 방을 찾을 수 없어요.'
              : response.status === 401
                ? '로그인이 필요해요.'
                : response.status === 429
                  ? '요청이 많아요. 잠시 후 다시 시도해 주세요.'
                  : '요청을 완료하지 못했어요. 다시 시도해 주세요.'),
          response.status,
        );
      }
      if (response.status === 204) return schema.parse(null);
      const result = schema.safeParse(await response.json());
      if (!result.success)
        throw new ApiError(
          'INVALID_RESPONSE',
          '정보 형식이 올바르지 않아요. 잠시 후 다시 시도해 주세요.',
        );
      return result.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (controller.signal.aborted)
        throw new ApiError('TIMEOUT', '응답이 늦어지고 있어요. 다시 시도해 주세요.');
      throw new ApiError('NETWORK', '연결을 확인하고 다시 시도해 주세요.');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }
  const gateway: Gateway = {
    listChats: (signal) => request('/chats', ChatsResponseSchema, { signal }),
    getChat: (id, signal) =>
      request(`/chats/${encodeURIComponent(id)}`, ChatDetailSchema, { signal }),
    startChat: (roomId, message, signal) =>
      request('/chats', ChatDetailSchema, {
        method: 'POST',
        body: StartChatSchema.parse({ roomId, message }),
        signal,
      }),
    sendChatMessage: (id, message, signal) =>
      request(`/chats/${encodeURIComponent(id)}/messages`, ChatMessageSchema, {
        method: 'POST',
        body: { message: ChatTextSchema.parse(message) },
        signal,
      }),
    markChatRead: (id, signal) =>
      request(`/chats/${encodeURIComponent(id)}/read`, z.null(), {
        method: 'PATCH',
        signal,
      }).then(() => undefined),
    proposeVisit: (id, visitAt, signal) =>
      request(`/chats/${encodeURIComponent(id)}/visits`, ChatMessageSchema, {
        method: 'POST',
        body: { visitAt: z.string().datetime().parse(visitAt) },
        signal,
      }),
    respondVisit: (id, proposalId, decision, signal) =>
      request(
        `/chats/${encodeURIComponent(id)}/visits/${encodeURIComponent(proposalId)}/response`,
        ChatMessageSchema,
        {
          method: 'POST',
          body: { decision: VisitDecisionSchema.parse(decision) },
          signal,
        },
      ),
    blockChat: (id, signal) =>
      request(`/chats/${encodeURIComponent(id)}/block`, ChatDetailSchema, {
        method: 'POST',
        signal,
      }),
    reportChat: (id, reason, signal) =>
      request(
        `/chats/${encodeURIComponent(id)}/reports`,
        z.object({ status: z.literal('received') }),
        {
          method: 'POST',
          body: { reason: ReportReasonSchema.parse(reason) },
          signal,
        },
      ).then(() => undefined),
    async demoLogin() {
      throw new ApiError('FORBIDDEN', '임시 로그인은 시연 모드에서만 사용할 수 있어요.', 403);
    },
    getOwnerVerification: (signal) =>
      request('/owner/verification', VerificationStatusSchema, { signal }),
    submitOwnerVerification: (input, proof, signal) => {
      const valid = VerificationInputSchema.parse(input);
      if (
        !PROOF_TYPES.includes(proof.type as (typeof PROOF_TYPES)[number]) ||
        proof.size > MAX_PROOF_BYTES ||
        proof.size === 0
      )
        throw new ApiError('INVALID_PROOF', 'PDF·JPG·PNG 파일을 5MB 이하로 선택해 주세요.');
      const body = new FormData();
      body.append('ownerName', valid.ownerName);
      body.append('buildingAddress', valid.buildingAddress);
      body.append('consent', 'true');
      body.append('proof', proof);
      return request('/owner/verification', VerificationStatusSchema, {
        method: 'POST',
        body,
        signal,
        timeout: 30000,
      });
    },
    myRooms: (signal) => request('/owner/rooms', OwnerListingsSchema, { signal }),
    updateRoom: (id, input, signal) =>
      request(`/owner/rooms/${encodeURIComponent(id)}`, OwnerListingSchema, {
        method: 'PATCH',
        body: RoomSubmissionSchema.parse(input),
        signal,
      }),
    setRoomStatus: (id, status, signal) =>
      request(`/owner/rooms/${encodeURIComponent(id)}/status`, OwnerListingSchema, {
        method: 'PATCH',
        body: { status: ListingStatusSchema.parse(status) },
        signal,
      }),
    deleteRoom: (id, signal) =>
      request(`/owner/rooms/${encodeURIComponent(id)}`, z.null(), {
        method: 'DELETE',
        signal,
      }).then(() => undefined),
    inbox: (signal) => request('/owner/inquiries', InboxSchema, { signal }),
    readInquiry: (id, signal) =>
      request(`/owner/inquiries/${encodeURIComponent(id)}/read`, z.null(), {
        method: 'PATCH',
        signal,
      }).then(() => undefined),
    generateDraft: (input, signal) =>
      request('/rooms/draft', DraftResponseSchema, {
        method: 'POST',
        body: DraftRequestSchema.parse(input),
        signal,
        timeout: 20000,
      }),
    uploadPhoto: (file, signal) => {
      validatePhoto(file);
      const body = new FormData();
      body.append('file', file);
      return request('/owner/photos', UploadResponseSchema, {
        method: 'POST',
        body,
        signal,
        timeout: 20000,
      });
    },
    list: (search, signal) =>
      request(`/rooms?search=${encodeURIComponent(JSON.stringify(search))}`, RoomsResponseSchema, {
        signal,
      }),
    get: (id, signal) => request(`/rooms/${encodeURIComponent(id)}`, RoomSchema, { signal }),
    submitRoom: (input, signal) => {
      const body = RoomSubmissionSchema.parse(input);
      return request('/rooms', RoomSubmissionResponseSchema, { method: 'POST', body, signal });
    },
    inquire: (input, signal) => {
      const body = InquiryRequestSchema.parse(input);
      return request(
        `/rooms/${encodeURIComponent(input.roomId)}/inquiries`,
        InquiryResponseSchema,
        {
          method: 'POST',
          body,
          signal,
        },
      );
    },
    async recommend(input, signal) {
      const body = RecommendationRequestSchema.parse(input);
      try {
        const result = await request('/recommendations', RecommendationSchema, {
          method: 'POST',
          body,
          signal,
          timeout: 20000,
        });
        if (
          result.items.length !== body.roomIds.length ||
          new Set(result.items.map((x) => x.roomId)).size !== result.items.length ||
          result.items.some((x) => !body.roomIds.includes(x.roomId))
        )
          throw new ApiError('INVALID_RESPONSE', '추천 대상이 일치하지 않아요.');
        return result;
      } catch (error) {
        if (signal?.aborted) throw error;
        const rooms = await Promise.all(body.roomIds.map((id) => gateway.get(id, signal)));
        return rulesSummary(
          rooms,
          body.filters,
          '추천 응답을 받지 못해 확인된 매물 정보로 요약했어요.',
        );
      }
    },
    async me(signal) {
      try {
        return await request('/auth/me', UserSchema, { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    login: (email, password) =>
      request('/auth/login', UserSchema, { method: 'POST', body: { email, password } }),
    register: (email, password, role = 'seeker') =>
      request('/auth/register', UserSchema, {
        method: 'POST',
        body: { email, password, role, termsVersion: '2026-09-22', agreed: true },
      }),
    logout: () => request('/auth/logout', z.null(), { method: 'POST' }).then(() => undefined),
    async oauth(provider, returnTo) {
      const result = await request(
        `/auth/oauth/${provider}/start`,
        z.object({ authorizationUrl: z.string().url() }),
        { method: 'POST', body: { returnTo: safeReturnPath(returnTo) } },
      );
      const url = new URL(result.authorizationUrl);
      const allowed = provider === 'kakao' ? ['kauth.kakao.com'] : ['accounts.google.com'];
      if (url.protocol !== 'https:' || !allowed.includes(url.hostname))
        throw new ApiError('OAUTH_URL', '로그인 주소를 확인할 수 없어요.');
      return result.authorizationUrl;
    },
  };
  return gateway;
}
