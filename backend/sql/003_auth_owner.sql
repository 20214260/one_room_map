-- 003: 역할(seeker/landlord) 로그인 + 집주인 매물 등록 + 문의
-- 기준: docs/API_CONTRACT.md, docs/LANDLORD_HANDOFF.md (2026-09-24 main)
-- Supabase SQL Editor에서 한 번 실행. 여러 번 실행해도 안전하게 작성함.

-- ─────────────────────────────────────────────
-- 1. 로그인은 FastAPI가 세션 쿠키로 직접 관리 (계약 사항)
--    → Supabase Auth(auth.users)에 묶인 profiles/트리거는 더 이상 쓰지 않음
-- ─────────────────────────────────────────────
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists favorites;   -- 비어 있음. 찜은 추후 구현 때 users 기준으로 다시 만듦
drop table if exists profiles;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text,                       -- 소셜 전용 계정은 null
  name text not null,
  role text not null default 'seeker' check (role in ('seeker', 'landlord')),
  provider text not null default 'email' check (provider in ('email', 'kakao', 'google')),
  created_at timestamptz not null default now()
);
create unique index if not exists users_email_lower_key on users (lower(email));

create table if not exists oauth_accounts (
  provider text not null check (provider in ('kakao', 'google')),
  provider_user_id text not null,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (provider, provider_user_id)
);

-- 세션 토큰 원문은 쿠키에만. DB에는 SHA-256 해시만 저장
create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null            -- 최근 활동 기준 7일 갱신
);
create index if not exists sessions_user_idx on sessions (user_id);

-- ─────────────────────────────────────────────
-- 2. rooms: 집주인 등록 매물을 같은 테이블에 저장
-- ─────────────────────────────────────────────
alter table rooms add column if not exists owner_id uuid references users(id) on delete set null;
alter table rooms add column if not exists status text not null default 'published';
alter table rooms add column if not exists contact jsonb;          -- 비공개. 공개 Room 응답에 절대 넣지 않음
alter table rooms add column if not exists zone text;              -- front-gate | back-gate | other
alter table rooms add column if not exists location_detail text;   -- "공대 후문 도보 3분" 같은 한 줄
alter table rooms add column if not exists updated_at timestamptz not null default now();

do $$ begin
  alter table rooms add constraint rooms_status_check
    check (status in ('pending_review', 'published', 'hidden', 'closed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table rooms add constraint rooms_zone_check
    check (zone is null or zone in ('front-gate', 'back-gate', 'other'));
exception when duplicate_object then null; end $$;

-- 기존 published(boolean) → status 로 옮기고 삭제
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'rooms' and column_name = 'published') then
    update rooms set status = case when published then 'published' else 'hidden' end;
    alter table rooms drop column published;
  end if;
end $$;

-- 등록 1단계에선 보증금이 선택 항목. 모르는 값은 null(0과 다름)
alter table rooms alter column deposit drop not null;
-- 상권 여부를 모르면 null ("상권 밖"으로 단정하지 않음)
alter table rooms alter column near_commercial drop default;

create index if not exists rooms_owner_idx on rooms (owner_id);
create index if not exists rooms_status_idx on rooms (status);

-- ─────────────────────────────────────────────
-- 3. 문의 (학생 → 집주인 중계)
--    replyContact는 저장하지 않음: 실제 문자/카카오 전송 전까지 보관할 이유가 없음 (개인정보 최소화)
-- ─────────────────────────────────────────────
create table if not exists inquiries (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references rooms(id) on delete cascade,
  sender_id uuid references users(id) on delete set null,
  message text not null check (char_length(message) between 1 and 500),
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists inquiries_room_idx on inquiries (room_id);

-- RLS: FastAPI는 테이블 소유자(postgres)로 접속하므로 영향 없음. anon 키로는 접근 차단
alter table users enable row level security;
alter table oauth_accounts enable row level security;
alter table sessions enable row level security;
alter table inquiries enable row level security;

-- 채팅 테이블은 채팅 API 만들 때 004로 추가
