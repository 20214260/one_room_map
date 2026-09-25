# Git에 이번 프론트엔드 변경 올리기

이번 전달본은 Git 이력이 없는 ZIP에서 작업했습니다. 아래 순서는 Git 저장소 `one_room_map`에서 실행합니다. `sunroom-source` 압축 해제 폴더 안에서는 실행하지 마세요.

1. VS Code에서 `C:\Users\ASUS\Projects\one_room_map` 폴더를 엽니다. 터미널에 `git status --short --branch`를 입력해 브랜치와 미커밋 파일을 확인합니다. 내 다른 수정 사항이 있으면 먼저 보관합니다.
2. `git fetch origin`을 실행합니다. 아직 `feat/landlord-flow` 브랜치가 없다면 `git switch -c feat/landlord-flow origin/feat/room-submission-schema`로 생성합니다. 이미 있다면 `git switch feat/landlord-flow`로 이동합니다. 팀원의 매물 등록 계약 변경을 바탕으로 기능을 올리는 브랜치입니다.
3. `sunroom-git-update.zip`의 압축을 풉니다. 압축 해제 폴더 안 `files`의 **내용**을 `one_room_map` 폴더에 복사합니다. 기존 `.git`, `node_modules`, `.env.local`을 삭제하지 마세요. 폴더는 병합하고 같은 이름의 파일만 교체합니다. 다른 사람이 동일한 파일을 그사이에 수정했다면 덮어쓰기 전에 차이를 확인하세요.
4. 기존 저장소 터미널에서 확인합니다.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
git status --short
git diff --check
```

5. 예상한 변경 파일만 나타나는지 확인하고 아래 명령으로 새 기능을 커밋합니다.

```sh
git add README.md app/globals.css app/landlord docs/API_CONTRACT.md docs/APPLY_UPDATE.md docs/CHANGED_FILES.md docs/GIT_UPDATE.md docs/LANDLORD_HANDOFF.md docs/WORK_CONTEXT.md docs/openapi.json scripts/test.mjs src/contracts/landlord.ts src/contracts/schemas.ts src/domain/listing-draft.ts src/domain/rooms.ts src/features/auth/AuthScreen.tsx src/features/landlord src/features/listings/InquiryForm.tsx src/features/listings/RoomDetail.tsx src/features/maps/RoomMap.tsx src/features/maps/kakao.ts src/services/errors.ts src/services/gateway.ts src/services/mock/landlord-gateway.ts src/services/photos.ts src/shared/AppProvider.tsx src/shared/Header.tsx src/shared/app-context.ts tests/core.test.cjs vite.local.config.ts
git diff --cached --stat
git commit -m "feat: 역할별 가입과 집주인 매물 등록·관리 프론트 추가"
git push -u origin feat/landlord-flow
```

반드시 `git diff --cached --stat`에 본인이 의도하지 않은 다른 파일이 없는지 확인하세요. 필요하면 `git restore --staged <경로>`로 제외합니다. 아직 main에 병합하지 마세요. 팀원이 백엔드 변경과 함께 PR에서 검토하면 됩니다.

Windows에서 Cloudflare 개발 실행기의 `ECONNRESET`이 반복되면 `pnpm exec vite --config vite.local.config.ts`로 화면을 실행합니다. GitHub 푸시는 이 ZIP 안에서 자동으로 이뤄지지 않습니다.
