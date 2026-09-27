# 대회 서버 배포 (a7.scnuoss.net)

순룸은 팀에 배정된 포트 하나(`127.0.0.1:3107`)로 서비스함. **FastAPI 한 프로세스가 `/api/v1`과 화면을 같이 제공**하고, 화면은 Next(vinext) 앱을 정적 파일로 내보낸 것임.

```text
사용자 ─HTTPS→ https://a7.scnuoss.net (강사 서버 프록시) ─HTTP→ 127.0.0.1:3107
                                                          └ backend/serve.py (FastAPI)
                                                              ├ /api/v1/...      API (Supabase DB, Gemini)
                                                              └ /, /admin, ...   frontend/*.html (정적 빌드)
```

- 프로세스 관리: 사용자 권한 **Supervisor**(`deploy/supervisord.conf`). 앱이 죽으면 자동 재시작
- 서버 재부팅 후 자동 실행: 사용자 crontab `@reboot`
- systemd 설정은 건드리지 않음 (대회 규칙)

## 한 번만 하는 준비

1. `deploy/.env.example`을 `deploy/.env`로 복사해서 팀 값으로 채움 (`USER_ID=a7`, `INTERNAL_PORT=3107` 등). **커밋 금지**
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
4. 로컬에 `backend/.env`(DB·Gemini·OAuth 키), `.env.local`(카카오 JavaScript 키)이 있어야 함

## 배포

프로젝트 루트에서 (Windows는 Git Bash):

```bash
bash scripts/deploy.sh
```

1. SSH 키 접속 확인
2. 프론트 정적 빌드 → `dist/client` (`SUNROOM_STATIC_EXPORT=1`, API 주소 `/api/v1`)
3. `backend/app`, `backend/serve.py`, `deploy/` 설정, 화면 파일을 서버 `/home/a7/html/`로 전송
4. 서버 `backend/.env` 생성: 로컬 `backend/.env`를 바탕으로 배포용 값만 덮어씀 (`COOKIE_SECURE=true`, `FRONTEND_ORIGINS`·`FRONTEND_URL`·`OAUTH_REDIRECT_BASE`=배포 주소, `INTERNAL_*`, `FRONTEND_DIST`). 권한 600, 로컬 임시 파일 없음
5. `.venv` 생성·의존성 설치 → Supervisor 시작/재시작 → `@reboot` cron 등록(순룸 항목만 교체)
6. `https://a7.scnuoss.net/` 와 `/api/v1/health` 가 200 인지 확인

## 운영 (서버에서, `/home/a7/html`)

```bash
.venv/bin/supervisorctl -c deploy/supervisord.conf status      # RUNNING 확인
.venv/bin/supervisorctl -c deploy/supervisord.conf restart sunroom
tail -f deploy/.run/app.log                                     # 앱 로그
crontab -l                                                      # @reboot 항목 확인
```

## 알아둘 점

- **vinext 1.0.0-beta.5 우회**: 배포 빌드에서 페이지 이동 함수가 번들에서 빠지는 문제가 있어 `src/shared/keep-navigation.ts`로 보존함. vinext를 올린 뒤 고쳐졌으면 삭제
- 정적 빌드라 페이지 이동 시 미리 불러오기(prefetch)는 콘솔 경고가 날 수 있고, 일부 이동은 전체 새로고침으로 처리됨. 기능에는 영향 없음
- 로컬에서 배포 형태로 확인: `bash scripts/deploy.sh` 대신 `dist/client`를 빌드한 뒤 `FRONTEND_DIST=dist/client INTERNAL_PORT=3107 FRONTEND_ORIGINS=http://127.0.0.1:3107 python backend/serve.py`
- 인증 증빙 파일은 Supabase 키가 없으면 서버 `backend/.private/proofs`(권한 700)에 저장됨. 재배포해도 지워지지 않음
