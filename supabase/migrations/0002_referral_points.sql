-- ============================================================
-- 推薦(小天使)+ 積點 + 抽獎 — 資料表
-- 專案:facialmonitor (wcemkmwrlvijxxwybrgs)
--
-- 前綴用 sb_ 而非 line_:網頁 App 與 LINE bot 共用同一份積點資料,
-- 且與 sb_users 有 FK 關係,必須同庫同層。
--
-- 寫入一律經 0003 的 SECURITY DEFINER RPC;anon 只能讀自己的資料。
-- ============================================================

-- ── 0. sb_users 補欄位 ─────────────────────────────────────
alter table sb_users add column if not exists points integer not null default 0;

-- 後台身分改用資料庫旗標判斷,不再只靠前端比對 email。
-- 沿用 js/auth.js 既有的管理員判定條件做初始化。
alter table sb_users add column if not exists is_admin boolean not null default false;

update sb_users set is_admin = true
 where email = 'poting75321@gmail.com'
    or (phone = '0912345678' and name = 'PTGM');

-- member_code 是推薦碼的載體,必須人人都有且唯一。
-- 舊資料可能有 null,先補齊再加唯一索引。
create or replace function gen_member_code() returns text
language plpgsql volatile as $$
declare v_code text;
begin
  loop
    v_code := lpad((floor(random() * 9000000) + 1000000)::bigint::text, 7, '0');
    exit when not exists (select 1 from sb_users where member_code = v_code);
  end loop;
  return v_code;
end $$;

do $$
declare r record;
begin
  -- 補齊沒有推薦碼的
  for r in select id from sb_users where member_code is null or member_code = '' loop
    update sb_users set member_code = gen_member_code() where id = r.id;
  end loop;

  -- 舊資料若有重複,保留最早建立的那筆,其餘重新產生
  for r in
    select id from (
      select id, row_number() over (
        partition by member_code order by created_at nulls last, id
      ) as rn
      from sb_users where member_code is not null
    ) t where t.rn > 1
  loop
    update sb_users set member_code = gen_member_code() where id = r.id;
  end loop;
end $$;

-- member_code 欄位本身已經有 unique 約束(既有 schema 就有),
-- 這裡只要補上自動產生的預設值,不需要再建一個重複的唯一索引。
alter table sb_users alter column member_code set default gen_member_code();

-- ── 1. 推薦關係 ────────────────────────────────────────────
create table if not exists sb_referrals (
  id               uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references sb_users(id) on delete cascade,  -- 小天使
  invitee_user_id  uuid not null references sb_users(id) on delete cascade,
  referral_code    text not null,
  source           text not null default 'web' check (source in ('web','line')),
  status           text not null default 'pending'
                   check (status in ('pending','confirmed','void')),
  confirmed_at     timestamptz,
  created_at       timestamptz not null default now(),
  -- 一人只能有一位小天使
  constraint uniq_referral_invitee unique (invitee_user_id),
  -- 不可自薦
  constraint chk_referral_not_self check (referrer_user_id <> invitee_user_id)
);

create index if not exists idx_referrals_referrer
  on sb_referrals(referrer_user_id, status);

-- ── 2. 積點總帳(唯一真相來源,只 insert 不 update) ──────────
create table if not exists sb_point_ledger (
  id         bigserial primary key,
  user_id    uuid not null references sb_users(id) on delete cascade,
  delta      integer not null,
  reason     text not null,
  ref_type   text check (ref_type in ('referral','score','lottery','redeem','admin')),
  ref_id     uuid,
  month_key  text,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ledger_user
  on sb_point_ledger(user_id, created_at desc);

-- 同一個獎勵事件只發一次:reason + ref_id 組合唯一
create unique index if not exists uniq_ledger_event
  on sb_point_ledger(user_id, reason, ref_id)
  where ref_id is not null;

-- ── 3. 積點規則(後台可調,不用改 code) ──────────────────────
create table if not exists sb_point_rules (
  rule_key        text primary key,
  points          integer not null,
  limit_per_month integer,
  label           text,
  enabled         boolean not null default true,
  updated_at      timestamptz not null default now()
);

insert into sb_point_rules (rule_key, points, limit_per_month, label) values
  ('bind_angel',        10, null, '填寫小天使'),
  ('invite_confirmed',  30,   20, '推薦的人完成首次檢測'),
  ('score_up_referee',  20, null, '自己當月分數提升 10 分以上'),
  ('score_up_angel',    50, null, '推薦的人當月分數提升 10 分以上'),
  ('redeem_credit',    100, null, '兌換 1 次檢測所需積點'),
  ('lottery_draw',      30, null, '抽獎一次所需積點'),
  ('score_up_threshold', 10, null, '分數提升門檻(分)')
on conflict (rule_key) do nothing;

-- ── 4. 月度分數結算 ────────────────────────────────────────
create table if not exists sb_score_snapshots (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references sb_users(id) on delete cascade,
  month_key       text not null,                       -- YYYY-MM(台北時間)
  first_score     numeric,
  best_score      numeric,
  delta           numeric,
  baseline_source text check (baseline_source in ('same_month','prev_month')),
  rewarded        boolean not null default false,
  rewarded_at     timestamptz,
  updated_at      timestamptz not null default now(),
  constraint uniq_snapshot_user_month unique (user_id, month_key)
);

-- ── 5. 抽獎獎品 ────────────────────────────────────────────
create table if not exists sb_lottery_prizes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  image_url   text,
  stock       integer not null default 0 check (stock >= 0),
  weight      integer not null default 1 check (weight > 0),
  active      boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ── 6. 抽獎紀錄 ────────────────────────────────────────────
create table if not exists sb_lottery_draws (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references sb_users(id) on delete cascade,
  prize_id    uuid references sb_lottery_prizes(id) on delete set null,
  prize_name  text not null,       -- 快照,獎品被刪也留得住
  cost_points integer not null,
  status      text not null default 'pending'
              check (status in ('pending','contacted','shipped','claimed')),
  drawn_at    timestamptz not null default now()
);

create index if not exists idx_draws_user
  on sb_lottery_draws(user_id, drawn_at desc);

-- ============================================================
-- RLS:寫入一律走 RPC,anon 只能讀自己的
-- ============================================================
alter table sb_referrals       enable row level security;
alter table sb_point_ledger    enable row level security;
alter table sb_point_rules     enable row level security;
alter table sb_score_snapshots enable row level security;
alter table sb_lottery_prizes  enable row level security;
alter table sb_lottery_draws   enable row level security;

-- 目前登入者對應的 sb_users.id
create or replace function current_sb_user_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from sb_users where auth_id = auth.uid();
$$;

drop policy if exists p_ledger_own on sb_point_ledger;
create policy p_ledger_own on sb_point_ledger
  for select to authenticated using (user_id = current_sb_user_id());

drop policy if exists p_draws_own on sb_lottery_draws;
create policy p_draws_own on sb_lottery_draws
  for select to authenticated using (user_id = current_sb_user_id());

drop policy if exists p_referrals_own on sb_referrals;
create policy p_referrals_own on sb_referrals
  for select to authenticated
  using (invitee_user_id = current_sb_user_id()
      or referrer_user_id = current_sb_user_id());

drop policy if exists p_snapshots_own on sb_score_snapshots;
create policy p_snapshots_own on sb_score_snapshots
  for select to authenticated using (user_id = current_sb_user_id());

-- 獎品與規則是公開資訊,誰都能讀,但改不了
drop policy if exists p_prizes_read on sb_lottery_prizes;
create policy p_prizes_read on sb_lottery_prizes
  for select to anon, authenticated using (active = true);

drop policy if exists p_rules_read on sb_point_rules;
create policy p_rules_read on sb_point_rules
  for select to anon, authenticated using (enabled = true);

-- 收掉前端對「貨幣欄位」的直接寫入(0003 的 RPC 才是唯一入口)。
--
-- ⚠️ 這裡不能只做欄位級 revoke:Postgres 的表級 UPDATE 與欄位級 UPDATE 是
--    兩套獨立的授權,只 revoke 欄位不會拿掉既有的表級授權(Supabase 預設就有),
--    結果會是一行沒有作用的假防護。正確作法是先收掉整表,再逐欄放行。
do $$
declare
  v_allowed text[] := array[
    'name','phone','email',
    'coins','streak','bottles_sent','bottle_rewarded',
    'referral_used','referral_count',
    'is_admin'];
  v_cols text;
begin
  revoke update on sb_users from anon, authenticated;

  -- 只放行實際存在的非貨幣欄位,避免因為欄位不存在讓 migration 中斷
  select string_agg(quote_ident(column_name), ', ')
    into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'sb_users'
     and column_name = any(v_allowed)
     and column_name <> 'is_admin';   -- 管理員旗標只能由 DBA 改

  if v_cols is not null then
    execute format('grant update (%s) on sb_users to authenticated', v_cols);
  end if;
end $$;
