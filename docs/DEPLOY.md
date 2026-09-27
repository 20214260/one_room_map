# 대회 서버 배포 (a7.scnuoss.net)

강사님 서버(`app.scnuoss.net`)의 nginx 동작에 맞춰 배포함 (2026-09-27 확인).

```text
사용자 ─HTTPS→ https://a7.scnuoss.net  (nginx)
                 ├ /api/*  → 127.0.0.1:3107 로 전달, 앞의 /api 를 떼고 넘김 (/api/v1/rooms → /v1/rooms)
                 │           └ ~/sunroom/backend/serve.py (FastAPI, Supervisor 가 관리)
                 │               API_PATH_PREFIX=/api 로 떼어진 /api 를 복원 → 기존 라우트 그대로
                 └ 그 외   → ~/html 폴더의 파일을 그대로 공개 (/admin → ~/html/admin/index.html)
```

- **`~/html` 은 통째로 웹에 공개됨.** 화면 정적 파일만 둔다. 코드·`.env`·가상환경은 `~/sunroom`(권한 700)에 둔다
- 화면은 Next(vinext) 앱을 정적으로 내보낸 것 (`SUNROOM_STATIC_EXPORT=1`, 평소 개발·빌드에는 영향 없음)
- 프로세스 관리: 사용자 권한 **Supervisor**(`deploy/supervisord.conf`). 앱이 죽으면 자동 재시작
- 서버 재부팅 후 자동 실행: 사용자 crontab `@reboot`
- systemd 설정은 건드리지 않음 (대회 규칙)

## 한 번만 하는 준비

1. `deploy/.env.example`을 `deploy/.env`로 복사해서 팀 값으로 채움 (`USER_ID=a7`, `INTERNAL_PORT=3107`, `WORK_PATH=/home/a7/html/`, `APP_PATH=/home/a7/sunroom/`). **커밋 금지**
2. SSH 키 등록 (비밀번호 대신 키로 배포). PowerShell:
   ```powershell
   ssh-keygen -t ed25519 -N '""' -f $env:USERPROFILE\.ssh\sunroom_a7
   type $env:USERPROFILE\.ssh\sunroom_a7.pub | ssh a7@app.scnuoss.net "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
   ```
   처음 접속 질문에 `yes`, 비밀번호는 강사님이 준 값. 이후 배포는 키로만 접속함
3. 카카오·구글 콘솔에 배포 주소 등록
   - 카카오 JavaScript SDK 도메인: `https://a7.scnuoss.net`
   - 카카오 로그인 Redirect URI: `https://a7.scnuoss.net/api/v1/auth/oauth/kakao/callback`
   - 구글 승인된 리디렉션 URI: `https://a7.scnuoss.net/api/v1/auth/oauth/google/callback`
4. 로컬에 `backend/.env`(DB·Gemini·OAuth 키·`ADMIN_EMAILS`), `.env.local`(카카오 JavaScript 키)이 있어야 함

## 배포

프로젝트 루트에서 (Windows는 Git Bash):

```bash
bash scripts/deploy.sh
```

1. SSH 키 접속 확인
2. 프론트 정적 빌드 → `dist/client`, `admin.html` → `admin/index.html` 로 배치. 빌드 매니페스트 등 공개 불필요 파일 제거
3. `backend/app`, `backend/serve.py`, `deploy/` 설정을 `APP_PATH`로 전송
4. `WORK_PATH`(~/html) 내용을 새 화면 파일로 교체 (폴더 자체의 소유·권한은 건드리지 않음, 파일 644/폴더 755)
5. 서버 `APP_PATH/backend/.env` 생성: 로컬 `backend/.env`에서 배포용 값만 덮어씀 (`COOKIE_SECURE=true`, `API_PATH_PREFIX=/api`, `FRONTEND_ORIGINS`·`FRONTEND_URL`·`OAUTH_REDIRECT_BASE`=배포 주소, `INTERNAL_*`). 권한 600, 로컬 임시 파일 없음
6. 가상환경·의존성 → Supervisor 시작/재시작 → `@reboot` cron 등록(순룸 항목만 교체, 다른 cron 보존)
   - 서버에 `python3-venv`·pip·sudo 가 없어서 로컬 Python 에 들어 있는 공식 pip wheel 로 가상환경에 pip 를 설치함
7. 공개 주소 점검: `/`, `/admin/`, `/api/v1/health`, `/api/v1/rooms` 200 + `/backend/.env`, `/deploy/supervisord.conf` 404(노출 안 됨)

## 운영 (서버에서, `~/sunroom`)

```bash
.venv/bin/supervisorctl -c deploy/supervisord.conf status      # RUNNING 확인
.venv/bin/supervisorctl -c deploy/supervisord.conf restart sunroom
tail -f deploy/.run/app.log                                     # 앱 로그
crontab -l                                                      # @reboot 항목 확인
```

## 검증 기록 (2026-09-27)

- 스크립트 한 번으로 배포, 7단계 점검 모두 통과
- 앱 프로세스를 강제 종료 → Supervisor 가 새 프로세스로 다시 띄우고 health 200 (자동 재시작 확인)
- 서버 재부팅은 공용 서버라 실제로 해 보지 않음. `@reboot` cron 등록만 확인
- 실제 사이트에서 카카오 지도·DB 매물·관리자 화면 접근 확인. AI 추천은 서버에서 Gemini 호출·검증 통과 확인, 화면 확인 때는 Google 혼잡(503)·무료 한도(429)로 규칙 기반 요약으로 대체됨

## 알아둘 점

- **`~/html` 폴더 그룹**: 첫 배포 스크립트의 복사 방식 때문에 `~/html` 폴더 그룹이 `www-data` → `a7` 로 바뀜. 우리 계정은 `www-data` 그룹이 아니라 되돌릴 수 없어서, 화면 파일을 누구나 읽기(644/755)로 둬서 nginx 가 읽게 함. 서버의 다른 계정은 홈 폴더(`a7:www-data 750`)에서 막힘. 필요하면 강사님께 `chgrp www-data ~a7/html && chmod 2750 ~a7/html` 요청
- **vinext 1.0.0-beta.5 우회**: 배포 빌드에서 페이지 이동 함수가 번들에서 빠지는 문제가 있어 `src/shared/keep-navigation.ts`로 보존함. vinext 를 올린 뒤 고쳐졌으면 삭제
- 정적 빌드라 페이지 이동은 전체 새로고침으로 처리되고, 콘솔에 미리 불러오기(prefetch) 경고가 날 수 있음. 기능에는 영향 없음
- 인증 증빙 파일은 Supabase 키가 없으면 `~/sunroom/backend/.private/proofs`(권한 700)에 저장됨. 재배포해도 지워지지 않음
- 로컬에서 배포 형태로 확인: `dist/client`를 빌드한 뒤 `FRONTEND_DIST=dist/client INTERNAL_PORT=3107 FRONTEND_ORIGINS=http://127.0.0.1:3107 python backend/serve.py` (이때는 FastAPI 가 화면도 제공)
