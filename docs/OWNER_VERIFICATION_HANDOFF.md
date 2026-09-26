# 집주인 인증: 프론트 연동 계약과 배포 조건

현재 프론트는 집주인 가입 후 `/landlord/verify`로 이동하고, 집주인 화면의 `LandlordGuard`가 서버 인증 상태를 확인합니다. `mock`에서는 **기존 시연 집주인 계정만** 승인된 것으로 표시합니다. 새로 가입한 계정의 신청은 `reviewing`으로 남고 서류·이름·주소는 브라우저 저장소에 기록하지 않습니다. 시연 상태는 소유권 인증이 아닙니다.

## 필요 API (prefix `/api/v1`)

인증 쿠키, 기존 `/auth/csrf`와 `X-CSRF-Token`, Origin 검사를 기존 Gateway와 동일하게 적용합니다.

| Method | Path                  | 요청                                                              | 응답                 |
| ------ | --------------------- | ----------------------------------------------------------------- | -------------------- |
| GET    | `/owner/verification` | 집주인 로그인                                                     | `VerificationStatus` |
| POST   | `/owner/verification` | multipart `ownerName`, `buildingAddress`, `consent=true`, `proof` | `VerificationStatus` |

`VerificationStatus = {status: 'not_submitted' | 'reviewing' | 'needs_info' | 'approved' | 'rejected', applicationId: string | null, submittedAt: ISO8601 UTC | null, message: string | null}`. GET은 현재 세션의 신청 상태만 반환합니다. 화면은 열려 있는 동안 12초마다 조회합니다. 실제 심사 완료 시간은 보장하지 않습니다. 오류는 기존 `{error:{code,message}}` 형식입니다. 승인 상태는 클라이언트 요청으로 설정하지 않습니다.

증빙 파일 형식 PDF/JPEG/PNG, 비어 있지 않은 파일이며 크기 최대 5MB를 프론트에서 확인합니다. 서버는 실제 파일 형식·크기·변조·악성 콘텐츠를 별도로 검사해야 합니다. 이름과 주소는 현재 폼에서만 사용하고, 브라우저 `sessionStorage`/`localStorage`에 보관하지 않습니다. 실제 운영의 증빙 원본은 접근 제한과 보관/삭제 기간을 별도로 정하고 공개 Storage 버킷에 넣지 않아야 합니다. AI 서비스에는 필요 정보만 전달하며 주민등록번호 등은 마스킹해야 합니다.

## 서버 권한의 필수 변경

현재 `backend/app/routers/auth.py`의 `require_landlord`는 role만 확인합니다. `POST /auth/register`는 `role=landlord`를 그대로 저장하므로, 기존 API로 직접 요청하면 미인증 사용자도 매물을 올릴 수 있습니다. 화면 Guard는 보안 경계가 아닙니다.

1. 신청자 본인 식별, **독립적으로 확인한 건물의 소유권**, 신청자와 등기상 소유자 일치 여부를 서버에서 검증하고 상태를 DB에 저장합니다. AI는 OCR·불일치 탐지·검토 요약을 돕되 스스로 승인 권한을 갖지 않습니다. 공동명의·법인·위임은 관리자 검토로 분기합니다.
2. 새 집주인 가입은 `not_submitted`에서 시작합니다. 실제 승인은 관리자 또는 검증 가능한 증거를 확인하는 서버 전용 프로세스만 수행합니다. 재신청과 취소/권한 철회, 거절 사유 노출 범위도 정의합니다.
3. `POST /rooms`, `POST /owner/photos`, `PATCH/DELETE /owner/rooms/...`와 공개 상태 변경에 서버측 승인 검사를 추가합니다. `AUTO_PUBLISH=true`여도 미인증 사용자에게 공개 권한을 주지 않습니다.
4. **건물별 인증**을 완성하려면 등록 매물에 서버 발급 `buildingId`를 연결하고 승인된 건물 주소/범위와 요청된 위치를 검증해야 합니다. 현재 `RoomSubmission`에는 `buildingId`가 없으므로 이 작업 전에는 계정 단위 승인만 가능합니다.
5. 프론트의 `http` 모드에서 해당 GET API가 없거나 실패하면 집주인 관리 화면은 닫힙니다. 기존 FastAPI에는 아직 이 두 엔드포인트가 없습니다. 따라서 **실제 HTTP 배포 전에** 백엔드 구현·DB 마이그레이션·권한 테스트가 필요합니다. `.env` 값을 넣는 것만으로 이 단계가 완성되지는 않습니다.

## 배포 판단

- 프론트 `mock`: 시연만 가능. 실제 집주인 인증/승인을 제공한다는 표시 금지.
- 실제 로그인·매물 등록을 공개하는 `http`: 위 API와 서버 권한 검사가 배포되어야 함. 백엔드 구현이 늦으면 집주인 가입·등록을 공개하지 않고 기존 방 찾기만 공개하는 범위로 제한합니다.
- 사용자가 올린 등기 PDF/이미지의 글자가 일치한다는 사실만으로 승인하지 않습니다. 독립적인 원본 조회·본인 확인이 필요합니다.
