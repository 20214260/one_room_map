# 순룸 Sunroom

# 개발 시작 전에 이 README를 GPT에 입력하고 개발할 것

GPT, Claude, Codex 같은 AI로 작업할 때 이 README 내용이랑 수정할 파일을 같이 입력해줘.

기존 프로젝트 구조를 마음대로 뜯어고치지 말고 아래 규칙 지켜서 개발하면 됨.

* 화면에서 서버에 직접 요청하지 말 것
* API 요청은 `src/services/gateway.ts` 사용
* 데이터 형식은 `src/contracts/schemas.ts` 기준
* 실제 API가 없어도 샘플 모드가 계속 작동해야 함
* 공용 파일 수정할 때는 팀원에게 먼저 말하기
* `.env.local`이나 API 키는 절대 GitHub에 올리지 말기
* 작업 후 `pnpm typecheck`, `pnpm test`, `pnpm build` 확인하기

---

## 프로젝트 설명

순천대학교 학생들이 예산과 원하는 조건에 맞는 원룸을 쉽게 찾고 비교할 수 있도록 만든 서비스.

현재는 기본 프론트엔드 화면과 기능을 구현한 상태고, 샘플 매물 데이터를 이용해서 전체적인 서비스 흐름 확인 가능함.

실제 로그인, 매물 데이터, 카카오 지도, AI 추천 기능은 앞으로 백엔드와 연결해야 함.

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
* 이메일 로그인 및 회원가입 화면
* Kakao, Google 로그인 버튼
* 카카오 지도 연결을 위한 기본 구조
* 지도 API가 없을 때 보여주는 샘플 지도
* 로딩, 빈 결과, 오류 화면 처리
* 모바일 화면 대응
* 기본 테스트와 GitHub 자동 검사

현재는 샘플 매물 6개 사용 중.

### 집주인 매물 등록과 채팅 시연

집주인·방을 찾는 사용자 역할별 임시 로그인, 집주인 전용 매물 등록·관리, 직접 등록한 공개 매물의 채팅을 추가했음. 기존 방 찾기·비교·문의도 계속 사용 가능함.

* `/landlord`에서 집주인으로 매물을 등록하면 샘플 매물과 함께 검색·지도에 표시됨.
* 사용자는 직접 등록한 매물 상세에서 `채팅으로 문의하기`를 눌러 대화를 시작할 수 있음. 샘플 매물에서는 채팅을 시작할 수 없음.
* `/chats`에서 두 역할 모두 대화 내역, 읽지 않은 메시지, 방문 시간 제안·답변, 신고·차단을 사용할 수 있음.
* 현재 시연 데이터는 같은 브라우저 탭에서만 유지됨. 실제 세션·매물·채팅 서버는 별도 연동 필요.

프론트·백엔드 연동 기준은 `docs/LANDLORD_HANDOFF.md`와 `docs/CHAT_HANDOFF.md`를 참고. Windows에서 `pnpm dev` 실행 시 `ECONNRESET`이 반복되면 `pnpm exec vite --config vite.local.config.ts`로 시연 화면을 실행할 수 있음.

---

## 아직 실제로 연결되지 않은 기능

아래 기능들은 화면과 연결 구조만 만들어져 있고 실제 서버 연결은 아직 안 된 상태.

* 실제 회원가입 및 로그인
* Kakao, Google OAuth 로그인
* 실제 원룸 매물 데이터
* 실제 카카오 지도
* 실제 사용자 위치
* Gemini를 이용한 AI 추천
* 찜 목록 저장
* 서버 데이터베이스 저장

현재 실행하면 샘플 데이터로 작동함.

---

# 환경 구축

## 1. 프로그램 설치

### Node.js

Node.js 22 이상 설치.

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
| `main` | 오류 없고 시연 가능한 최종 통합본 |
| `fe`   | 프론트엔드 작업            |
| `be`   | 백엔드 작업              |
| `ai`   | AI 작업               |

`main`에는 바로 작업하지 말 것.

각자 담당 브랜치에서 작업하고 확인이 끝나면 Pull Request로 `main`에 합치면 됨.

---

## 프론트엔드 시작

```powershell
git switch fe
git pull origin fe
```

## 백엔드 시작

```powershell
git switch be
git pull origin be
```

## AI 시작

```powershell
git switch ai
git pull origin ai
```

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
git switch fe
git pull origin fe
git switch -c feat/room-detail
```

백엔드 예시:

```powershell
git switch be
git pull origin be
git switch -c feat/login-api
```

AI 예시:

```powershell
git switch ai
git pull origin ai
git switch -c feat/ai-recommendation
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

현재 샘플 화면만 확인할 때는 설정 안 해도 됨.

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
| `src/features/maps/`            | 지도                |
| `src/features/compare/`         | 매물 비교             |
| `src/features/recommendations/` | AI 추천 화면          |
| `src/contracts/`                | 프론트와 백엔드 데이터 형식   |
| `src/services/`                 | 실제 API와 샘플 데이터 연결 |
| `src/services/mock/`            | 샘플 매물 데이터         |
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
```

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

AI는 사용자가 입력한 조건을 분석하고 실제 매물 중에서 적절한 매물을 추천하는 방식으로 연결할 예정.

AI 응답에는 아래 정보가 필요함.

* 추천한 매물 ID
* 추천 이유
* 아쉬운 점이나 주의할 점
* 조건에 맞는 매물이 없을 때 보여줄 내용

AI가 존재하지 않는 매물을 새로 만들어서 추천하면 안 됨.

현재 프론트에 있는 실제 매물 ID를 기준으로 결과를 보내줘야 함.

AI 서버에 오류가 생겨도 서비스 전체가 멈추지 않게 현재 기본 추천 결과는 유지할 예정.

---

# 앞으로 해야 할 작업

1. 프론트와 백엔드 데이터 형식 확정
2. 실제 원룸 목록과 상세 데이터 연결
3. 카카오 지도 연결
4. 로그인 및 회원가입 연결
5. Kakao, Google OAuth 연결
6. Gemini AI 추천 연결
7. 찜 목록과 사용자 데이터 저장
8. 모바일 화면 최종 확인
9. 전체 기능 테스트
10. 배포 및 발표 준비

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
