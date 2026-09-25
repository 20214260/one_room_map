import { DraftRequestSchema, type DraftRequest, type DraftResponse } from '../contracts/landlord';
import { extractListingHints, money } from './rooms';
import { optionIds, optionLabels } from '../contracts/schemas';

// Deterministic fallback: no guesses about safety, light, noise, area or walking time.
export function createRulesDraft(raw: DraftRequest): DraftResponse {
  const input = DraftRequestSchema.parse(raw);
  const extracted = extractListingHints(input.pastedListingText ?? '');
  const hints: DraftResponse['hints'] = {};
  for (const key of ['deposit', 'rent', 'maintenance'] as const) {
    if (input[key] == null && extracted[key] !== null) hints[key] = extracted[key];
  }
  const facts = {
    ...hints,
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v != null)),
  };
  const lines = [input.title?.trim() || '새로운 원룸을 소개합니다.'];
  if (input.locationHint) lines.push(`${input.locationHint.detail}에 위치한 방입니다.`);
  const costs = (['deposit', 'rent', 'maintenance'] as const).flatMap((key) => {
    const v = facts[key];
    return typeof v === 'number'
      ? [`${{ deposit: '보증금', rent: '월세', maintenance: '관리비' }[key]} ${money(v)}원`]
      : [];
  });
  if (costs.length) lines.push(`${costs.join(', ')}입니다.`);
  const options = optionIds
    .filter((key) => input.options?.[key] === true)
    .map((key) => optionLabels[key]);
  if (options.length) lines.push(`제공 옵션은 ${options.join(', ')}입니다.`);
  lines.push('입주 일정과 자세한 조건은 문의로 확인해 주세요.');
  return {
    mode: 'rules',
    description: lines.join('\n'),
    hints,
    limitations: [
      '입력한 정보와 게시글의 금액만 정리한 기본 초안이에요. AI 분석 결과가 아니에요.',
      '관리비 포함 항목·채광·방음·도보 거리는 추정하지 않았어요.',
    ],
  };
}
