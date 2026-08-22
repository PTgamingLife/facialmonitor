-- 收費改制：單次 60 元 → 年費 680 元 / 12 次
-- 併同開放期優惠：促銷視窗內每人每月自動 +1 次檢測，為期半年。

-- ── 1. 商品白名單 ────────────────────────────────────────────
-- 原本「60 元 / 1 次」硬寫在三個地方(卡片、payment-fulfill、RPC)，
-- 改一次價就要同時改三處，漏一處就是「畫面顯示新價、後端只收舊價」。
-- 改成查表：金額與次數只有這裡一份，RPC 仍然自己查、不信前端傳來的數字。
create table if not exists public.sb_products (
  code    text primary key,
  label   text not null,
  amount  integer not null check (amount > 0),
  credits integer not null check (credits > 0),
  active  boolean not null default true
);

alter table public.sb_products enable row level security;
revoke all on table public.sb_products from public, anon, authenticated;

-- 舊商品保留但停售：已經成立的訂單要能被 LINE Pay 重試確認。
-- 把它從表裡刪掉的話，那筆重試會落到「invalid product」而不是
-- 「already_fulfilled」，等於把一筆已付款的訂單擋在門外。
insert into public.sb_products (code, label, amount, credits, active) values
  ('facial-scan-single', '單次面舌診檢測（已停售）', 60, 1, false),
  ('facial-scan-annual', '年費方案 12 次面舌診檢測', 680, 12, true)
on conflict (code) do update
  set label = excluded.label,
      amount = excluded.amount,
      credits = excluded.credits,
      active = excluded.active;

-- ── 2. 付款入帳改查表 ────────────────────────────────────────
create or replace function public.rpc_fulfill_linepay_payment(
  p_order_id text,
  p_transaction_id text,
  p_user_id uuid,
  p_line_user_id text,
  p_product_code text,
  p_amount integer,
  p_credits integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.sb_linepay_orders%rowtype;
  v_credits integer;
begin
  if p_order_id is null or p_order_id !~ '^FM[0-9A-Za-z]{10,40}$' then
    raise exception 'invalid order id';
  end if;
  if p_transaction_id is null or length(p_transaction_id) > 40 then
    raise exception 'invalid transaction id';
  end if;

  -- 金額與次數一律以商品表為準；前端送什麼過來都要對得上，對不上就拒收。
  -- 這裡刻意不看 active —— 停售商品的舊訂單仍要能重試確認。
  if not exists (
    select 1 from public.sb_products
     where code = p_product_code
       and amount = p_amount
       and credits = p_credits
  ) then
    raise exception 'invalid product';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_order_id, 0));

  select *
    into v_existing
    from public.sb_linepay_orders
   where order_id = p_order_id
   for update;

  if found then
    if v_existing.transaction_id = p_transaction_id
       and v_existing.user_id = p_user_id
       and v_existing.line_user_id = p_line_user_id
       and v_existing.product_code = p_product_code
       and v_existing.amount = p_amount
       and v_existing.credits = p_credits
       and v_existing.status = 'paid' then
      select credits into v_credits from public.sb_users where id = p_user_id;
      return jsonb_build_object('ok', true, 'already_fulfilled', true, 'credits', v_credits);
    end if;
    raise exception 'order data mismatch';
  end if;

  if not exists (
    select 1
      from public.line_users lu
      join public.sb_users su on su.id = lu.sb_user_id
     where lu.line_user_id = p_line_user_id
       and lu.sb_user_id = p_user_id
       and su.merged_into is null
  ) then
    raise exception 'LINE member binding mismatch';
  end if;

  insert into public.sb_linepay_orders (
    order_id, transaction_id, user_id, line_user_id,
    product_code, amount, credits, status
  ) values (
    p_order_id, p_transaction_id, p_user_id, p_line_user_id,
    p_product_code, p_amount, p_credits, 'paid'
  );

  update public.sb_users
     set credits = credits + p_credits
   where id = p_user_id
     and merged_into is null
  returning credits into v_credits;

  if v_credits is null then
    raise exception 'member not found';
  end if;

  return jsonb_build_object('ok', true, 'already_fulfilled', false, 'credits', v_credits);
end;
$$;

revoke execute on function public.rpc_fulfill_linepay_payment(
  text, text, uuid, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.rpc_fulfill_linepay_payment(
  text, text, uuid, text, text, integer, integer
) to service_role;

-- ── 3. 開放期免費次數 ────────────────────────────────────────
-- 視窗放在資料表而不是程式碼裡：要延長或提前結束促銷是營運決定，
-- 改一列 UPDATE 就好，不必重新部署 Edge Function。
create table if not exists public.sb_promo_free_credit (
  id                boolean primary key default true check (id),
  first_month       date not null,   -- 含當月，必須是該月 1 號
  last_month        date not null,   -- 含當月，必須是該月 1 號
  credits_per_month integer not null default 1 check (credits_per_month > 0),
  active            boolean not null default true,
  check (first_month = date_trunc('month', first_month)::date),
  check (last_month  = date_trunc('month', last_month)::date),
  check (last_month >= first_month)
);

alter table public.sb_promo_free_credit enable row level security;
revoke all on table public.sb_promo_free_credit from public, anon, authenticated;

-- 半年 = 2026-08 ~ 2027-01，共 6 個月。
insert into public.sb_promo_free_credit (id, first_month, last_month, credits_per_month, active)
values (true, date '2026-08-01', date '2027-01-01', 1, true)
on conflict (id) do nothing;

-- 一人一個月只能領一次；唯一鍵就是冪等保護，排程重跑不會重複發。
create table if not exists public.sb_free_credit_grants (
  user_id     uuid not null references public.sb_users(id) on delete cascade,
  grant_month date not null,
  credits     integer not null check (credits > 0),
  granted_at  timestamptz not null default now(),
  primary key (user_id, grant_month)
);

alter table public.sb_free_credit_grants enable row level security;
revoke all on table public.sb_free_credit_grants from public, anon, authenticated;

create or replace function public.rpc_grant_monthly_free_credits()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_promo public.sb_promo_free_credit%rowtype;
  v_month date;
  v_granted integer := 0;
begin
  select * into v_promo from public.sb_promo_free_credit where id = true;
  if not found or not v_promo.active then
    return jsonb_build_object('ok', true, 'skipped', 'inactive', 'granted', 0);
  end if;

  v_month := pg_catalog.date_trunc(
    'month', (pg_catalog.now() at time zone 'Asia/Taipei')
  )::date;

  if v_month < v_promo.first_month or v_month > v_promo.last_month then
    return jsonb_build_object('ok', true, 'skipped', 'out_of_window',
                              'month', v_month, 'granted', 0);
  end if;

  -- 只發給還在使用中的會員；被合併掉的舊帳號不算一份。
  -- on conflict do nothing：這支每天跑，當月第二次以後就是整批 no-op。
  with claimed as (
    insert into public.sb_free_credit_grants (user_id, grant_month, credits)
    select u.id, v_month, v_promo.credits_per_month
      from public.sb_users u
     where u.merged_into is null
    on conflict (user_id, grant_month) do nothing
    returning user_id
  ), applied as (
    update public.sb_users s
       set credits = pg_catalog.coalesce(s.credits, 0) + v_promo.credits_per_month
      from claimed c
     where s.id = c.user_id
    returning s.id
  )
  select pg_catalog.count(*) into v_granted from applied;

  return jsonb_build_object('ok', true, 'month', v_month, 'granted', v_granted);
end;
$$;

revoke execute on function public.rpc_grant_monthly_free_credits() from public, anon, authenticated;
grant execute on function public.rpc_grant_monthly_free_credits() to service_role;

-- 每天跑而不是每月 1 號跑：月初那一次萬一失敗就整個月補不回來，
-- 而且月中才加入的會員也領不到當月這一次。
-- 靠唯一鍵擋重複，跑三十次跟跑一次的結果一樣。
select cron.schedule(
  'healthbot-free-credit-monthly',
  '5 16 * * *',                      -- 16:05 UTC = 台北 00:05
  $cron$ select public.rpc_grant_monthly_free_credits(); $cron$
);
