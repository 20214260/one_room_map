# 순룸 백엔드 (FastAPI + Supabase Postgres)

프론트 계약(`docs/API_CONTRACT.md`, `src/contracts/schemas.ts`) 기준으로 동작함.

## 실행

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate          # mac/linux: source .venv/bin/activate
pip install -r requirements.txt
Copy-Item .env.example .env     # 열어서 DATABASE_URL 실제 값 넣기
uvicorn app.main:app --reload --port 8000
```

확인: http://localhost:8000/api/v1/health → `{"ok": true}`
API 문서: http://localhost:8000/docs

Windows에서 프론트는 README대로 `pnpm exec vite --config vite.local.config.ts`로 켜면 주소가 `http://127.0.0.1:5173`이 됨.
백엔드 CORS 기본값에 `localhost:5173`, `127.0.0.1:5173` 둘 다 들어 있음.
카카오 JavaScript SDK 도메인에도 둘 다 등록해 둘 것.

프론트를 실서버에 붙이려면 루트 `.env.local` (Windows는 `Set-Content -Encoding ascii`로 만들 것. utf8은 BOM 때문에 안 읽힘):

```dotenv
NEXT_PUBLIC_DATA_MODE=http
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api/v1
```

## DB

Supabase SQL Editor에서 `sql/` 파일을 번호 순서대로 실행. 전부 여러 번 돌려도 안전함.

| 파일 | 내용 |
| --- | --- |
| `001_schema.sql` | rooms 테이블 (최초) |
| `002_seed.sql` | 샘플 매물 6개 |
| `003_auth_owner.sql` | users·sessions·oauth_accounts, rooms에 status·owner_id·contact(비공개)·위치 힌트, inquiries. Supabase Auth 연동(profiles, 트리거) 제거 |
| `004_chats.sql` | chats·chat_messages·chat_reports. 매물 삭제돼도 대화 기록 보존 |

새 파일을 받으면 `pip install -r requirements.txt`도 다시 실행 (패키지가 추가될 수 있음)

- 로그인은 계약대로 FastAPI가 세션 쿠키로 직접 관리함 (Supabase Auth 사용 안 함)
- 매물 공개 여부는 `rooms.status` 하나로 관리: `pending_review | published | hidden | closed`. 공개 API는 `published`만 반환
- `rooms.contact`, `owner_id`는 공개 응답(`to_room`)에 절대 넣지 않음. 테스트로 확인함
- DB를 바꿀 땐 대시보드에서 직접 고치지 말고 `sql/004_...sql`처럼 파일로 추가

## 테스트

```powershell
python -m pytest -q
```

- `test_search.py`: 검색·필터·정렬이 프론트 `searchRooms`와 같은 결과인지 (DB 없이 실행 가능)
- `test_api.py`: 실제 DB에 붙어서 응답이 프론트 mock 매물과 필드 하나까지 같은지
- `test_auth.py`: 가입·로그인·로그아웃, CSRF/Origin 거절, 쿠키 HttpOnly, 비밀번호 규칙, 요청 빈도 제한
- `test_owner.py`: 매물 등록·수정·상태·삭제, 남의 매물 접근 차단, 연락처 비공개, 문의 흐름
- `test_photos.py`: 실제 이미지만 허용, 크기·형식 제한, EXIF 제거, Supabase 호출 형식 (저장소는 가짜로 대체)
- `test_oauth.py`: 카카오·구글 로그인 (state·PKCE·리디렉트 검증, 계정 연결 정책). 메모리 SQLite와 가짜 제공자를 써서 **DB·키 없이 실행됨**
- `test_chats.py`: CHAT_HANDOFF 조건 1~6 (참가자만, 시작 규칙, 차단·거래 완료, 읽지 않은 수, 방문 제안 1회 답변, 신고 1회)
- 테스트가 만든 사용자·매물·대화는 끝나면 지움. 실제 등록 매물이 DB에 있어도 통과함

프론트 `src/domain/rooms.ts`의 검색 로직이 바뀌면 `app/search.py`도 같이 고치고, `tests/fixture_frontend.json`을 다시 뽑아야 함.

## 구현된 API

| Method | 경로 | 응답 |
| --- | --- | --- |
| GET | `/api/v1/rooms?search=<Search JSON>` | `{items: Room[], total}` |
| GET | `/api/v1/rooms/{id}` | `Room`, 없거나 공개 상태가 아니면 404 |
| GET | `/api/v1/auth/csrf` | `{token}` + CSRF 쿠키 |
| GET | `/api/v1/auth/me` | `User`, 비회원 401 |
| POST | `/api/v1/auth/register` | `User` + 세션 쿠키. 중복 이메일 409 `EMAIL_EXISTS` |
| POST | `/api/v1/auth/login` | `User` + 세션 쿠키. 실패 401 `INVALID_CREDENTIALS` |
| POST | `/api/v1/auth/logout` | 204, 세션 삭제 |
| POST | `/api/v1/auth/oauth/{kakao\|google}/start` | `{authorizationUrl}` + 흐름 쿠키. 키 미설정 503 `OAUTH_NOT_CONFIGURED` |
| GET | `/api/v1/auth/oauth/{kakao\|google}/callback` | 302 → 프론트 `/auth/callback` (세션 쿠키 발급). 실패는 `?error=` |
| POST | `/api/v1/rooms` | 집주인 전용. `RoomSubmission` → `{roomId, status}` |
| POST | `/api/v1/rooms/{id}/inquiries` | 로그인. 직접 등록한 공개 매물에만. 본인 매물 400 `OWN_ROOM` |
| GET | `/api/v1/owner/rooms` | 내 매물 (`OwnerListing[]`, 연락처 포함 본인 전용) |
| PATCH | `/api/v1/owner/rooms/{id}` | 전체 `RoomSubmission` 교체 |
| PATCH | `/api/v1/owner/rooms/{id}/status` | `{status}`. 규칙 위반 409 `INVALID_TRANSITION` |
| DELETE | `/api/v1/owner/rooms/{id}` | 204. 문의도 같이 삭제 |
| POST | `/api/v1/owner/photos` | 집주인. multipart `file` → `{photo:{url,alt}}` (Supabase Storage) |
| GET | `/api/v1/owner/inquiries` | 받은 문의 (학생 연락처 없음) |
| PATCH | `/api/v1/owner/inquiries/{id}/read` | 204 |
| GET/POST | `/api/v1/chats` | 내 대화 목록 / 대화 시작(seeker, 직접 등록 공개 매물만) |
| GET | `/api/v1/chats/{id}` | 대화 상세 (참가자만, 아니면 404) |
| POST | `/api/v1/chats/{id}/messages` | 답장. 차단 403 `CHAT_BLOCKED`, 거래 완료·삭제 409 `ROOM_CLOSED` |
| PATCH | `/api/v1/chats/{id}/read` | 204. 읽음 위치 갱신 |
| POST | `/api/v1/chats/{id}/visits` | 방문 시간 제안 (미래만, 아니면 400 `INVALID_VISIT`) |
| POST | `/api/v1/chats/{id}/visits/{proposalId}/response` | 상대 제안에 1번만 답변 (두 번째 409) |
| POST | `/api/v1/chats/{id}/block` | 차단. 기록은 유지 |
| POST | `/api/v1/chats/{id}/reports` | 신고. 신고자별 1번 |
| GET | `/api/v1/health` | `{ok: true}` |

### 집주인 매물 규칙

- 남의 매물·문의는 전부 404 (존재 여부도 숨김). 소유권은 세션 user.id로만 판단
- 공개 `Room`에는 연락처·ownerId·붙여넣은 원문이 절대 안 나감 (테스트로 확인)
- `pastedListingText`(게시판 글 붙여넣기)는 저장하지 않음. 학생 `replyContact`도 저장하지 않음
- 사진 URL은 `/uploads/...` 또는 `https://`만 허용. base64는 거절
- **`AUTO_PUBLISH`** (기본 `true`): 해커톤 시연용으로 등록 즉시 공개. `false`면 `pending_review`로 들어가고, 운영자가 SQL로 `update rooms set status='published' where id='...'` 해야 공개됨
- 상태: 집주인은 `pending_review`로 못 바꾸고, 검수 대기 매물을 스스로 공개 못 함. 숨김/거래 완료 → 공개는 가능

### 사진 업로드 설정 (Supabase Storage)

1. Supabase → **Storage** → **New bucket** → 이름 `room-photos`, **Public bucket 켜기**
2. Supabase → Project Settings → **API Keys** → **Secret key**(`sb_secret_...`) 복사.
   없으면 Legacy API keys 탭의 `service_role` 키
3. `backend/.env`에 추가
   ```
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<위 키>
   PHOTO_BUCKET=room-photos
   ```
- 이 키는 DB 전체 권한이라 **절대 프론트 `.env.local`이나 GitHub에 넣지 말 것**
- 서버가 사진을 다시 열어서 진짜 이미지인지 확인하고, 긴 변 1200px JPEG로 다시 저장함 (촬영 위치 같은 EXIF 제거)
- 설정이 없으면 업로드는 503 `PHOTO_STORAGE`로 거절되고 나머지 기능은 정상 동작
- 매물 삭제 시 Storage 사진 정리는 아직 안 함 (나중에)

### 아직 없는 것

- `POST /rooms/draft`, `POST /recommendations`: AI 담당

### 로그인 구조

- 세션: `sunroom_session` HttpOnly 쿠키. DB `sessions`에는 토큰 SHA-256 해시만 저장. 7일, 활동 시 갱신
- CSRF: `GET /auth/csrf`가 준 토큰을 `X-CSRF-Token` 헤더로 보내면 쿠키와 비교 (이중 제출). Origin도 검사
- 비밀번호: 표준 라이브러리 scrypt 해시. 규칙은 프론트와 같음 (영문+숫자 8~72자)
- 로그인/가입 요청 빈도 제한 (서버 메모리 기준, 초과 시 429 `RATE_LIMITED`)
- 다른 라우터에서 로그인 필요하면 `Depends(require_user)`, 집주인 전용이면 `Depends(require_landlord)` (`app/routers/auth.py`)
- 변경 요청 라우트에는 `dependencies=[Depends(verify_csrf)]`
- 로컬 http 개발은 `COOKIE_SECURE=false`(기본). HTTPS 배포에서는 `.env`에 `COOKIE_SECURE=true`
- **프론트 주소와 API 주소의 호스트를 맞출 것.** `127.0.0.1:5173` ↔ `127.0.0.1:8000`처럼. `localhost`와 `127.0.0.1`을 섞으면 브라우저가 다른 사이트로 봐서 로그인 쿠키가 안 붙음

오류는 전부 `{"error": {"code": "...", "message": "..."}}` 형식.

### 소셜 로그인 설정 (카카오·구글)

흐름: 프론트 버튼 → `POST /start` → 카카오/구글 로그인 → **백엔드 `/callback`이 state·코드 검증 후 세션 발급** → 프론트 `/auth/callback` → `/auth/me`. 제공자 토큰과 비밀키는 브라우저에 전달되지 않음.

**1. 카카오** ([developers.kakao.com](https://developers.kakao.com))
1. 애플리케이션 추가 → **플랫폼 키 > REST API 키**를 `KAKAO_CLIENT_ID`에 넣기
2. **카카오 로그인 활성화 ON**, **Redirect URI**에 `http://127.0.0.1:8000/api/v1/auth/oauth/kakao/callback` 등록 (배포 주소도 같은 형식으로 추가)
3. **동의항목**: 닉네임 설정. 이메일은 비즈 앱 전환이 있어야 받을 수 있음. 못 받으면 `kakao_<id>@oauth.sunroom.invalid` 형태의 가상 이메일로 가입됨
4. 보안 > Client Secret을 켰다면 `KAKAO_CLIENT_SECRET`에도 입력

**2. 구글** ([console.cloud.google.com](https://console.cloud.google.com))
1. OAuth 동의 화면 구성 (외부, 테스트 모드면 **테스트 사용자에 본인 이메일 추가**)
2. 사용자 인증 정보 → OAuth 클라이언트 ID → **웹 애플리케이션**
3. **승인된 리디렉션 URI**에 `http://127.0.0.1:8000/api/v1/auth/oauth/google/callback` 등록
4. 클라이언트 ID/보안 비밀을 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`에 입력

Redirect URI는 `OAUTH_REDIRECT_BASE` + `/api/v1/auth/oauth/<provider>/callback`과 **한 글자도 다르면 안 됨** (`localhost`와 `127.0.0.1`도 다른 주소).

**정책**
- 이미 연결된 소셜 계정은 그 사용자로 로그인. 처음 보는 소셜 계정인데 **같은 이메일의 기존 계정이 있으면 자동 병합하지 않고** 프론트에 `?error=account_link_required`로 돌려보냄 (계약)
- 구글은 `email_verified`, 카카오는 `is_email_verified`인 이메일만 신뢰
- 소셜 전용 계정은 `password_hash`가 null이라 이메일·비밀번호로 로그인할 수 없음
- 신규 가입 역할은 `POST /start` 본문의 선택값 `role`(`seeker`|`landlord`, 기본 `seeker`). 이미 가입한 사용자의 역할은 바뀌지 않음
- 프론트 `AuthCallback`은 `error=access_denied`만 "취소"로, 그 외는 공통 실패 문구로 표시함
