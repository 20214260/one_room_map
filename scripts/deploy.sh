#!/usr/bin/env bash
# 대회 서버(app.scnuoss.net) 배포. Git Bash / macOS / Linux 에서 프로젝트 루트 기준으로 실행:
#   bash scripts/deploy.sh
#
# 대회 서버 구조 (2026-09-27 확인):
#   - nginx 가 WORK_PATH(~/html) 를 그대로 웹에 공개 → 화면 정적 파일만 둔다. 코드·설정·가상환경은 절대 두지 않음
#   - /api/* 만 INTERNAL_PORT 앱으로 넘기며 앞의 /api 를 뗌 → 앱이 API_PATH_PREFIX=/api 로 복원
#   - /admin 은 admin/index.html 을 찾음 (없으면 /admin/ 로 301)
# 필요: deploy/.env (deploy/.env.example 참고), 서버에 등록한 SSH 키(SSH_KEY), backend/.env, .env.local
# 비밀번호는 쓰지 않음(키 인증). 비밀 값은 화면·명령행·로컬 임시 파일에 남기지 않음.
set -euo pipefail
cd "$(dirname "$0")/.."

env_get() { # env_get FILE KEY  → 값 (없으면 빈 문자열)
  grep -E "^$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' || true
}

DEPLOY_ENV=deploy/.env
[ -f "$DEPLOY_ENV" ] || { echo "deploy/.env 가 없어요. deploy/.env.example 을 복사해 채워 주세요." >&2; exit 1; }
[ -f backend/.env ] || { echo "backend/.env 가 없어요." >&2; exit 1; }
USER_ID=$(env_get "$DEPLOY_ENV" USER_ID)
HOST=$(env_get "$DEPLOY_ENV" HOST)
DEPLOY_ADDRESS=$(env_get "$DEPLOY_ENV" DEPLOY_ADDRESS)
WORK_PATH=$(env_get "$DEPLOY_ENV" WORK_PATH); WORK_PATH=${WORK_PATH%/}
APP_PATH=$(env_get "$DEPLOY_ENV" APP_PATH); APP_PATH=${APP_PATH%/}
INTERNAL_HOST=$(env_get "$DEPLOY_ENV" INTERNAL_HOST)
INTERNAL_PORT=$(env_get "$DEPLOY_ENV" INTERNAL_PORT)
SSH_KEY=$(env_get "$DEPLOY_ENV" SSH_KEY); SSH_KEY=${SSH_KEY/#\~/$HOME}
ORIGIN=${DEPLOY_ADDRESS%/}
for v in USER_ID HOST DEPLOY_ADDRESS WORK_PATH APP_PATH INTERNAL_HOST INTERNAL_PORT SSH_KEY; do
  [ -n "${!v}" ] || { echo "deploy/.env 에 $v 가 비어 있어요." >&2; exit 1; }
done
case "$APP_PATH/" in "$WORK_PATH"/*) echo "APP_PATH 는 웹 공개 폴더(WORK_PATH) 밖이어야 해요." >&2; exit 1;; esac

SSH=(ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 "$USER_ID@$HOST")

echo "==> 1/7 서버 연결 확인 ($USER_ID@$HOST)"
"${SSH[@]}" "python3 --version" >/dev/null || {
  echo "SSH 키 접속 실패. docs/DEPLOY.md 의 'SSH 키 등록'을 먼저 해 주세요." >&2; exit 1; }

echo "==> 2/7 프론트 정적 빌드"
KAKAO_KEY=$(env_get .env.local NEXT_PUBLIC_KAKAO_MAP_KEY)
rm -rf dist
# MSYS_NO_PATHCONV: Git Bash 가 /api/v1 을 Windows 경로로 바꾸지 않게
MSYS_NO_PATHCONV=1 SUNROOM_STATIC_EXPORT=1 NEXT_PUBLIC_DATA_MODE=http \
  NEXT_PUBLIC_API_BASE_URL=/api/v1 NEXT_PUBLIC_KAKAO_MAP_KEY="$KAKAO_KEY" \
  node node_modules/vinext/dist/cli.js build --prerender-all </dev/null
OUT=dist/client
[ -f "$OUT/index.html" ] && [ -f "$OUT/admin.html" ] || { echo "정적 빌드 결과가 없어요." >&2; exit 1; }
# nginx 용 배치: admin.html → admin/index.html
while IFS= read -r page; do
  rel=${page#"$OUT"/}; name=${rel%.html}
  case "$name" in index|404) continue;; esac
  mkdir -p "$OUT/$name" && mv "$page" "$OUT/$name/index.html"
done < <(find "$OUT" -name '*.html')
rm -rf "$OUT/.vite" "$OUT/_headers" "$OUT/.assetsignore"  # 빌드 매니페스트·Cloudflare 설정은 공개하지 않음

echo "==> 3/7 앱 코드 전송 → $APP_PATH (웹 공개 폴더 밖)"
"${SSH[@]}" "mkdir -p '$APP_PATH' && chmod 700 '$APP_PATH'"
tar -czf - --exclude='__pycache__' --exclude='.pytest_cache' \
    backend/app backend/serve.py backend/requirements.txt \
    deploy/supervisord.conf deploy/requirements.txt \
  | "${SSH[@]}" "tar -xzf - -C '$APP_PATH'"

echo "==> 4/7 화면 파일 전송 → $WORK_PATH (기존 파일 교체)"
# WORK_PATH 폴더 자체(소유 그룹·권한)는 건드리지 않고 내용만 교체 (tar 로 '.' 을 풀면 폴더 속성까지 덮어씀).
# nginx(www-data)가 읽도록 화면 파일은 644/755. 서버의 다른 계정은 홈 폴더(750)에서 막힘
tar -czf - -C "$OUT" $(ls -A "$OUT") | "${SSH[@]}" "set -e; \
  find '$WORK_PATH' -mindepth 1 -maxdepth 1 -exec rm -rf {} + \
  && tar --no-same-owner -xzf - -C '$WORK_PATH' \
  && find '$WORK_PATH' -mindepth 1 -type d -exec chmod 755 {} + \
  && find '$WORK_PATH' -type f -exec chmod 644 {} +"

echo "==> 5/7 서버 backend/.env (배포용 값으로 덮어씀, 권한 600)"
OVERRIDES="INTERNAL_HOST INTERNAL_PORT API_PATH_PREFIX FRONTEND_DIST FRONTEND_ORIGINS FRONTEND_URL OAUTH_REDIRECT_BASE COOKIE_SECURE PROOF_DIR"
{
  grep -vE "^($(echo $OVERRIDES | tr ' ' '|'))=" backend/.env | tr -d '\r'
  echo "INTERNAL_HOST=$INTERNAL_HOST"
  echo "INTERNAL_PORT=$INTERNAL_PORT"
  echo "API_PATH_PREFIX=/api"
  echo "FRONTEND_ORIGINS=$ORIGIN"
  echo "FRONTEND_URL=$ORIGIN"
  echo "OAUTH_REDIRECT_BASE=$ORIGIN"
  echo "COOKIE_SECURE=true"
  echo "PROOF_DIR=$APP_PATH/backend/.private/proofs"
} | "${SSH[@]}" "umask 077 && cat > '$APP_PATH/backend/.env' && chmod 600 '$APP_PATH/backend/.env'"

echo "==> 6/7 가상환경·의존성·Supervisor·재부팅 등록"
# 대회 서버에는 python3-venv(ensurepip)·pip 가 없고 sudo 도 없음 → 로컬 Python 에 포함된 공식 pip wheel 로 설치
if ! "${SSH[@]}" "[ -x '$APP_PATH/.venv/bin/pip' ]"; then
  PY=$(command -v python3 || command -v python)
  WHEEL=$("$PY" -c "import ensurepip,pathlib; print(sorted((pathlib.Path(ensurepip.__file__).parent/'_bundled').glob('pip-*.whl'))[-1])")
  "${SSH[@]}" "cat > '$APP_PATH/deploy/$(basename "$WHEEL")'" < "$WHEEL"
fi
"${SSH[@]}" bash -s -- "$APP_PATH" <<'REMOTE'
set -euo pipefail
A=$1
cd "$A"
if [ ! -x .venv/bin/pip ]; then
  rm -rf .venv
  python3 -m venv --without-pip .venv
  WHEEL=$(ls deploy/pip-*.whl | tail -1)  # pip 는 wheel 파일 이름 형식을 검사하므로 원래 이름 유지
  .venv/bin/python "$WHEEL/pip" install -q "$WHEEL"
  rm -f deploy/pip-*.whl
fi
.venv/bin/pip install -q --disable-pip-version-check -r deploy/requirements.txt
mkdir -p deploy/.run backend/.private/proofs
chmod 700 deploy/.run backend/.private
CONF="$A/deploy/supervisord.conf"
if .venv/bin/supervisorctl -c "$CONF" status >/dev/null 2>&1 || [ $? -eq 3 ]; then
  .venv/bin/supervisorctl -c "$CONF" reread >/dev/null
  .venv/bin/supervisorctl -c "$CONF" update >/dev/null
  .venv/bin/supervisorctl -c "$CONF" restart sunroom
else
  .venv/bin/supervisord -c "$CONF"
fi
LINE="@reboot cd $A && $A/.venv/bin/supervisord -c $CONF >> $A/deploy/.run/boot.log 2>&1"
# 순룸 항목만 교체하고 다른 cron 은 보존
( crontab -l 2>/dev/null | grep -vF "supervisord -c $CONF" || true; echo "$LINE" ) | crontab -
for _ in 1 2 3 4 5 6 7 8 9 10; do
  .venv/bin/supervisorctl -c "$CONF" status sunroom | grep -q RUNNING && break
  sleep 1
done
.venv/bin/supervisorctl -c "$CONF" status sunroom
REMOTE

echo "==> 7/7 공개 주소 확인"
fail=0
check() { # check 경로 기대코드
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "$ORIGIN$1" || true)
  printf "  %-24s %s (기대 %s)\n" "$1" "$code" "$2"; [ "$code" = "$2" ] || fail=1
}
sleep 2
check / 200
check /admin/ 200
check /api/v1/health 200
check /api/v1/rooms 200
# 공개 폴더에 코드·설정이 노출되지 않았는지
check /backend/.env 404
check /deploy/supervisord.conf 404
[ $fail = 0 ] && echo "배포 완료: $ORIGIN" || {
  echo "확인 필요. 서버 로그: $APP_PATH/deploy/.run/app.log" >&2; exit 1; }
