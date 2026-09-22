const { test } = require('node:test');
const assert = require('node:assert/strict');
const d = require('../.test-build/domain/rooms.js');
const s = require('../.test-build/contracts/schemas.js');
const { mockRooms: rooms } = require('../.test-build/services/mock/data.js');
const { createGateway } = require('../.test-build/services/gateway.js');
const query = {
  query: '',
  sort: 'match',
  filters: s.emptyFilters,
  bounds: null,
  onlyMatches: false,
};
test('월 부담액은 0을 보존하고 누락 관리비를 추정하지 않음', () => {
  assert.equal(d.monthlyCost({ rent: 0, maintenance: 0 }), 0);
  assert.equal(d.monthlyCost({ rent: 320000, maintenance: 50000 }), 370000);
  assert.equal(d.monthlyCost({ rent: 250000, maintenance: null }), null);
});
test('예산 입력: 빈칸은 제한 없음, 음수·소수·지수·문자·범위 초과 거절', () => {
  assert.equal(d.parseBudget(''), null);
  assert.equal(d.parseBudget('0'), 0);
  assert.equal(d.parseBudget('40'), 400000);
  for (const v of ['-1', '1.5', '1e3', 'abc', '1000001']) assert.throws(() => d.parseBudget(v));
});
test('AND 조건과 누락 정보의 불일치', () => {
  assert.equal(d.matches(rooms[0], { ...s.emptyFilters, options: ['washer', 'elevator'] }), false);
  assert.equal(d.matches(rooms[4], { ...s.emptyFilters, maxMaintenance: 100000 }), false);
  assert.equal(
    d.matches(rooms[0], { ...s.emptyFilters, facilities: ['convenience', 'bus'] }),
    true,
  );
});
test('검색·영역·정렬, 가격 미상은 마지막', () => {
  assert.equal(d.searchRooms(rooms, { ...query, query: '후문' }).length, 2);
  assert.equal(
    d.searchRooms(rooms, { ...query, bounds: { south: 0, north: 1, west: 0, east: 1 } }).length,
    0,
  );
  const sorted = d.searchRooms(rooms, { ...query, sort: 'monthly' });
  assert.equal(sorted[0].id, 'sun-02');
  assert.equal(sorted.at(-1).id, 'sun-05');
});
test('세 번째 비교 선택 차단, 해제 허용, 동률·누락은 우열 없음', () => {
  assert.throws(() => d.toggleComparison(['a', 'b'], 'c'));
  assert.deepEqual(d.toggleComparison(['a', 'b'], 'a'), ['b']);
  assert.equal(d.compareWinner(null, 0, 'lower'), null);
  assert.equal(d.compareWinner(5, 5, 'higher'), null);
  assert.equal(d.compareWinner(2, 3, 'none'), null);
});
test('회원가입 이메일·비밀번호·확인·약관 검증', () => {
  const v = {
    email: 'test@example.com',
    password: 'password123',
    confirmation: 'password123',
    agreed: true,
  };
  assert(s.RegisterSchema.safeParse(v).success);
  for (const update of [
    { email: 'bad' },
    { password: 'short' },
    { confirmation: 'other' },
    { agreed: false },
  ])
    assert(!s.RegisterSchema.safeParse({ ...v, ...update }).success);
});
test('추천 계약: 최대 2개·중복·허용 필드 검증', () => {
  assert(
    !s.RecommendationRequestSchema.safeParse({
      roomIds: ['a', 'a'],
      filters: s.emptyFilters,
      prompt: '',
    }).success,
  );
  assert(
    !s.RecommendationRequestSchema.safeParse({
      roomIds: ['a', 'b', 'c'],
      filters: s.emptyFilters,
      prompt: '',
    }).success,
  );
  const summary = d.rulesSummary(rooms.slice(0, 2), s.emptyFilters);
  assert(s.RecommendationSchema.safeParse(summary).success);
  summary.items[0].reasons[0].field = 'invented';
  assert(!s.RecommendationSchema.safeParse(summary).success);
});
test('샘플은 명시하고 AI 호출·실계정 생성을 가장하지 않음', async () => {
  const api = createGateway({ mode: 'mock', apiBaseUrl: '', kakaoMapKey: '' });
  const r = await api.recommend({
    roomIds: ['sun-01', 'sun-02'],
    filters: s.emptyFilters,
    prompt: '조용한 방',
  });
  assert.equal(r.mode, 'rules');
  assert(r.limitations.some((x) => x.includes('샘플')));
  await assert.rejects(() => api.register('test@example.com', 'password123'), /샘플/);
});
test('취소된 조회는 결과를 적용하지 않음', async () => {
  const c = new AbortController();
  c.abort();
  await assert.rejects(() => createGateway({ mode: 'mock' }).list(query, c.signal), {
    name: 'AbortError',
  });
});
test('외부 및 역슬래시 리디렉션 차단', () => {
  assert.equal(d.safeReturnPath('//evil.example'), '/');
  assert.equal(d.safeReturnPath('/\\evil.example'), '/');
  assert.equal(d.safeReturnPath('/compare?ids=a,b'), '/compare?ids=a,b');
});
test('HTTP 정상 응답·잘못된 스키마·401·오류 상세 비노출', async () => {
  const original = global.fetch;
  const api = createGateway({
    mode: 'http',
    apiBaseUrl: 'https://api.example/api/v1',
    kakaoMapKey: '',
  });
  try {
    global.fetch = async () =>
      new Response(JSON.stringify({ items: rooms, total: rooms.length }), { status: 200 });
    assert.equal((await api.list(query)).total, 6);
    global.fetch = async () =>
      new Response(JSON.stringify({ items: [{ id: 'bad' }], total: 1 }), { status: 200 });
    await assert.rejects(() => api.list(query), /정보 형식/);
    global.fetch = async () => new Response('{}', { status: 401 });
    assert.equal(await api.me(), null);
    global.fetch = async () =>
      new Response(
        JSON.stringify({ error: { code: 'UNKNOWN', message: 'SECRET DATABASE PASSWORD' } }),
        { status: 500 },
      );
    await assert.rejects(
      () => api.get('sun-01'),
      (e) => !e.message.includes('SECRET'),
    );
  } finally {
    global.fetch = original;
  }
});
test('AI 외부 ID 응답은 검증 실패 후 실제 매물로 폴백, CSRF와 쿠키 전달', async () => {
  const original = global.fetch;
  const calls = [];
  const api = createGateway({
    mode: 'http',
    apiBaseUrl: 'https://api.example/api/v1',
    kakaoMapKey: '',
  });
  try {
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/auth/csrf')) return new Response(JSON.stringify({ token: 'test-csrf' }));
      if (url.endsWith('/recommendations'))
        return new Response(
          JSON.stringify({
            mode: 'ai',
            summary: 'invalid',
            items: [{ roomId: 'invented-id', reasons: [], tradeoffs: [] }],
            limitations: [],
            fallbackReason: null,
          }),
        );
      return new Response(JSON.stringify(rooms.find((r) => url.endsWith(r.id))));
    };
    const result = await api.recommend({
      roomIds: ['sun-01', 'sun-02'],
      filters: s.emptyFilters,
      prompt: '',
    });
    assert.equal(result.mode, 'rules');
    assert.deepEqual(
      result.items.map((x) => x.roomId),
      ['sun-01', 'sun-02'],
    );
    const post = calls.find((x) => x.url.endsWith('/recommendations'));
    assert.equal(post.options.credentials, 'include');
    assert.equal(post.options.headers['X-CSRF-Token'], 'test-csrf');
  } finally {
    global.fetch = original;
  }
});

test('출처 URL은 HTTP(S)만 허용', () => {
  assert(!s.SourceSchema.safeParse({ ...rooms[0].source, url: 'javascript:alert(1)' }).success);
  assert(
    s.SourceSchema.safeParse({ ...rooms[0].source, url: 'https://example.com/source' }).success,
  );
});
