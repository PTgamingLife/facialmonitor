-- 14 天健康挑戰：排程推播的資料表。
--
-- 這兩張表原本是直接在正式庫用 execute_sql 建的，沒有留下 migration，
-- repo 裡也查不到 —— 等於沒有人能從原始碼重建 challenge-push 依賴的 schema。
-- 這支就是照正式庫現況補寫的還原檔，全部寫成冪等，重跑一次不會有副作用。

create table if not exists public.sb_health_challenges (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.sb_users(id) on delete cascade,
  status           text not null default 'active',
  source_report_id uuid references public.sb_analysis_records(id) on delete set null,
  health_focus     text not null,
  plan             jsonb not null,
  starts_on        date not null default ((now() at time zone 'Asia/Taipei')::date + 1),
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

do $$ begin
  alter table public.sb_health_challenges
    add constraint sb_health_challenges_status_check
    check (status in ('active','completed','cancelled'));
exception when duplicate_object then null; end $$;

-- plan 必須剛好 14 天：challenge-push 直接用 plan[day-1] 取當日任務，
-- 長度不對會推出空白卡片，寧可在寫入時就擋掉。
do $$ begin
  alter table public.sb_health_challenges
    add constraint sb_health_challenges_plan_check
    check (jsonb_typeof(plan) = 'array' and jsonb_array_length(plan) = 14);
exception when duplicate_object then null; end $$;

-- 一個人同時只能有一個進行中的挑戰。
create unique index if not exists sb_health_challenges_one_active
  on public.sb_health_challenges (user_id) where status = 'active';

-- 每人每天只送一次：唯一鍵本身就是冪等保護，
-- challenge-push 先搶這一列搶不到就跳過，排程重跑不會重複推播。
create table if not exists public.sb_health_challenge_deliveries (
  challenge_id uuid not null references public.sb_health_challenges(id) on delete cascade,
  day_no       integer not null,
  sent_at      timestamptz not null default now(),
  primary key (challenge_id, day_no)
);

do $$ begin
  alter table public.sb_health_challenge_deliveries
    add constraint sb_health_challenge_deliveries_day_no_check
    check (day_no >= 1 and day_no <= 14);
exception when duplicate_object then null; end $$;

-- 開 RLS 但不給任何 policy：這兩張表只有 service role(Edge Function)碰得到，
-- anon / authenticated 一律讀不到也寫不進去。
alter table public.sb_health_challenges            enable row level security;
alter table public.sb_health_challenge_deliveries  enable row level security;
