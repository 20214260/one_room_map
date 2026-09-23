# 순룸 Sunroom

# 개발 시작 전에 이 README를 GPT에 입력하고 개발할 것

GPT, Claude, Codex 같은 AI로 작업할 때 이 README 내용이랑 수정할 파일을 같이 입력해줘.

기존 프로젝트 구조를 마음대로 뜯어고치지 말고 아래 규칙 지켜서 개발하면 됨.

* 화면에서 서버에 직접 요청하지 말 것
* API 요청은 `src/services/gateway.ts` 사용
* 데이터 형식은 `src/contracts/schemas.ts`, 집주인·채팅은 `src/contracts/landlord.ts`, `src/contracts/chat.ts` 기준
* 실제 API가 없어도 샘플 모드가 계속 작동해야 함
* 공용 파일 수정할 때는 팀원에게 먼저 말하기
* `.env.local`이나 API 키는 절대 GitHub에 올리지 말기
* 작업 후 `pnpm typecheck`, `pnpm test`, `pnpm build` 확인하기

---

## 프로젝트 설명

순천대학교 학생들이 예산과 원하는 조건에 맞는 원룸을 쉽게 찾고 비교할 수 있도록 만든 서비스.

방 찾기·비교와 집주인 매물 등록·관리, 사용자와 집주인의 채팅까지 프론트엔드 시연이 가능함. 기본 샘플 매물 6개에 더해 같은 브라우저 탭에서 집주인이 등록한 매물을 검색·지도에 표시함.

역할별 체험 로그인·등록 매물·채팅은 현재 브라우저의 임시 데이터로 동작함. 실제 로그인, 매물/채팅 저장, 카카오 지도, AI 추천·매물 설명 생성은 백엔드/외부 서비스와 별도 연동해야 함.

---

## 현재 구현된 기능

* 원룸 목록 확인
* 보증금, 월세, 관리비 확인
* 편의시설과 방 옵션 확인
* 예산과 원하는 조건으로 필터링
* 검색 결과 정렬
* 조건에 맞는 매물만 보기
* 매물 상세 정보 확인
* 최대 2개 매물 선택
* 선택한 매물의 비용, 거리, 옵션 비교
* 원하는 방을 문장으로 입력하는 AI 추천 화면
* AI 연결 전 사용할 수 있는 기본 추천 결과
* 방 찾는 사용자(`seeker`) / 집주인(`landlord`) 역할 선택이 있는 이메일 로그인 및 회원가입 화면
* Kakao, Google 로그인 버튼
* 카카오 지도 연결을 위한 기본 구조
* 지도 API가 없을 때 보여주는 샘플 지도
* 로딩, 빈 결과, 오류 화면 처리
* 모바일 화면 대응
* 기본 테스트와 GitHub 자동 검사
* 집주인 매물 등록·수정·공개 상태 관리, 사진 및 지도 위치 선택, 설명 초안 생성·검토
* 직접 등록한 공개 매물에 대한 사용자·집주인 채팅, 방문 시간 제안·답변

현재는 샘플 매물 6개 사용 중.

### 집주인 매물 등록과 채팅 시연

집주인·방을 찾는 사용자 역할별 체험 로그인, 집주인 전용 매물 등록·관리, 직접 등록한 공개 매물의 채팅을 사용할 수 있음. 기존 방 찾기·비교·문의도 계속 사용 가능함.

* 집주인은 `/landlord`에서 매물을 관리하고 `/landlord/new`에서 지도 위치·사진·가격·옵션을 입력함. 공개된 매물은 샘플 매물과 함께 검색·지도·비교에 표시됨.
* 매물 설명 초안은 현재 입력한 사실만으로 생성하는 규칙 기반 폴백임. 초안을 확인하고 수정한 뒤 저장할 수 있으며, 팀원이 만든 AI 기능은 아직 이 흐름에 연결되지 않았음.
* 사용자는 직접 등록한 매물 상세에서 `채팅으로 문의하기`를 눌러 대화를 시작할 수 있음. 샘플 매물에서는 채팅을 시작할 수 없음.
* 헤더의 `채팅` 또는 집주인 관리 화면의 `채팅 관리`로 `/chats`에 들어갈 수 있음. 대화 내역, 읽지 않은 메시지, 방문 시간 제안·답변, 신고·차단을 시연할 수 있음. 화면은 열려 있는 동안 12초 간격으로 새 메시지를 확인함.
* 기존 문의 양식과 집주인 받은 문의함은 채팅과 별개로 유지됨.

### 역할별 시연 순서

1. `/login`에서 **집주인으로 체험** → `/landlord/new`에서 필수 정보와 지도 위치를 입력하고 매물을 저장·공개함.
2. 로그아웃 후 **사용자로 체험** → 홈에서 새 매물을 찾고 상세 화면의 **채팅으로 문의하기**로 첫 메시지를 보냄.
3. 로그아웃 후 다시 **집주인으로 체험** → 헤더 **채팅** 또는 `/landlord`의 **채팅 관리**에서 답장·방문 시간 제안을 확인함.

역할 전환은 **같은 브라우저 탭**에서 진행할 것. 체험 로그인·매물·문의·채팅은 그 탭의 `sessionStorage`에 저장되어 새로고침해도 유지되지만 탭을 닫거나 다른 기기로 옮기면 이어지지 않음. 실제 개인정보 대신 시연용 정보만 입력할 것.

연동 규약과 서버 구현 시 주의점은 [집주인 연동 문서](docs/LANDLORD_HANDOFF.md), [채팅 연동 문서](docs/CHAT_HANDOFF.md), [API 계약](docs/API_CONTRACT.md)에 있음.

---

## 아직 실제로 연결되지 않은 기능

아래 기능은 실제 서버나 외부 서비스와 아직 연결되지 않음. 일부는 화면 시연만 제공하며 찜 목록은 추후 구현 대상임.

* 실제 회원가입 및 로그인
* Kakao, Google OAuth 로그인
* 실제 원룸 매물 데이터
* 실제 카카오 지도
* 실제 사용자 위치
* Gemini를 이용한 AI 추천
* 집주인 매물 설명의 실제 AI 초안 생성
* 서버에서 여러 사용자·기기 간 매물/문의/채팅 공유 및 채팅 실시간 갱신
* 찜 목록 저장
* 서버 데이터베이스 저장

기본 실행은 `mock` 모드이며 예제 매물과 탭 단위 등록 매물로 작동함.

---

# 환경 구축

## 1. 프로그램 설치

### Node.js

Node.js 22.13.0 이상 설치.

Node.js를 설치하면 npm도 같이 설치되기 때문에 npm은 따로 설치할 필요 없음.

https://nodejs.org/

버전 확인:

```powershell
node -v
npm -v
```

### Git

https://git-scm.com/

버전 확인:

```powershell
git --version
```

### pnpm

우리 프로젝트는 npm 대신 pnpm 사용함.

```powershell
npm install -g pnpm@11.25.0
```

버전 확인:

```powershell
pnpm -v
```

---

## 2. 프로젝트 받기

```powershell
git clone https://github.com/20214260/one_room_map.git
cd one_room_map
```

VS Code로 열기:

```powershell
code .
```

`code .`이 안 되면 VS Code에서 `파일 → 폴더 열기`로 `one_room_map` 폴더 열면 됨.

---

## 3. 패키지 설치

```powershell
pnpm install --frozen-lockfile
```

설치가 끝나면 `node_modules` 폴더가 생김.

`node_modules`는 GitHub에 올리지 않아도 됨.

---

## 4. 프로젝트 실행

```powershell
pnpm dev
```

기본 주소:

```text
http://localhost:5173
```

터미널에 다른 주소가 나오면 터미널에 나온 주소로 접속하면 됨.

종료:

```text
Ctrl + C
```

현재 샘플 모드는 환경변수 없이 바로 실행 가능함.

Windows에서 실행 직후 `[vite] scanning dependencies...` 다음에 `Error: read ECONNRESET`으로 종료되거나 화면이 계속 로딩되면, 같은 폴더에서 아래 명령으로 시연 서버를 실행할 수 있음.

```powershell
pnpm exec vite --config vite.local.config.ts
```

`Local:` 뒤에 표시된 주소로 접속. 이 실행 방식도 환경변수 없이 mock 시연 가능함.

---

## 5. 오류 확인

```powershell
pnpm typecheck
pnpm test
pnpm build
```

세 개 전부 통과하면 정상임.

현재 핵심 테스트 21개 들어가 있음.

---

# 브랜치

| 브랜치    | 용도                  |
| ------ | ------------------- |
| `main` | 집주인·채팅 기능까지 병합된 시연 가능한 통합본 |
| `fe`   | 프론트엔드 작업            |
| `be`   | 백엔드 작업              |
| `ai`   | AI 작업               |

`main`에는 바로 작업하지 말 것.

새 기능은 최신 `main`에서 기능 브랜치를 만들거나 담당 브랜치를 최신 `main`과 동기화한 뒤 작업할 것. 담당 브랜치에서 확인이 끝나면 Pull Request로 `main`에 합치면 됨. 예전에 분기한 `fe`·`be`·`ai` 브랜치에는 새 기능이 자동으로 들어가지 않음.

최신 통합본으로 기존 작업 폴더를 갱신할 때 (`main`에 미커밋 변경이 없다면):

```powershell
git switch main
git pull --ff-only origin main
```

---

## 프론트엔드 시작

```powershell
git fetch origin
git switch fe
git pull --ff-only origin fe
git merge origin/main
```

## 백엔드 시작

```powershell
git fetch origin
git switch be
git pull --ff-only origin be
git merge origin/main
```

## AI 시작

```powershell
git fetch origin
git switch ai
git pull --ff-only origin ai
git merge origin/main
```

담당 브랜치에 작업 중인 변경이 있으면 먼저 커밋하거나 별도 브랜치에 보관하고 병합할 것. 충돌이 나면 함께 수정한 뒤 테스트하고 푸시.

현재 브랜치 확인:

```powershell
git branch
```

이름 앞에 `*`가 붙어 있는 게 현재 브랜치임.

---

# 같은 파트에서 같이 작업할 때

같은 브랜치에서 동시에 파일을 수정하면 충돌 날 수 있음.

기능별 브랜치를 만들어서 작업하는 걸 권장함.

프론트 예시:

```powershell
git fetch origin
git switch -c feat/room-detail origin/main
```

백엔드 예시:

```powershell
git fetch origin
git switch -c feat/login-api origin/main
```

AI 예시:

```powershell
git fetch origin
git switch -c feat/ai-recommendation origin/main
```

| 이름          | 용도       | 예시                   |
| ----------- | -------- | -------------------- |
| `feat/`     | 기능 추가    | `feat/kakao-map`     |
| `fix/`      | 오류 수정    | `fix/login-error`    |
| `design/`   | 디자인 수정   | `design/room-card`   |
| `refactor/` | 코드 구조 정리 | `refactor/gateway`   |
| `docs/`     | 문서 수정    | `docs/readme-update` |

---

# 작업 내용 올리기

변경 파일 확인:

```powershell
git status
```

변경 파일 추가:

```powershell
git add .
```

커밋:

```powershell
git commit -m "feat: 매물 상세 화면 추가"
```

현재 브랜치 올리기:

```powershell
git push -u origin 브랜치이름
```

예시:

```powershell
git push -u origin feat/room-detail
```

올린 다음 GitHub에서 Pull Request 만들면 됨.

* 프론트 개인 작업 → `fe`
* 백엔드 개인 작업 → `be`
* AI 개인 작업 → `ai`
* 각 파트에서 확인이 끝난 작업 → `main`

---

# 커밋 메시지

| 종류         | 용도     | 예시                       |
| ---------- | ------ | ------------------------ |
| `feat`     | 기능 추가  | `feat: 지도 화면 추가`         |
| `fix`      | 오류 수정  | `fix: 필터 오류 수정`          |
| `design`   | 디자인 수정 | `design: 매물 카드 수정`       |
| `refactor` | 코드 정리  | `refactor: API 요청 코드 정리` |
| `docs`     | 문서 수정  | `docs: README 수정`        |
| `chore`    | 설정 변경  | `chore: 패키지 설정 수정`       |

커밋 메시지는 뭘 수정했는지 알아볼 수 있게만 작성하면 됨.

---

# 환경변수

`NEXT_PUBLIC_DATA_MODE`를 지정하지 않으면 `mock` 모드라서 시연에 환경변수가 필요 없음. 실제 서버 연동을 시험할 때만 `http` 모드로 변경.

실제 서버나 카카오 지도를 연결할 때 `.env.local` 파일 사용.

```powershell
Copy-Item .env.example .env.local
```

예시:

```dotenv
NEXT_PUBLIC_DATA_MODE=http
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_KAKAO_MAP_KEY=카카오_자바스크립트_키
```

환경변수를 수정했으면 `pnpm dev` 다시 실행해야 함.

아래 정보는 GitHub에 올리지 말 것.

* `.env.local`
* Kakao API 비밀키
* Google OAuth 비밀키
* Gemini API 키
* 데이터베이스 비밀번호
* 사용자 개인정보
* 개인 액세스 토큰

---

# 폴더 설명

| 폴더                              | 설명                |
| ------------------------------- | ----------------- |
| `app/`                          | 페이지 주소와 전체 레이아웃   |
| `components/`                   | 공용 UI             |
| `src/features/`                 | 기능별 프론트 코드        |
| `src/features/auth/`            | 로그인 및 회원가입        |
| `src/features/landlord/`        | 집주인 매물 등록·관리     |
| `src/features/chat/`            | 사용자·집주인 채팅       |
| `src/features/maps/`            | 지도                |
| `src/features/compare/`         | 매물 비교             |
| `src/features/recommendations/` | AI 추천 화면          |
| `src/contracts/`                | 공통·집주인·채팅 데이터 형식 |
| `src/services/`                 | 실제 API와 샘플 데이터 연결 |
| `src/services/mock/`            | 샘플 매물과 탭 단위 체험 데이터 |
| `tests/`                        | 테스트 코드            |
| `docs/`                         | API와 협업 문서        |
| `public/`                       | 이미지와 공개 파일        |

처음부터 모든 폴더를 볼 필요는 없고 자기 담당 부분부터 보면 됨.

---

# 백엔드 작업 시 확인

서버 연결은 아래 파일을 기준으로 작업.

```text
src/services/gateway.ts
```

프론트와 백엔드가 주고받는 데이터 형식:

```text
src/contracts/schemas.ts
src/contracts/landlord.ts
src/contracts/chat.ts
```

매물 등록·AI 초안·문의 관련 엔드포인트와 접근 제어는 [집주인 연동 문서](docs/LANDLORD_HANDOFF.md), 채팅 엔드포인트와 상태별 동작은 [채팅 연동 문서](docs/CHAT_HANDOFF.md)에 정리됨. 화면은 Gateway만 호출함. 현재 `mock` 저장소는 서버가 아니므로 실제 권한·데이터 보관은 백엔드에서 구현해야 함.

화면 컴포넌트에서 서버 주소를 직접 작성하거나 `fetch`를 여기저기 추가하지 말 것.

API 데이터 형식을 바꿔야 하면 프론트 담당자에게 먼저 말해줘.

데이터 형식이 바뀌면 아래 항목도 같이 수정해야 할 수 있음.

* `src/contracts/schemas.ts`
* 샘플 데이터
* API 문서
* 테스트 코드
* 관련 프론트 화면

---

# AI 작업 시 확인

AI 추천은 사용자가 입력한 조건을 분석하고 실제 매물 중에서 적절한 매물을 고르는 방식으로 연결할 예정. 별도로 집주인 매물 설명 초안 생성은 `api.generateDraft()` 계약에 연결할 수 있음. 현재는 규칙 기반 초안을 보여주고 집주인이 검토·수정한 뒤 저장함.

AI 응답에는 아래 정보가 필요함.

* 추천한 매물 ID
* 추천 이유
* 아쉬운 점이나 주의할 점
* 조건에 맞는 매물이 없을 때 보여줄 내용

AI가 존재하지 않는 매물을 새로 만들어서 추천하면 안 됨.

현재 공개 중인 매물 ID를 기준으로 결과를 보내줘야 함. 초안 생성에서는 입력에 없는 면적·거리·채광 등 사실을 임의로 추가하지 말 것. 상세 입력/출력은 [집주인 연동 문서](docs/LANDLORD_HANDOFF.md) 참고.

AI 서버에 오류가 생겨도 서비스 전체가 멈추지 않게 현재 기본 추천 결과는 유지할 예정.

---

# 앞으로 해야 할 작업

1. 집주인·채팅 계약을 포함해 프론트와 백엔드 데이터 형식 확정
2. 실제 로그인·역할 권한과 매물 등록·공개 상태·사진 업로드 서버 연결
3. 공개 매물 목록·상세·지도 데이터 및 문의/채팅 저장과 조회 연결
4. 카카오 지도 키와 실제 위치 선택 연결
5. Kakao·Google OAuth 연결
6. AI 추천과 집주인 설명 초안 API 연결
7. 찜 목록 구현 및 사용자 데이터 저장
8. 모바일 화면·전체 기능 통합 테스트
9. 배포 및 발표 준비

---

# 작업 규칙

* 작업 시작 전에 담당 브랜치에서 `git pull` 하기
* `main`에 바로 작업하지 않기
* 공용 파일 수정 전에 팀원에게 말하기
* API 형식 마음대로 바꾸지 않기
* 비밀키 GitHub에 올리지 않기
* 작업 끝나면 수정한 내용 공유하기
* 오류가 해결되지 않으면 오류 화면과 실행한 명령어 같이 공유하기
* Pull Request 전에 테스트 명령어 실행하기

```powershell
pnpm typecheck
pnpm test
pnpm build
```
