# 순룸 · Sunroom

순천대학교 학생을 위한 원룸 비교 프론트엔드입니다. 제공된 2026-09-21 기능명세서를 기준으로 구현했습니다. **현재는 샘플 데이터로 동작하는 프론트엔드이며 실제 인증·매물·Gemini 백엔드는 포함하지 않습니다.**

탐색 → 조건 필터 → 상세 → 2개 비교 → 근거 요약을 바로 시연할 수 있습니다. 백엔드 연결부와 화면을 분리해 FE 2명, BE 2명이 나눠 작업하도록 구성했습니다.

## 처음 실행하기

Node.js 22.13 이상과 pnpm을 사용합니다. `pnpm-lock.yaml`을 유지하세요.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

새로 받은 소스는 기본적으로 `http://localhost:5173`에서 실행됩니다. 터미널에 다른 포트가 표시되면 그 주소를 사용하세요. 처음에는 환경변수 없이도 샘플 모드로 실행됩니다. 기존 프로젝트가 있다면 루트 전체를 덮어쓰지 말고 팀과 구조를 맞춘 뒤 옮기세요.

PowerShell에서 환경파일을 준비하려면 `Copy-Item .env.example .env.local`, macOS/Linux에서는 `cp .env.example .env.local`을 사용하세요. API를 연결한 후 서버를 재시작합니다.

```dotenv
NEXT_PUBLIC_DATA_MODE=http
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_KAKAO_MAP_KEY=YOUR_JAVASCRIPT_KEY
```

키와 환경변수 실제 값은 Git에 커밋하지 않습니다. OAuth client secret, Gemini 키, DB 인증값은 **백엔드 전용**입니다. Kakao JS 키는 공개 브라우저 키이므로 origin 제한을 설정합니다.

## 화면

| 경로                         | 제공 내용                                                    |
| ---------------------------- | ------------------------------------------------------------ |
| `/`                          | 검색·예산/생활 필터·정렬·매물 카드·지도·상세 시트·비교바     |
| `/compare?ids=sun-01,sun-02` | 최대 2개 비용/거리/옵션 비교, 자연어 선호 입력, AI/규칙 요약 |
| `/login`                     | 이메일 로그인·회원가입 검증, 카카오/Google 진입 버튼         |
| `/auth/callback`             | 백엔드 인증 완료 후 세션 확인과 이전 화면 복귀               |

필터는 URL에만 반영되며 계정에 영구 저장하지 않습니다. 비교 ID는 비교 URL에서 복원합니다. 비회원에게 탐색과 비교를 열어 두었습니다. 로그인/가입 버튼은 샘플 모드에서 안내를 표시하고 실제 계정을 생성하지 않습니다.

## 폴더와 수정 위치

| 위치                            | 책임                                         |
| ------------------------------- | -------------------------------------------- |
| `app/`                          | 얇은 라우트, 문서 metadata, 공통 스타일      |
| `src/features/explore/`         | 탐색 화면과 서버 조회 상태                   |
| `src/features/filters/`         | 조건 입력과 입력 오류                        |
| `src/features/listings/`        | 매물 카드·상세                               |
| `src/features/compare/`         | 선택바와 비교 화면                           |
| `src/features/recommendations/` | 자연어 입력, 근거·한계·폴백 결과             |
| `src/features/auth/`            | 계정 UI와 콜백                               |
| `src/features/maps/`            | 지도 UI, Kakao SDK 어댑터                    |
| `src/contracts/schemas.ts`      | 공유 DTO·Zod 응답 검증·식별자 카탈로그       |
| `src/domain/rooms.ts`           | 계산·조건 일치·정렬·규칙 요약                |
| `src/services/gateway.ts`       | 공통 Gateway, HTTP/샘플 구현, CSRF·오류·취소 |
| `src/services/mock/data.ts`     | 분리된 샘플 데이터                           |
| `src/shared/`                   | 공통 상태·UI·선택적 WebMCP 연결              |
| `components/ui/`                | 접근성 기반 Radix/shadcn 공통 UI             |
| `tests/`                        | 핵심 계산·입력·계약·API 폴백 테스트          |
| `docs/`                         | API 계약·OpenAPI·작업 분담·출처·검증 기록    |

React 19 + TypeScript, App Router 구조, Vite/Vinext, Tailwind 4, Radix, Zod를 사용합니다. **실행 엔진은 일반 Next CLI가 아닌 Vinext입니다.** 기능 코드의 서버 접근은 Gateway에 모았습니다. 다른 호스팅/런타임으로 옮길 때 `app`, `src`, `components`, `lib`, `public`을 재사용하고 해당 호스트의 빌드 설정을 검증하세요.

## 팀원에게 먼저 공유할 문서

1. [API 계약](docs/API_CONTRACT.md): 금액·거리·null·세션·CSRF·AI 응답 규칙
2. [7일 작업 분담](docs/TEAM_HANDOFF.md): 역할별 파일, PR 규칙, 미결정 요구사항
3. [OpenAPI 3.1](docs/openapi.json): FastAPI DTO 설계용 계약
4. [데이터·사진 출처](docs/DATA_SOURCES.md)
5. [검증 기록과 남은 연동](docs/VALIDATION.md)

## 검증 명령

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

핵심 테스트 13개를 제공합니다. 환경 의존적인 실인증/실지도/Gemini 성공은 별도 통합 검증이 필요합니다. UI 작업 후 390px와 데스크톱에서 확인하고, 오류·빈 결과·값 미상도 확인하세요. 코드는 `pnpm format`으로 동일 형식을 적용할 수 있습니다.

## 배포

이 전달본에는 Sites 기반 비공개 배포 연결용 설정이 포함되어 있습니다. 현재 배포 서비스의 연결 오류로 원격 소스 동기화와 웹 배포는 완료하지 못했습니다. ZIP으로 로컬 실행할 수 있습니다. `pnpm build`는 Cloudflare Worker와 클라이언트 산출물을 만듭니다. 실행/빌드 보조 스크립트와 `.openai/hosting.json`은 현재 배포 연결을 유지하므로 불필요하게 삭제하지 마세요. 로컬 `.sites-runtime` 설정은 Git/소스 ZIP에 넣지 않습니다.

다른 호스팅으로 배포한다면 먼저 런타임 지원을 확인하고, FE 환경변수와 실제 API origin/CORS를 맞추세요. 백엔드 FastAPI·Supervisor·DB·Gemini 배포는 별도의 팀 작업입니다. 이 프론트 소스에 서버 비밀키를 추가하지 않습니다.

## 현재 제한

- 6개 가상 매물. 실제 매물/부동산 연락처/공공데이터를 확보하지 않았습니다.
- 키가 없는 지도는 명확히 표시된 모식도입니다. 실제 Kakao JS SDK 어댑터는 포함합니다.
- AI 연결 전에는 규칙 기반 요약입니다. 자연어 해석·종합 점수·추천 순위는 표시하지 않습니다.
- 로그인/가입 UI와 HTTP 연결부만 있으며 실제 서버 세션·OAuth·같은 이메일 계정 통합은 BE 작업입니다.
- 편의시설 500m, 월세+관리비 산식, 비밀번호 정책·약관은 팀 확정 필요 항목입니다.
- 저장/찜/계약/실시간 위치/길찾기는 제공된 핵심 범위에 없어 추가하지 않았습니다.

샘플 사진과 라이브러리의 라이선스는 출처 문서를 따릅니다. 팀 소스의 공개 라이선스는 팀이 결정해야 하므로 임의 지정하지 않았습니다.
