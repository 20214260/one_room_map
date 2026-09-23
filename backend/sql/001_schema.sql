-- Supabase SQL Editor에서 실행한 스키마 (2026-09-23 기준)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  created_at timestamptz default now()
);

create table if not exists rooms (
  id text primary key,
  title text not null,
  neighborhood text,
  deposit int not null,            -- 원
  rent int not null,               -- 원
  maintenance int,                 -- 원, null = 정보 없음
  area numeric,                    -- m²
  floor int,
  school_distance int,             -- m, null 가능
  near_commercial boolean default false,
  description text,
  lat double precision,
  lng double precision,
  photos jsonb default '[]',
  options jsonb default '{}',
  facilities jsonb default '[]',
  source jsonb,
  distance_source jsonb,
  published boolean default true,
  created_at timestamptz default now()
);

create table if not exists favorites (
  user_id uuid references auth.users(id) on delete cascade,
  room_id text references rooms(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, room_id)
);

alter table profiles enable row level security;
alter table rooms enable row level security;
alter table favorites enable row level security;
