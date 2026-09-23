import { z } from 'zod';
import { RoomSubmissionSchema, type RoomSubmission, type Room } from '../../contracts/schemas';
export const EditorFormSchema = z.object({
  title: z.string(),
  zone: z.enum(['front-gate', 'back-gate', 'other']),
  detail: z.string(),
  rent: z.string(),
  deposit: z.string(),
  maintenance: z.string(),
  area: z.string(),
  floor: z.string(),
  contactMethod: z.enum(['phone', 'kakao']),
  contactValue: z.string(),
  coordinates: RoomSubmissionSchema.shape.coordinates,
  options: RoomSubmissionSchema.shape.options,
  description: z.string(),
  photos: z.array(z.object({ url: z.string(), alt: z.string() })),
});
export type EditorForm = z.infer<typeof EditorFormSchema>;
export const emptyForm: EditorForm = {
  title: '',
  zone: 'front-gate',
  detail: '',
  rent: '',
  deposit: '',
  maintenance: '',
  area: '',
  floor: '',
  contactMethod: 'phone',
  contactValue: '',
  coordinates: null,
  options: {},
  description: '',
  photos: [],
};
export function fromSubmission(input: RoomSubmission): EditorForm {
  const man = (v: number | null | undefined) => (v == null ? '' : String(v / 10000));
  return {
    title: input.title,
    zone: input.locationHint.zone,
    detail: input.locationHint.detail,
    rent: man(input.rent),
    deposit: man(input.deposit),
    maintenance: man(input.maintenance),
    area: input.area == null ? '' : String(input.area),
    floor: input.floor == null ? '' : String(input.floor),
    contactMethod: input.contact.method,
    contactValue: input.contact.value,
    coordinates: input.coordinates ?? null,
    options: input.options ?? {},
    description: input.description ?? '',
    photos: input.photos ?? [],
  };
}
export function amountFromMan(raw: string): number | null {
  if (!raw.trim()) return null;
  if (!/^\d+(\.\d{1,4})?$/.test(raw.trim())) throw new Error('0 이상의 금액을 입력해 주세요.');
  const value = Math.round(Number(raw) * 10000);
  if (!Number.isSafeInteger(value) || value > 1_000_000_000_000)
    throw new Error('금액 범위를 확인해 주세요.');
  return value;
}
export function validateForm(
  form: EditorForm,
  full = true,
): { input?: RoomSubmission; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const numbers: Record<string, number | null> = {};
  for (const key of ['rent', ...(full ? ['deposit', 'maintenance'] : [])] as const) {
    try {
      numbers[key] = amountFromMan(form[key as 'rent']);
    } catch (e) {
      errors[key] = (e as Error).message;
    }
  }
  if (!form.title.trim()) errors.title = '매물 제목을 입력해 주세요.';
  if (!form.detail.trim()) errors.detail = '주변 위치를 설명해 주세요.';
  if (numbers.rent == null) errors.rent ??= '월세를 입력해 주세요. 무료라면 0을 입력하세요.';
  if (!form.coordinates) errors.coordinates = '지도에서 위치를 선택해 주세요.';
  if (
    form.contactMethod === 'phone'
      ? !/^0\d{8,10}$/.test(form.contactValue.replace(/[-\s]/g, ''))
      : !/^https:\/\/open\.kakao\.com\/[A-Za-z0-9/_-]+$/.test(form.contactValue.trim())
  )
    errors.contactValue =
      form.contactMethod === 'phone'
        ? '전화번호를 확인해 주세요.'
        : 'https://open.kakao.com/으로 시작하는 링크를 입력해 주세요.';
  if (!full) return { errors };
  if (
    form.area &&
    (!/^\d+(\.\d+)?$/.test(form.area) ||
      !Number.isFinite(Number(form.area)) ||
      Number(form.area) <= 0)
  )
    errors.area = '면적은 0보다 큰 숫자로 입력해 주세요.';
  if (form.floor && !/^-?\d+$/.test(form.floor)) errors.floor = '층수는 정수로 입력해 주세요.';
  if (Object.keys(errors).length) return { errors };
  const parsed = RoomSubmissionSchema.safeParse({
    title: form.title,
    locationHint: { zone: form.zone, detail: form.detail },
    rent: numbers.rent,
    deposit: numbers.deposit,
    maintenance: numbers.maintenance,
    area: form.area ? Number(form.area) : null,
    floor: form.floor ? Number(form.floor) : null,
    contact: { method: form.contactMethod, value: form.contactValue.trim() },
    coordinates: form.coordinates,
    options: form.options,
    description: form.description,
    photos: form.photos,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      errors[String(issue.path[0])] = '입력한 값의 형식이나 길이를 확인해 주세요.';
    return { errors };
  }
  return { input: parsed.data, errors };
}
export function previewRoom(form: EditorForm): Room {
  const num = (raw: string) => {
    try {
      return amountFromMan(raw);
    } catch {
      return null;
    }
  };
  return {
    id: 'preview',
    title: form.title || '나의 방을 소개하는 제목',
    neighborhood: form.detail || '위치 정보를 입력해 주세요',
    description: form.description,
    coordinates: form.coordinates ?? null,
    rent: num(form.rent),
    deposit: num(form.deposit),
    maintenance: num(form.maintenance),
    area: null,
    floor: null,
    photos: form.photos,
    options: form.options ?? {},
    nearCommercial: null,
    schoolDistance: null,
    facilities: [],
    distanceSource: null,
    source: {
      name: '집주인 직접 등록',
      url: null,
      collectedAt: '',
      license: '',
      kind: 'owner',
      note: '',
    },
    published: false,
  };
}
