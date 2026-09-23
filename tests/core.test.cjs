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
const submission = {
  title: '새로 등록한 방',
  locationHint: { zone: 'front-gate', detail: '정문 맞은편' },
  rent: 320000,
  contact: { method: 'phone', value: '010-0000-0000' },
  coordinates: { lat: 34.971, lng: 127.481 },
  pastedListingText: '저장하지 않을 원문',
};

test('역할/소유권과 등록→수정→비공개→거래완료→삭제, 연락처 비노출', async () => {
  const api = createGateway({ mode: 'mock', apiBaseUrl: '', kakaoMapKey: '' });
  await assert.rejects(
    () => api.submitRoom(submission),
    (e) => e.status === 401,
  );
  await api.demoLogin('seeker');
  await assert.rejects(
    () => api.submitRoom(submission),
    (e) => e.status === 403,
  );
  const owner = await api.demoLogin('landlord');
  const { roomId } = await api.submitRoom(submission);
  const own = (await api.myRooms()).items[0];
  assert.equal(own.ownerId, owner.id);
  assert(!('pastedListingText' in own.submission));
  const published = await api.get(roomId);
  assert.deepEqual(published.coordinates, submission.coordinates);
  assert.equal(published.deposit, null);
  assert.equal(published.maintenance, null);
  assert(!JSON.stringify(published).includes(submission.contact.value));
  await api.updateRoom(roomId, { ...submission, maintenance: 0 });
  assert.equal((await api.get(roomId)).maintenance, 0);
  await api.setRoomStatus(roomId, 'hidden');
  await assert.rejects(
    () => api.get(roomId),
    (e) => e.status === 404,
  );
  assert(!(await api.list(query)).items.some((r) => r.id === roomId));
  await api.setRoomStatus(roomId, 'published');
  await api.setRoomStatus(roomId, 'closed');
  await assert.rejects(
    () => api.recommend({ roomIds: [roomId], filters: s.emptyFilters, prompt: '' }),
    (e) => e.status === 404,
  );
  await api.register('second@example.com', 'ignored123', 'landlord');
  assert.equal((await api.myRooms()).items.length, 0);
  await assert.rejects(
    () => api.updateRoom(roomId, submission),
    (e) => e.status === 404,
  );
  await assert.rejects(
    () => api.deleteRoom(roomId),
    (e) => e.status === 404,
  );
  await api.demoLogin('landlord');
  await api.deleteRoom(roomId);
  assert.equal((await api.myRooms()).items.length, 0);
});

test('문의 수신은 소유자만, 회신 연락처 비노출, 읽음 처리', async () => {
  const api = createGateway({ mode: 'mock', apiBaseUrl: '', kakaoMapKey: '' });
  await api.demoLogin('landlord');
  const { roomId } = await api.submitRoom(submission);
  await api.demoLogin('seeker');
  await api.inquire({
    roomId,
    message: '방문 가능한가요?',
    replyContact: { method: 'phone', value: '010-1111-2222' },
  });
  await assert.rejects(
    () => api.inbox(),
    (e) => e.status === 403,
  );
  await api.demoLogin('landlord');
  const [item] = (await api.inbox()).items;
  assert.equal(item.message, '방문 가능한가요?');
  assert.equal(item.read, false);
  assert(!JSON.stringify(item).includes('010-1111-2222'));
  await api.register('other@example.com', 'ignored123', 'landlord');
  await assert.rejects(
    () => api.readInquiry(item.id),
    (e) => e.status === 404,
  );
  await api.demoLogin('landlord');
  await api.readInquiry(item.id);
  assert.equal((await api.inbox()).items[0].read, true);
});

test('채팅: 샘플 차단, 계정별 격리, 같은 방 재방문과 읽음, 매물 삭제 후 읽기', async () => {
  const api = createGateway({ mode: 'mock' });
  await assert.rejects(
    () => api.listChats(),
    (e) => e.status === 401,
  );
  await api.demoLogin('landlord');
  const { roomId } = await api.submitRoom(submission);
  await assert.rejects(
    () => api.startChat(roomId, '집주인입니다'),
    (e) => e.status === 403,
  );
  await api.demoLogin('seeker');
  await assert.rejects(
    () => api.startChat('sun-01', '샘플에도 문의'),
    (e) => e.status === 404,
  );
  const created = await api.startChat(roomId, '이 방 볼 수 있나요?');
  assert.equal(created.messages.length, 1);
  assert(!JSON.stringify(created).includes(submission.contact.value));
  assert.equal((await api.startChat(roomId, '답변 기다릴게요')).id, created.id);
  assert.equal((await api.listChats()).items.length, 1);
  await api.demoLogin('landlord');
  assert.equal((await api.listChats()).items[0].unreadCount, 2);
  await api.markChatRead(created.id);
  assert.equal((await api.listChats()).items[0].unreadCount, 0);
  await api.sendChatMessage(created.id, '네 가능합니다');
  await api.demoLogin('seeker');
  assert.equal((await api.listChats()).items[0].unreadCount, 1);
  await api.register('other-seeker@example.com', 'ignored123', 'seeker');
  await assert.rejects(
    () => api.getChat(created.id),
    (e) => e.status === 404,
  );
  await api.demoLogin('landlord');
  await api.deleteRoom(roomId);
  assert.equal((await api.getChat(created.id)).room.status, 'deleted');
  await assert.rejects(
    () => api.sendChatMessage(created.id, '추가 문의'),
    (e) => e.status === 409,
  );
});

test('채팅: 비공개 대화 유지, 방문 제안은 참여자만 응답, 차단·신고', async () => {
  const api = createGateway({ mode: 'mock' });
  await api.demoLogin('landlord');
  const { roomId } = await api.submitRoom(submission);
  await api.demoLogin('seeker');
  const chat = await api.startChat(roomId, '안녕하세요');
  const proposal = await api.proposeVisit(chat.id, new Date(Date.now() + 86400000).toISOString());
  await assert.rejects(
    () => api.respondVisit(chat.id, proposal.id, 'accepted'),
    (e) => e.status === 404,
  );
  await api.demoLogin('landlord');
  await api.setRoomStatus(roomId, 'hidden');
  assert.equal((await api.getChat(chat.id)).room.status, 'hidden');
  await api.sendChatMessage(chat.id, '비공개여도 이전 대화는 유지돼요');
  await api.respondVisit(chat.id, proposal.id, 'accepted');
  await assert.rejects(
    () => api.respondVisit(chat.id, proposal.id, 'accepted'),
    (e) => e.status === 409,
  );
  await api.reportChat(chat.id, 'spam');
  await api.blockChat(chat.id);
  await api.demoLogin('seeker');
  assert.equal((await api.getChat(chat.id)).blocked, true);
  await assert.rejects(
    () => api.sendChatMessage(chat.id, '메시지'),
    (e) => e.status === 403,
  );
});

test('HTTP 채팅 경계: 세션 쿠키와 CSRF, 응답 스키마 검증', async () => {
  const api = createGateway({ mode: 'http', apiBaseUrl: 'https://api.example/api/v1' });
  const original = global.fetch;
  const calls = [];
  try {
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/auth/csrf')) return new Response(JSON.stringify({ token: 'csrf-test' }));
      if (url.endsWith('/chats')) return new Response(JSON.stringify({ items: [] }));
      return new Response(JSON.stringify({ id: 'wrong' }));
    };
    assert.deepEqual((await api.listChats()).items, []);
    await assert.rejects(
      () => api.startChat('owner-1', '안녕하세요'),
      (e) => e.code === 'INVALID_RESPONSE',
    );
    const post = calls.find((call) => call.options?.method === 'POST');
    assert.equal(post.url, 'https://api.example/api/v1/chats');
    assert.equal(post.options.credentials, 'include');
    assert.equal(post.options.headers['X-CSRF-Token'], 'csrf-test');
    assert.deepEqual(JSON.parse(post.options.body), { roomId: 'owner-1', message: '안녕하세요' });
  } finally {
    global.fetch = original;
  }
});

test('기본 초안은 기존 금액 우선·모르는 사실 추정 금지', () => {
  // CommonJS test runner loads the TypeScript compiler output.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createRulesDraft } = require('../.test-build/domain/listing-draft.js');
  const draft = createRulesDraft({
    rent: 320000,
    deposit: 0,
    pastedListingText: '보증금 500만원 월세 50만원 관리비 5만원 조용하고 안전한 남향방',
    options: { aircon: true, washer: false },
  });
  assert.equal(draft.mode, 'rules');
  assert.equal(draft.hints.maintenance, 50000);
  assert(!('rent' in draft.hints));
  assert(!('deposit' in draft.hints));
  assert(draft.description.includes('32만'));
  assert(draft.description.includes('0만'));
  assert(!/남향|안전|조용|세탁기/.test(draft.description));
});

test('입력 금액 원 환산, 빈칸과 0 구분, 좌표·연락처 검증', () => {
  const {
    amountFromMan,
    fromSubmission,
    validateForm,
  } = require('../.test-build/features/landlord/editor-form.js'); // eslint-disable-line @typescript-eslint/no-require-imports -- Compiled CommonJS test boundary.
  assert.equal(amountFromMan('32.5'), 325000);
  assert.equal(amountFromMan('0'), 0);
  assert.equal(amountFromMan(''), null);
  for (const raw of ['-1', 'Infinity', '1e5', 'abc', '1.00001'])
    assert.throws(() => amountFromMan(raw));
  const form = fromSubmission(submission);
  assert(validateForm(form).input);
  assert(validateForm({ ...form, coordinates: null }).errors.coordinates);
  assert(
    validateForm({ ...form, contactMethod: 'kakao', contactValue: 'javascript:alert(1)' }).errors
      .contactValue,
  );
});

test('HTTP는 mock 로그인 금지, 가입 역할 전달, 역할 없는 응답은 seeker', async () => {
  const original = global.fetch;
  const api = createGateway({
    mode: 'http',
    apiBaseUrl: 'https://api.example/api/v1',
    kakaoMapKey: '',
  });
  await assert.rejects(
    () => api.demoLogin('landlord'),
    (e) => e.status === 403,
  );
  const calls = [];
  try {
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return new Response(
        JSON.stringify(
          url.endsWith('/csrf')
            ? { token: 'csrf' }
            : { id: '1', email: 'a@example.com', name: 'A', provider: 'email' },
        ),
      );
    };
    const user = await api.register('a@example.com', 'password123', 'landlord');
    assert.equal(user.role, 'seeker');
    const post = calls.find((c) => c.url.endsWith('/register'));
    assert.equal(JSON.parse(post.options.body).role, 'landlord');
    assert.equal(post.options.headers['X-CSRF-Token'], 'csrf');
  } finally {
    global.fetch = original;
  }
});
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
test('샘플 추천은 규칙 기반이고 가입은 임시 세션만 생성', async () => {
  const api = createGateway({ mode: 'mock', apiBaseUrl: '', kakaoMapKey: '' });
  const r = await api.recommend({
    roomIds: ['sun-01', 'sun-02'],
    filters: s.emptyFilters,
    prompt: '조용한 방',
  });
  assert.equal(r.mode, 'rules');
  assert(r.limitations.some((x) => x.includes('샘플')));
  const user = await api.register('test@example.com', 'password123');
  assert(user.id.startsWith('demo-'));
  assert.equal(user.role, 'seeker');
  assert(!JSON.stringify(user).includes('password123'));
  assert.equal((await api.me()).id, user.id);
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
