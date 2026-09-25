# 변경 파일 목록

## 후속 채팅 기능 추가 (2026-09-23)

- 추가: `app/chats/page.tsx`, `src/contracts/chat.ts`, `src/features/chat/ChatScreen.tsx`, `src/features/chat/chat.css`, `docs/CHAT_HANDOFF.md`.
- 수정: `src/services/gateway.ts`의 채팅 HTTP 계약, `src/services/mock/landlord-gateway.ts`의 시연 대화 저장·권한, `src/shared/Header.tsx`의 채팅 진입·읽지 않은 수, `src/features/listings/RoomDetail.tsx`의 집주인 매물 채팅 버튼, `src/features/landlord/LandlordDashboard.tsx`의 채팅 관리 링크, `app/globals.css`의 추가 스타일, `README.md` 및 `docs/WORK_CONTEXT.md`의 안내, `tests/core.test.cjs`의 채팅 경계 테스트.
- 기존 방 찾기·비교·추천·원래 문의·집주인 관리 기능과 샘플 데이터는 유지. 아래 내용은 그 전 변경 기록입니다.

기존 ZIP에 대한 추가/수정 목록입니다. 패키지 의존성·잠금 파일, 기존 탐색/비교/필터 컴포넌트, 샘플 매물·이미지, 기존 배포 설정은 유지했습니다. 공통 스타일은 새 CSS import만 추가했습니다.

## 기존 파일 수정

- `README.md`: 역할별 시연·라우트·문서 안내.
- `app/globals.css`: 집주인 전용 스타일 import.
- `docs/API_CONTRACT.md`, `docs/openapi.json`: 역할, 좌표, 등록/관리/사진/초안/문의 계약.
- `scripts/test.mjs`, `tests/core.test.cjs`: 입력 변환 컴파일과 5개 핵심 시나리오 추가, 기존 임시 가입 기대값 갱신.
- `src/contracts/schemas.ts`: role과 좌표, 문자열 입력 정리.
- `src/domain/rooms.ts`: 등록자가 선택한 좌표 보존.
- `src/features/auth/AuthScreen.tsx`: 가입 역할 선택과 체험 버튼.
- `src/features/listings/RoomDetail.tsx`: 직접 등록 사진/문의 영역.
- `src/features/maps/RoomMap.tsx`: 새 등록 매물의 모식도 핀 위치.
- `src/features/maps/kakao.ts`: 위치 선택 어댑터 추가.
- `src/services/gateway.ts`: 기존 API 유지, 집주인 HTTP 어댑터와 mock 분리.
- `src/shared/AppProvider.tsx`, `src/shared/app-context.ts`: 인증 로딩 상태.
- `src/shared/Header.tsx`: 집주인 메뉴와 모바일 계정 버튼.

## 새 파일

- `app/landlord/page.tsx`, `app/landlord/new/page.tsx`, `app/landlord/edit/page.tsx`.
- `src/contracts/landlord.ts`, `src/domain/listing-draft.ts`.
- `src/features/landlord/LandlordGuard.tsx`, `LandlordDashboard.tsx`, `ListingEditor.tsx`, `LocationPicker.tsx`, `editor-form.ts`, `landlord.css`.
- `src/features/listings/InquiryForm.tsx`.
- `src/services/mock/landlord-gateway.ts`, `src/services/errors.ts`, `src/services/photos.ts`.
- `docs/APPLY_UPDATE.md`, `docs/LANDLORD_HANDOFF.md`, `docs/WORK_CONTEXT.md`, 이 문서.
- `vite.local.config.ts`: Windows의 Cloudflare 개발 실행기 연결 오류를 우회하는 프론트엔드 시연용 로컬 실행 설정.

## 검증 범위

타입 검사·18개 테스트·프로덕션 빌드 통과. 새 기능 lint 오류 0, 이미지 최적화 권고 2. `/`, `/login`, `/compare`, `/landlord`, `/landlord/new`, `/landlord/edit`의 개발 서버 GET 200 확인. OpenAPI 내부 참조 검증 통과.

실제 브라우저 클릭/사진 업로드/모바일 시각 검증은 로컬 주소 접근 제한으로 수행하지 못했습니다. 실제 OAuth·Kakao·AI·BE API 연결은 별도 확인이 필요합니다. 기존 전체 lint 오류는 원본 범위에 남아 있습니다.
