-- 005: 집주인 인증 (docs/OWNER_VERIFICATION_HANDOFF.md, src/contracts/verification.ts)
-- Supabase SQL Editor에서 실행. 여러 번 실행해도 안전함.
--
-- 사용자당 현재 신청 1건. 재신청하면 같은 행을 덮어씀.
-- 승인(approved)은 관리자만 설정함. 클라이언트 요청이나 AI 결과로 자동 승인하지 않음.

create table if not exists owner_verifications (
  user_id uuid primary key references users(id) on delete cascade,
  status text not null default 'not_submitted'
    check (status in ('not_submitted', 'reviewing', 'needs_info', 'approved', 'rejected')),
  application_id uuid,                        -- 신청할 때마다 새로 발급. 관리자 결정 시 같은 신청인지 확인
  owner_name text,
  building_address text,
  proof_path text,                            -- 비공개 저장소 경로. 공개 URL 아님
  proof_mime text,
  proof_size integer,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references users(id) on delete set null,
  message text,                               -- 신청자에게 보여줄 안내 (보완 요청·반려 사유)
  ai_review jsonb,                            -- 심사 보조 결과. 승인 근거로 단독 사용 금지
  updated_at timestamptz not null default now()
);
create index if not exists owner_verifications_status_idx on owner_verifications (status);

-- 이미 가입한 집주인도 not_submitted 행을 가짐 (기존 매물 등록 권한은 승인 전까지 막힘)
insert into owner_verifications (user_id)
select id from users where role = 'landlord'
on conflict (user_id) do nothing;

-- 다른 테이블과 같이 Supabase REST(anon) 직접 접근 차단. FastAPI 는 DB 소유자 권한으로 접속
alter table owner_verifications enable row level security;
