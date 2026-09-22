# 프론트엔드 ↔ FastAPI 계약 v1 (팀 합의용)

이 문서는 기존 백엔드가 있다고 가정하지 않고 만든 **연동 제안**입니다. 실제 서버는 포함하지 않습니다. 먼저 FE/BE가 이 계약을 합의하고, 다른 이름을 쓰기로 했다면 `src/services/gateway.ts`에서 변환하세요. 화면 컴포넌트에 서버 DTO를 직접 퍼뜨리지 않습니다.

검증 기준은 `src/contracts/schemas.ts`. 기계 판독 명세는 `docs/openapi.json`입니다. 화면은 `Gateway` 인터페이스에만 의존하고, `mock` / `http` 구현을 교체합니다.

## 공통 규칙

- API prefix: `/api/v1`, camelCase JSON. 날짜는 ISO 형식, 금액은 **원 단위 정수**입니다.
- 입력 화면만 만원 단위를 사용하고 API 요청 전에 ×10,000 합니다. `null`은 미상/제한 없음이며 0과 다릅니다.
- `rent + maintenance`가 임시 합의 제안인 월 부담액입니다. 어느 하나라도 null이면 계산하지 않습니다. 공과금/보증금 이자는 포함하지 않습니다.
- 도보 거리는 경로 API 결과의 **미터**입니다. 좌표는 WGS84 위도/경도입니다. 프론트는 직선거리를 도보 거리로 바꾸거나 시간으로 추정하지 않습니다.
- 공개 승인된 매물만 반환합니다. 원천 정보와 주변 시설의 출처를 따로 보냅니다.
- 숫자·enum·null·응답 구조를 Zod로 검증합니다. 사용자 오류 메시지는 허용 목록에서 생성하므로 DB/외부 API 오류 원문은 노출하지 않습니다.
- 요청 취소와 12초 일반 요청 / 20초 AI 요청 제한을 적용합니다. AI 실패 후 매물 조회를 통한 규칙 요약 시간이 추가로 필요할 수 있습니다.

## 엔드포인트

| Method | 경로                           | 입력                                                | 성공 응답                        |
| ------ | ------------------------------ | --------------------------------------------------- | -------------------------------- |
| GET    | `/rooms`                       | `search`에 Search 객체를 JSON 직렬화하고 URL 인코딩 | `{items: Room[], total: number}` |
| GET    | `/rooms/{id}`                  | 공개 매물 ID                                        | `Room`                           |
| GET    | `/auth/csrf`                   | 없음, 비회원도 가능                                 | `{token: string}`                |
| GET    | `/auth/me`                     | 세션 쿠키                                           | `User`, 비회원은 401             |
| POST   | `/auth/register`               | `{email,password,agreed:true,termsVersion}`         | `User`, 세션 쿠키 설정           |
| POST   | `/auth/login`                  | `{email,password}`                                  | `User`, 세션 쿠키 설정           |
| POST   | `/auth/logout`                 | 없음                                                | 204, 쿠키 만료                   |
| POST   | `/auth/oauth/{provider}/start` | `{returnTo: '/compare?ids=...'}`                    | `{authorizationUrl}`             |
| POST   | `/recommendations`             | `{roomIds,filters,prompt}`                          | `Recommendation`                 |

샘플 규모에서는 현재 검색의 전체 결과를 반환합니다. 페이지네이션은 이번 계약에 없습니다. 매물이 크게 늘어나면 커서와 지도 클러스터 조회 API를 먼저 계약에 추가하세요. 현재 지도 구역 수는 조회 결과의 0.001도 좌표 버킷 수이며 행정 구역 수가 아닙니다.

### Search 예시

```json
{
  "query": "석현동",
  "sort": "monthly",
  "onlyMatches": false,
  "bounds": { "south": 34.966, "north": 34.975, "west": 127.475, "east": 127.488 },
  "filters": {
    "maxRent": 400000,
    "maxMaintenance": 50000,
    "maxDeposit": 5000000,
    "nearCommercial": null,
    "options": ["aircon", "washer"],
    "facilities": ["convenience"]
  }
}
```

`bounds: null`이면 지도 영역 제한 없음. `onlyMatches: false`일 때 불일치 매물도 반환해야 지도와 카드에서 구별할 수 있습니다. 모든 선택 조건은 AND이며, 누락된 속성은 충족으로 처리하지 않습니다. 편의시설 조건은 도보 경로 500m 이내라는 **팀 합의 전 임시 기준**입니다. UI에 이 기준을 표시했습니다.

정렬은 `match`(충족 조건 개수 내림차순, 가중치 없음), `monthly`, `deposit`, `distance`(오름차순), `area`(내림차순)입니다. 조건이 없으면 ID 순서, 미상 값은 마지막, 동률이면 ID 순서입니다. 적합도 퍼센트와 종합 우승 매물은 제공하지 않습니다.

### Room 필드

| 필드                                    | 타입                              | 누락 처리                             |
| --------------------------------------- | --------------------------------- | ------------------------------------- |
| id / title / neighborhood / description | string                            | 필수. ID는 영문·숫자·`_`·`-`, 1~100자 |
| coordinates                             | `{lat,lng}` 또는 null             | null이면 지도 제외, 목록 유지         |
| deposit / rent / maintenance            | 0 이상 원 정수 또는 null          | 정보 없음. 누락으로 0 생성 금지       |
| area / floor                            | 양수 면적(m²) / 층 정수 또는 null | 정보 없음. 층은 우열 없음             |
| options                                 | 옵션 ID → true / false / null     | 미상은 null. 모든 표준 키 전송 권장   |
| nearCommercial                          | boolean 또는 null                 | 미상을 상권 밖으로 단정하지 않음      |
| photos                                  | `{url,alt}[]`                     | 빈 배열은 대체 화면                   |
| schoolDistance                          | 0 이상 미터 또는 null             | 시간/직선거리 자동 보완 금지          |
| facilities                              | `{type,name,distance}[]`          | 누락 시설/거리는 정보 없음            |
| source                                  | Source                            | 실제/샘플 구분 필수                   |
| distanceSource                          | Source 또는 null                  | 주변 환경 데이터 출처                 |
| published                               | boolean                           | 서버에서 공개 승인 검증               |

Source: `{name,url,collectedAt,license,kind,note}`. kind는 `sample | licensed | public`, url은 URL 또는 null. 표준 옵션과 시설 식별자는 `schemas.ts`가 단일 기준입니다. 사진 URL은 자체 공개 경로 또는 HTTPS 이미지 URL을 사용하고, 주소·연락처·소유자 개인정보는 응답에 넣지 않습니다.

### AI 요청과 응답

브라우저는 매물 ID, 구조화 조건, 500자 이하 선호만 보냅니다. **Gemini 키와 프롬프트 조립·원천 필드 조회·응답 근거 검증은 백엔드 책임**입니다. 사용자가 보낸 가격 데이터를 모델 입력의 사실로 사용하지 마세요. 백엔드가 ID로 다시 읽어야 합니다.

```json
{
  "mode": "rules",
  "summary": "확인된 비용과 거리로 두 방을 비교했어요.",
  "items": [
    {
      "roomId": "sun-01",
      "reasons": [{ "field": "monthly", "text": "월세 + 관리비 37만원 / 월" }],
      "tradeoffs": []
    },
    {
      "roomId": "sun-02",
      "reasons": [{ "field": "monthly", "text": "월세 + 관리비 31만원 / 월" }],
      "tradeoffs": []
    }
  ],
  "limitations": ["별도 공과금은 포함하지 않아요."],
  "fallbackReason": "AI 요청 제한으로 규칙 기반 요약을 제공해요."
}
```

- 요청 대상은 1~2개 고유 ID. UI는 2개 비교에서 요청합니다. 대상 삭제/비공개면 비교 진입을 막습니다.
- 응답의 외부 ID, 중복 ID, 미지원 근거 필드, 잘못된 JSON은 클라이언트에서도 거절합니다.
- 클라이언트 구조 검증만으로 자연어의 사실성을 입증할 수 없습니다. 백엔드는 `text`의 수치/옵션/거리와 DB 근거를 비교한 후만 `mode: ai`를 반환해야 합니다.
- 타임아웃·할당량·키 오류·검증 실패는 서버에서 `mode: rules`로 반환하는 것이 우선입니다. 서버 자체 실패 시 프론트도 최신 매물을 조회해 규칙 요약으로 전환합니다. 매물 조회까지 실패하면 재시도 화면입니다.
- 클라이언트 규칙 요약은 비용·학교 거리·조건 충족 여부만 사용합니다. 자연어 해석이나 종합 순위는 하지 않고 이 제한을 표시합니다.
- 가중치·종합 순위·추천 우승 기준은 미정. 프론트의 비교 강조는 항목별 비용/거리 낮음·면적 넓음만 사용합니다.

## 인증 연결

서버가 세션을 **HttpOnly + Secure 쿠키**로 소유합니다. 브라우저 토큰 저장소(localStorage 등)는 사용하지 않습니다. 최근 활동 기준 7일 갱신은 백엔드에서 구현합니다.

모든 POST 전 `/auth/csrf`를 호출하고 `X-CSRF-Token`을 전송합니다. 비회원 AI 요청에도 같은 규칙을 씁니다. 서버는 Origin/CSRF를 검증합니다. CORS는 지정된 FE origin만 허용하고 credentials=true 및 `Content-Type`, `X-CSRF-Token`을 허용합니다. 운영은 같은 사이트의 `/api/v1` 프록시 구성을 권장합니다. 서로 다른 사이트면 SameSite 정책과 브라우저의 서드파티 쿠키 제한을 함께 검증해야 합니다.

OAuth 흐름: 버튼 → BE `/start` → 카카오/Google → **BE 콜백에서 state, PKCE/nonce(해당 방식), code 검증 및 세션 발급** → FE `/auth/callback?returnTo=...` → `/auth/me` 확인 → 기존 화면 복귀. 제공자 토큰/비밀키를 FE URL이나 JSON에 넣지 않습니다. start의 authorizationUrl은 HTTPS의 `kauth.kakao.com` / `accounts.google.com`만 프론트에서 허용합니다.

같은 이메일의 다른 제공자 계정은 자동 병합하지 않습니다. 현재 `ACCOUNT_LINK_REQUIRED` 오류는 기존 방식으로 로그인하도록 안내합니다. 명세의 '병합 여부 확인' 상세 플로우/API는 팀이 정해야 하는 미구현 항목입니다.

현재 약관은 시연용 안내 초안입니다. 운영 주체·보유 기간·문의처·정식 약관 버전을 확정하기 전 실제 회원가입 공개는 완료된 것으로 취급하지 마세요.

### 오류 형식

```json
{ "error": { "code": "EMAIL_EXISTS", "message": "서버 내부 참고 메시지", "requestId": "optional" } }
```

사용 코드: `EMAIL_EXISTS`, `INVALID_CREDENTIALS`, `RATE_LIMITED`, `ACCOUNT_LINK_REQUIRED`, `OAUTH_CANCELLED`. HTTP 400/422 입력 오류, 401 비회원, 403 권한, 404 비공개/없음, 409 중복, 429 제한, 5xx 외부/API 실패를 구분하세요. 프론트는 서버 message를 그대로 렌더링하지 않습니다.

## 지도 연결

`NEXT_PUBLIC_KAKAO_MAP_KEY`는 브라우저용 JavaScript 키입니다. 비밀키가 아니며 Kakao 개발자 콘솔에 허용 origin을 등록해야 합니다. REST API 키·OAuth client secret·Gemini 키는 프론트 환경변수에 넣지 않습니다.

SDK 로딩 / CustomOverlay / idle 이벤트 / 재시도 / cleanup은 `src/features/maps/kakao.ts` 한 곳에 있습니다. 지도 종료 후 영역으로 매물을 요청하고 이전 요청은 취소합니다. 키가 없으면 '실제 지도 아님'을 명시한 모식도이며 정문/후문 선택으로 영역 필터를 시연합니다. 실계정 키가 없는 상태에서는 실제 Kakao 호출을 검증하지 못했습니다.

카카오 JS 지도가 도보 경로 거리를 자동 제공하는 것은 아닙니다. 사용할 도보 경로 데이터 제공자와 라이선스는 BE가 별도로 확보해야 합니다. 공식 SDK 문서: https://apis.map.kakao.com/web/documentation/
