import { z } from 'zod';
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
  type RoomSubmission,
  type RoomSubmissionResponse,
  type InquiryRequest,
  type InquiryResponse,
} from '../contracts/schemas';
import { searchRooms, rulesSummary, safeReturnPath, submissionToRoom } from '../domain/rooms';
import { mockRooms } from './mock/data';
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
export interface Gateway {
  list(search: Search, signal?: AbortSignal): Promise<{ items: Room[]; total: number }>;
  get(id: string, signal?: AbortSignal): Promise<Room>;
  recommend(request: RecommendationRequest, signal?: AbortSignal): Promise<Recommendation>;
  submitRoom(input: RoomSubmission, signal?: AbortSignal): Promise<RoomSubmissionResponse>;
  inquire(input: InquiryRequest, signal?: AbortSignal): Promise<InquiryResponse>;
  me(signal?: AbortSignal): Promise<User | null>;
  login(email: string, password: string): Promise<User>;
  register(email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  oauth(provider: 'kakao' | 'google', returnTo: string): Promise<string>;
}
const publicErrors: Record<string, string> = {
  EMAIL_EXISTS: '이미 가입된 이메일이에요. 로그인을 시도해 주세요.',
  INVALID_CREDENTIALS: '이메일 또는 비밀번호를 확인해 주세요.',
  RATE_LIMITED: '요청이 많아요. 잠시 후 다시 시도해 주세요.',
  ACCOUNT_LINK_REQUIRED: '동일 이메일의 계정이 있어요. 기존 로그인 방식으로 로그인해 주세요.',
  OAUTH_CANCELLED: '로그인이 취소되었어요. 다시 시도할 수 있어요.',
};
function delay(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const done = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(done, 220);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export function createGateway(config: AppConfig): Gateway {
  if (config.mode === 'mock')
    return {
      async list(search, signal) {
        await delay(signal);
        const items = searchRooms(mockRooms, search);
        return { items, total: items.length };
      },
      async get(id, signal) {
        await delay(signal);
        const room = mockRooms.find((r) => r.id === id);
        if (!room) throw new ApiError('NOT_FOUND', '이 방은 더 이상 조회할 수 없어요.', 404);
        return room;
      },
      async recommend(input, signal) {
        RecommendationRequestSchema.parse(input);
        await delay(signal);
        const rooms = input.roomIds.map((id) => mockRooms.find((r) => r.id === id));
        if (rooms.some((r) => !r))
          throw new ApiError('NOT_FOUND', '비교할 방을 다시 선택해 주세요.');
        return rulesSummary(
          rooms as Room[],
          input.filters,
          '샘플 환경에서는 규칙 기반 요약을 제공해요.',
        );
      },
      async submitRoom(input, signal) {
        const parsed = RoomSubmissionSchema.parse(input);
        await delay(signal);
        const id = `owner-${Date.now().toString(36)}-${mockRooms.length}`;
        mockRooms.push(submissionToRoom(parsed, id));
        return { roomId: id, status: 'published' };
      },
      async inquire(input, signal) {
        InquiryRequestSchema.parse(input);
        await delay(signal);
        if (!mockRooms.some((r) => r.id === input.roomId))
          throw new ApiError('NOT_FOUND', '문의할 방을 다시 선택해 주세요.');
        return { status: 'sent' };
      },
      async me() {
        return null;
      },
      async login() {
        throw new ApiError(
          'DEMO',
          '계정 연결을 준비 중이에요. 비회원으로 모든 방을 비교할 수 있어요.',
        );
      },
      async register() {
        throw new ApiError(
          'DEMO',
          '샘플 화면에서는 계정을 생성하지 않아요. 입력한 비밀번호는 저장되지 않아요.',
        );
      },
      async logout() {},
      async oauth() {
        throw new ApiError(
          'DEMO',
          '소셜 로그인 연결을 준비 중이에요. 비회원으로 모든 방을 비교할 수 있어요.',
        );
      },
    };
  const base = config.apiBaseUrl.replace(/\/$/, '');
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: { method?: string; body?: unknown; signal?: AbortSignal; timeout?: number } = {},
  ): Promise<T> {
    const controller = new AbortController(),
      abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timer = setTimeout(abort, options.timeout ?? 12000);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
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
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
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
      return request(`/rooms/${encodeURIComponent(input.roomId)}/inquiries`, InquiryResponseSchema, {
        method: 'POST',
        body,
        signal,
      });
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
    register: (email, password) =>
      request('/auth/register', UserSchema, {
        method: 'POST',
        body: { email, password, termsVersion: '2026-09-22', agreed: true },
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
