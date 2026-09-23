# 집주인 기능 인수인계 · 2026-09-23

기준: 제공 ZIP의 `1e1abad376c0eb3c39d97887004bdac120cbfd0f`. Git 원격에는 접근하지 않았으며 다른 브랜치의 AI 구현을 임의로 병합하지 않았습니다. 이 문서는 기존 API_CONTRACT.md를 확장합니다. 실제 서버 구현은 포함하지 않습니다.

## 제공한 흐름

- 이메일 가입 시 `seeker`(방 찾는 사람) / `landlord`(집주인) 선택. 기존 로그인·OAuth 진입 유지.
- mock 전용 역할별 체험 버튼. 회원가입은 별도 임시 사용자 생성이며 같은 계정 재로그인은 제공하지 않음. 반복 시연은 고정 체험 계정을 사용.
- 집주인 전용 `/landlord`, `/landlord/new`, `/landlord/edit?id=...`. 세션 확인 후 권한 없는 방문에는 안내 화면.
- 지도 핀과 필수 정보 → 사진·비용·옵션·설명 초안 → 최종 확인·수정·저장.
- 내 매물 수정·삭제·공개/비공개·거래 완료, 받은 문의와 읽음 상태.
- 공개한 직접 등록 매물은 기존 검색/지도/비교에 포함. 비공개·거래 완료 매물은 상세와 추천에서도 제외.
- 기존 공개 Room에 연락처를 추가하지 않음. 상세 문의 → 집주인 받은 문의. 실제 문자·카카오 전송과 답장은 아직 없음.

## 코드 경계

| 담당         | 파일                                      | 설명                                                |
| ------------ | ----------------------------------------- | --------------------------------------------------- |
| FE 화면      | `src/features/landlord/`                  | Guard, Dashboard, Editor, LocationPicker, 전용 CSS  |
| FE 입력 변환 | `src/features/landlord/editor-form.ts`    | 만원→원, 필수 입력, 미상 값, 임시 폼                |
| 공통 계약    | `src/contracts/schemas.ts`, `landlord.ts` | 공유 타입·Zod 검증                                  |
| BE 연결      | `src/services/gateway.ts`                 | 화면에서 fetch하지 않음. 경로/응답 변환은 이곳      |
| 데모         | `src/services/mock/landlord-gateway.ts`   | 역할/소유권 검사와 탭 단위 임시 데이터              |
| AI 폴백      | `src/domain/listing-draft.ts`             | 사실 기반 규칙 초안, `mode: rules`                  |
| 사진         | `src/services/photos.ts`                  | JPG/PNG/WebP, 원본 최대 5MB, 긴 변 1200px JPEG 변환 |
| 지도 SDK     | `src/features/maps/kakao.ts`              | 기존 지도 유지, 클릭 위치 선택 어댑터 추가          |

## 연결할 엔드포인트

prefix `/api/v1`. 세션 쿠키 `credentials: include`. 모든 POST/PATCH/DELETE는 기존 `/auth/csrf` 후 `X-CSRF-Token`. 에러는 기존 `{error:{code,message}}`; 401/403/404/409/422/429 구분. 반환 구조는 OpenAPI와 Zod 참고.

| Method / path                      | 권한        | 요청                            | 응답                                             |
| ---------------------------------- | ----------- | ------------------------------- | ------------------------------------------------ |
| POST `/auth/register`              | 비회원      | 기존 필드 + `role`              | `User`에 `role` 포함                             |
| POST `/rooms`                      | 집주인      | `RoomSubmission`                | `{roomId,status: pending_review 또는 published}` |
| GET `/owner/rooms`                 | 집주인      | 없음                            | `{items: OwnerListing[]}` 본인 것만              |
| PATCH `/owner/rooms/{id}`          | 소유 집주인 | 전체 `RoomSubmission` 교체      | `OwnerListing`                                   |
| PATCH `/owner/rooms/{id}/status`   | 소유 집주인 | `{status}`                      | `OwnerListing`                                   |
| DELETE `/owner/rooms/{id}`         | 소유 집주인 | 없음                            | 204                                              |
| POST `/owner/photos`               | 집주인      | multipart `file`                | `{photo:{url,alt}}`                              |
| POST `/rooms/draft`                | 집주인      | `DraftRequest`                  | `DraftResponse`                                  |
| POST `/rooms/{id}/inquiries`       | 로그인      | `{roomId,message,replyContact}` | `{status: sent 또는 failed}`                     |
| GET `/owner/inquiries`             | 집주인      | 없음                            | `{items: InboxItem[]}` 본인 것만                 |
| PATCH `/owner/inquiries/{id}/read` | 소유 집주인 | 없음                            | 204                                              |

커밋 메시지의 `/rooms/inquiries`와 달리 제공 소스의 실제 경로는 `/rooms/{id}/inquiries`였습니다. 기존 실행 코드의 경로를 유지했습니다. 서버 경로가 다르면 Gateway에서만 매핑하세요. FastAPI 라우팅에서 `/rooms/draft`는 `/rooms/{id}`보다 먼저 등록하세요.

`OwnerListing = {id, ownerId, submission, status, updatedAt}`. submission은 RoomSubmission에서 pastedListingText 제외; 연락처가 포함된 **본인 전용 응답**입니다. 날짜는 ISO8601. 공개 `/rooms`, `/rooms/{id}`는 기존 Room만 반환하며 ownerId/contact/pastedListingText를 노출하지 않습니다.

`InboxItem = {id, roomId, roomTitle, message, createdAt, read}`. 답변 연락처를 응답에 포함하지 않습니다. 실제 답장 중계를 제공하려면 별도 reply API/전송 상태 계약이 필요합니다. 이번 범위는 문의 접수·목록·읽음입니다.

## 권한과 상태

서버는 세션의 user ID와 DB role/ownerId로 소유권을 검증해야 합니다. 화면 Guard와 mock 검사는 실제 보안 경계가 아닙니다. 요청 본문의 ownerId를 채택하지 말고 서버가 할당하세요. role 생략 응답은 FE에서 seeker로 기본 처리합니다.

- `pending_review`: 운영 등록 기본. 소유주가 스스로 공개 승인할 수 없음.
- `published`: 공개 조회/검색/지도/비교 가능.
- `hidden`: 집주인이 숨김. 공개 조회에서 제외.
- `closed`: 거래 완료. 공개 조회에서 제외.
- UI는 검수 대기에서 공개 전환 버튼을 숨김. 숨김/거래 완료에서 재공개 가능; 재검수 필요 정책이면 서버가 pending_review 응답으로 전환.
- 수정 후 검수 정책, 집주인 신원·소유권 인증, 스팸 제한은 BE/운영 정책 합의 필요. 부동산은 별도 세 번째 역할을 만들지 않았음.

OAuth 제공자 계정은 서버가 role을 반환해야 합니다. 기존 OAuth 요청은 유지했으며 가입 역할 온보딩/역할 변경 API는 미정입니다. 우선 이메일 가입과 mock 체험으로 두 역할을 검증할 수 있습니다.

## AI 팀원 연결

`api.generateDraft()`를 구현된 서버에 연결하면 화면을 다시 만들 필요가 없습니다. 요청은 title/locationHint/rent/deposit/maintenance/options/pastedListingText 중 입력한 필드입니다. 연락처·사진은 현재 AI 요청에 보내지 않습니다. 팀원의 함수/브랜치 코드는 제공 ZIP에서 확인되지 않아 실제 AI 연결 완료로 표시하지 않습니다.

```json
{
  "mode": "ai",
  "description": "확인된 정보만으로 작성한 설명",
  "hints": { "deposit": 3000000, "maintenance": 50000 },
  "limitations": ["채광·방음·도보 거리는 확인되지 않았어요."]
}
```

description 최대 1000자, pastedListingText 최대 2000자. hints는 금액(원 정수)만 지원. 기존 입력 금액은 우선하며 빈 필드만 제안을 적용합니다. 원문은 매물/브라우저 임시 폼에 저장하지 않습니다. 생성 결과를 먼저 Dialog에서 검토한 뒤 적용하며, 저장 전 직접 수정 가능합니다. HTTP 실패는 오류+재시도로 처리하고 기존 입력을 유지합니다. 서버 AI 실패 시 `mode: rules` 폴백을 반환할 수 있습니다. 미입력 면적·층·채광·방음·안전·시설·거리 등을 만들어 넣지 마세요. AI 키는 서버에만 둡니다.

## 사진과 지도

사진은 최대 10장, 대표 사진 선택/삭제, 업로드 실패 안내. FE가 재인코딩하더라도 BE는 크기·실제 이미지 디코딩·소유권·메타데이터를 다시 검사하고 임시 파일 정리 정책을 두세요. HTTP 응답 url은 자체 `/uploads/...` 공개 경로나 HTTPS URL을 사용합니다. base64는 mock 전용이며 운영 DB로 보내지 않습니다.

새 UI는 좌표를 필수 선택합니다. DTO coordinates는 이전 요청과 호환되도록 선택 필드입니다. 명시한 null과 0원, 옵션 false/미상은 구별합니다. Kakao JS 키가 있으면 실제 지도 클릭, mock이고 키가 없으면 모식도·정문/후문 위치로 시연합니다. http 모드에서 지도 키가 없으면 실제 위치 입력을 차단하고 안내합니다. 학교 거리/편의시설은 별도 경로 데이터 전까지 미상으로 둡니다.

## 시연 저장과 운영 분리

mock의 세션·매물·문의는 `sessionStorage`의 `sunroom.demo.v1`, 편집 초안은 `sunroom.editor.v1.<user>.<room>`에 보관합니다. 같은 탭 새로고침/역할 전환에서 유지됩니다. 탭 종료 후 복구는 보장하지 않으며 다른 탭·다른 기기·서버와 공유하지 않습니다. 개발자 도구로 조작 가능한 시연 저장소이므로 실제 계정 보안으로 사용하지 마세요.

비밀번호와 문의 replyContact는 저장하지 않습니다. 소유주 연락처는 임시 매물 입력값으로 저장되므로 실제 개인정보 대신 예시만 입력하세요. 사진 용량 초과 시 저장 오류를 표시하며 기존 저장 상태를 보존합니다. `http` 모드는 mock 데이터/임시 로그인/브라우저 폼 저장을 사용하지 않습니다.

## 검증

typecheck, 18개 핵심 테스트, production build 통과. 테스트는 역할/소유권 거절, 공개 상태 반영, 문의 격리, 연락처 비공개, 금액 0/미상, 초안 사실성, HTTP role/CSRF/데모 차단을 포함합니다. 새 기능 대상 lint는 오류 0(이미지 최적화 권고 2)입니다.

기존 프로젝트 전체 lint는 기존 컴포넌트의 React hooks 규칙 및 CJS 테스트 require 규칙 문제로 통과하지 않습니다. 이번 범위 밖 파일의 동작을 일괄 수정하지 않았습니다. 브라우저의 로컬 주소 접근 제한으로 신규 UI의 실제 클릭·모바일 시각 검증, 실제 Kakao/업로드/AI/OAuth 통합 검증은 미완료입니다. 아래 적용 문서의 시나리오를 로컬에서 확인하세요.
