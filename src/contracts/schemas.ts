import { z } from 'zod';
// Boundary contract: money = integer KRW; distance = verified walking meters.
export const optionIds = [
  'aircon',
  'washer',
  'fridge',
  'induction',
  'desk',
  'closet',
  'elevator',
] as const;
export const facilityIds = ['convenience', 'market', 'bus'] as const;
export const optionLabels = {
  aircon: '에어컨',
  washer: '세탁기',
  fridge: '냉장고',
  induction: '인덕션',
  desk: '책상',
  closet: '옷장',
  elevator: '엘리베이터',
};
export const facilityLabels = { convenience: '편의점', market: '마트', bus: '버스정류장' };
const amount = z.number().int().nonnegative().nullable();
export const SourceSchema = z.object({
  name: z.string(),
  url: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//.test(value))
    .nullable(),
  collectedAt: z.string(),
  license: z.string(),
  kind: z.enum(['sample', 'licensed', 'public']),
  note: z.string(),
});
export const RoomSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  title: z.string(),
  neighborhood: z.string(),
  description: z.string(),
  coordinates: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .nullable(),
  deposit: amount,
  rent: amount,
  maintenance: amount,
  area: z.number().positive().nullable(),
  floor: z.number().int().nullable(),
  options: z.record(z.enum(optionIds), z.boolean().nullable()),
  nearCommercial: z.boolean().nullable(),
  photos: z.array(z.object({ url: z.string(), alt: z.string() })),
  schoolDistance: z.number().nonnegative().nullable(),
  facilities: z.array(
    z.object({
      type: z.enum(facilityIds),
      name: z.string(),
      distance: z.number().nonnegative().nullable(),
    }),
  ),
  distanceSource: SourceSchema.nullable(),
  source: SourceSchema,
  published: z.boolean(),
});
export type Room = z.infer<typeof RoomSchema>;
export const FiltersSchema = z.object({
  maxRent: amount,
  maxMaintenance: amount,
  maxDeposit: amount,
  nearCommercial: z.boolean().nullable(),
  options: z.array(z.enum(optionIds)),
  facilities: z.array(z.enum(facilityIds)),
});
export type Filters = z.infer<typeof FiltersSchema>;
export const emptyFilters: Filters = {
  maxRent: null,
  maxMaintenance: null,
  maxDeposit: null,
  nearCommercial: null,
  options: [],
  facilities: [],
};
export const BoundsSchema = z
  .object({ south: z.number(), north: z.number(), west: z.number(), east: z.number() })
  .refine((b) => b.south < b.north && b.west < b.east);
export type Bounds = z.infer<typeof BoundsSchema>;
export const sortIds = ['match', 'monthly', 'deposit', 'distance', 'area'] as const;
export type Sort = (typeof sortIds)[number];
export const SearchSchema = z.object({
  query: z.string().max(100),
  sort: z.enum(sortIds),
  filters: FiltersSchema,
  bounds: BoundsSchema.nullable(),
  onlyMatches: z.boolean(),
});
export type Search = z.infer<typeof SearchSchema>;
export const RoomsResponseSchema = z.object({
  items: z.array(RoomSchema),
  total: z.number().int().nonnegative(),
});
export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  provider: z.enum(['email', 'kakao', 'google']),
});
export type User = z.infer<typeof UserSchema>;
export const RegisterSchema = z
  .object({
    email: z.string().email('이메일 주소를 확인해 주세요.'),
    password: z
      .string()
      .min(8, '비밀번호는 8자 이상 입력해 주세요.')
      .max(72)
      .regex(/[A-Za-z]/, '영문과 숫자를 모두 포함해 주세요.')
      .regex(/[0-9]/, '영문과 숫자를 모두 포함해 주세요.'),
    confirmation: z.string(),
    agreed: z.literal(true, { errorMap: () => ({ message: '필수 약관에 동의해 주세요.' }) }),
  })
  .refine((v) => v.password === v.confirmation, {
    message: '비밀번호가 일치하지 않아요.',
    path: ['confirmation'],
  });
export const RecommendationRequestSchema = z.object({
  roomIds: z
    .array(z.string())
    .min(1)
    .max(2)
    .refine((v) => new Set(v).size === v.length),
  filters: FiltersSchema,
  prompt: z.string().max(500),
});
export type RecommendationRequest = z.infer<typeof RecommendationRequestSchema>;
export const evidenceFields = [
  'rent',
  'maintenance',
  'deposit',
  'monthly',
  'area',
  'floor',
  'schoolDistance',
  'options',
  'facilities',
] as const;
const EvidenceSchema = z.object({ field: z.enum(evidenceFields), text: z.string().max(500) });
export const RecommendationSchema = z.object({
  mode: z.enum(['ai', 'rules']),
  summary: z.string().max(1000),
  items: z
    .array(
      z.object({
        roomId: z.string(),
        reasons: z.array(EvidenceSchema),
        tradeoffs: z.array(EvidenceSchema),
      }),
    )
    .min(1)
    .max(2),
  limitations: z.array(z.string()),
  fallbackReason: z.string().nullable(),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type AppConfig = { mode: 'mock' | 'http'; apiBaseUrl: string; kakaoMapKey: string };
