-- 004: 학생 ↔ 집주인 채팅
-- 기준: docs/CHAT_HANDOFF.md, src/contracts/chat.ts (2026-09-24 main)
-- Supabase SQL Editor에서 한 번 실행. 여러 번 실행해도 안전함.

create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  -- 매물이 삭제돼도 대화 기록은 보존 → room_id 는 null 이 되고 room_snapshot 으로 요약을 보여줌
  room_id text references rooms(id) on delete set null,
  room_snapshot jsonb not null,           -- {id,title,photoUrl,location,deposit,rent,maintenance}
  owner_id uuid not null references users(id) on delete cascade,
  seeker_id uuid not null references users(id) on delete cascade,
  owner_read_seq bigint not null default 0,   -- 사용자별 마지막 읽은 메시지 위치
  seeker_read_seq bigint not null default 0,
  blocked_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 같은 방·같은 학생의 대화는 하나만 (동시 요청에도)
create unique index if not exists chats_room_seeker_key on chats (room_id, seeker_id) where room_id is not null;
create index if not exists chats_owner_idx on chats (owner_id);
create index if not exists chats_seeker_idx on chats (seeker_id);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  seq bigserial not null,                 -- 순서·읽음 계산용 (시간이 같아도 순서 확정)
  chat_id uuid not null references chats(id) on delete cascade,
  sender_id uuid references users(id) on delete set null,
  kind text not null check (kind in ('text', 'visit_proposal', 'visit_response')),
  text text not null check (char_length(text) between 1 and 500),
  visit_at timestamptz,
  proposal_id uuid references chat_messages(id) on delete cascade,
  decision text check (decision is null or decision in ('accepted', 'declined')),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_chat_idx on chat_messages (chat_id, seq);
-- 한 방문 제안에는 답변 한 번만
create unique index if not exists chat_messages_one_response_key
  on chat_messages (proposal_id) where kind = 'visit_response';

create table if not exists chat_reports (
  chat_id uuid not null references chats(id) on delete cascade,
  reporter_id uuid not null references users(id) on delete cascade,
  reason text not null check (reason in ('spam', 'inappropriate', 'other')),
  created_at timestamptz not null default now(),
  primary key (chat_id, reporter_id)       -- 신고자별 중복 접수 방지
);

alter table chats enable row level security;
alter table chat_messages enable row level security;
alter table chat_reports enable row level security;
