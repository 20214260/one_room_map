# 채팅 기능 백엔드 연동 계약

기존 `Gateway`와 HTTP 어댑터는 `src/services/gateway.ts`, 검증 스키마는 `src/contracts/chat.ts`, 브라우저 시연 동작은 `src/services/mock/landlord-gateway.ts`에 있습니다. 프론트 화면은 `src/features/chat/ChatScreen.tsx`에서 오직 `Gateway`를 사용합니다. `NEXT_PUBLIC_DATA_MODE=http`에서 기존 인증 쿠키와 `/auth/csrf` 토큰을 그대로 사용합니다. 서버 API 기본 경로는 `/api/v1`입니다.

## 화면 진입

- 직접 등록한 공개 매물의 상세 화면 → `채팅으로 문의하기` → `/chats?room={roomId}`. 게스트는 로그인 후 해당 방으로 복귀합니다. 샘플 매물에는 채팅 버튼이 없습니다.
- 양쪽 계정의 헤더 `채팅` → `/chats` (미확인 메시지 총수). 집주인 관리 화면에도 `채팅 관리` 진입점이 있습니다.
- 기존 중계 문의 폼과 집주인 받은 문의함은 계속 동작합니다. 문의 API를 채팅으로 대체하지 마세요.
- 로그인된 사용자는 본인이 참여한 대화만 보고, 세부 화면은 `/chats?id={chatId}`입니다.

## HTTP API

모든 요청은 인증 쿠키가 필요합니다. 변경 요청에는 CSRF 토큰이 필요합니다. 내용 유형은 JSON이고 아래 `204` 요청을 제외한 응답은 지정된 JSON 객체입니다. 정확한 타입은 `src/contracts/chat.ts`의 Zod 스키마가 기준입니다.

| 기능           | 요청                                                | 본문                    | 성공 응답                  |
| -------------- | --------------------------------------------------- | ----------------------- | -------------------------- | ------------- | ------------------------ |
| 내 대화        | `GET /chats`                                        | 없음                    | `{ items: ChatSummary[] }` |
| 대화 상세      | `GET /chats/{chatId}`                               | 없음                    | `ChatDetail`               |
| 대화 시작      | `POST /chats`                                       | `{ roomId, message }`   | `ChatDetail`               |
| 답장           | `POST /chats/{chatId}/messages`                     | `{ message }`           | `ChatMessage`              |
| 읽음           | `PATCH /chats/{chatId}/read`                        | 없음                    | `204`                      |
| 방문 시간 제안 | `POST /chats/{chatId}/visits`                       | `{ visitAt: ISO UTC }`  | `ChatMessage`              |
| 방문 시간 답변 | `POST /chats/{chatId}/visits/{proposalId}/response` | `{ decision: "accepted" | "declined" }`              | `ChatMessage` |
| 대화 차단      | `POST /chats/{chatId}/block`                        | 없음                    | `ChatDetail`               |
| 대화 신고      | `POST /chats/{chatId}/reports`                      | `{ reason: "spam"       | "inappropriate"            | "other" }`    | `{ status: "received" }` |

`ChatSummary`에는 `id`, `room` (공개 가능한 매물 정보만: `id`, `title`, `photoUrl`, `location`, `deposit`, `rent`, `maintenance`, `status`), `otherPartyName`, `unreadCount`, `lastMessage`, `updatedAt`, `blocked`가 있습니다. `ChatDetail`에는 `messages`가 추가됩니다. 금액은 원 정수 또는 `null`. `status`는 `published`, `pending_review`, `hidden`, `closed`, `deleted` 중 하나입니다. `ChatMessage`의 필드는 `id`, `senderId`, `kind`, `text`, `createdAt`, `visitAt`, `proposalId`, `decision`입니다. `kind`는 `text`, `visit_proposal`, `visit_response` 중 하나이며 사용하지 않는 추가 필드는 `null`입니다. 모든 시간은 ISO 8601 UTC입니다. 메시지는 오래된 순으로 반환합니다. 목록은 최근 메시지 순으로 반환합니다.

## 서버에서 꼭 지킬 조건

1. 서버 인증의 `user.id`로 참가자 권한을 검사하세요. `GET /chats`, 개별 조회, 전송, 읽음, 방문 제안·답변, 신고·차단 모두 타 계정에는 `404`를 반환합니다. `ownerId`, 연락처, 신고 내용 등 개인 정보는 공개 매물/채팅 응답에 포함하지 않습니다.
2. `POST /chats`는 `seeker`만 사용 가능하고 서버에 등록된 **공개 중인 직접 등록 매물**만 대상으로 합니다. 샘플 매물은 불가합니다. `(roomId, seekerId)`에 유일 제약을 걸어 동시 요청에서도 같은 방의 대화가 하나만 생성되게 하세요. 이미 대화가 있으면 같은 대화에 메시지를 추가해 반환합니다.
3. `message`는 공백 제거 후 1~500자. 차단 시 양쪽 전송을 `403 CHAT_BLOCKED`로 거절하고, 매물이 거래 완료·삭제되면 새 메시지와 방문 제안을 `409 ROOM_CLOSED`로 거절하세요. 비공개 매물은 기존 대화를 계속 볼 수 있고 메시지도 보낼 수 있습니다. 삭제된 매물은 채팅 기록과 매물 요약을 보존해 읽기 전용으로 보여 줍니다.
4. 읽지 않은 건수는 상대가 보낸 메시지 중 자신의 마지막 읽음 위치 이후 개수입니다. 읽음 위치는 사용자별·대화별로 관리하고 `PATCH /read`는 현재 보이는 마지막 메시지까지로 처리합니다. 양쪽 사용자가 같은 시연 데이터를 볼 수 있도록 시연 모드는 한 탭의 `sessionStorage`를 사용합니다. 실제 서비스에서는 DB를 사용하세요.
5. 방문 제안은 미래 시각으로 제한하고, 상대가 제안한 것에만 답변을 허용하세요. 한 제안에는 한 번만 답변할 수 있도록 DB 트랜잭션 또는 제약을 사용하세요. `visit_response.proposalId`는 원 제안 메시지 ID입니다.
6. 신고 기록은 신고자별 중복 접수를 제한하고 관리자 검토용으로 저장하세요. 신고하거나 차단해도 기존 대화 기록을 삭제하지 않습니다. 사용자에게는 타인의 연락처를 전달하지 않습니다. 인증·CSRF·요청 빈도 제한·메시지 HTML 이스케이프와 적절한 보관 정책을 적용하세요.

현재 화면은 탭이 열려 있을 때 12초마다 새 대화를 조회하며, 상세 화면에서도 새 메시지를 갱신합니다. 실시간 이벤트를 구현하면 이 폴링을 SSE/웹소켓으로 교체할 수 있습니다. 서버 인증이 없는 상태에서는 `mock` 모드에서 집주인으로 방을 등록하고 사용자로 전환하여 대화 흐름을 시연할 수 있습니다. 탭을 닫으면 시연 데이터가 사라집니다.
