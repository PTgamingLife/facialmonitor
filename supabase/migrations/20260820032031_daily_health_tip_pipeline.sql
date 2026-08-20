-- 每日健康資訊：版本化草稿、人工審核、可靠推播、閱讀積點與免責聲明。
-- 所有日期判定固定使用 Asia/Taipei；外部呼叫只由 Edge Function 執行。

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ── 1. 擴充既有健康資訊 ────────────────────────────────────
alter table public.sb_daily_tips
  add column if not exists summary text,
  add column if not exists detail_points jsonb not null default '[]'::jsonb,
  add column if not exists source_urls jsonb not null default '[]'::jsonb,
  add column if not exists risk_flags jsonb not null default '[]'::jsonb,
  add column if not exists status text not null default 'draft',
  add column if not exists content_version integer not null default 1,
  add column if not exists generated_batch_id uuid,
  add column if not exists content_hash text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.sb_users(id),
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid references public.sb_users(id),
  add column if not exists review_note text,
  add column if not exists updated_at timestamptz not null default now();

update public.sb_daily_tips
   set status = case when active then 'approved' else 'draft' end,
       approved_at = case when active then coalesce(approved_at, created_at) else null end
 where status = 'draft' and approved_at is null;

alter table public.sb_daily_tips drop constraint if exists sb_daily_tips_status_check;
alter table public.sb_daily_tips add constraint sb_daily_tips_status_check
  check (status in ('draft','approved','rejected'));
alter table public.sb_daily_tips drop constraint if exists sb_daily_tips_detail_points_check;
alter table public.sb_daily_tips add constraint sb_daily_tips_detail_points_check
  check (jsonb_typeof(detail_points) = 'array' and jsonb_array_length(detail_points) in (0, 3));
alter table public.sb_daily_tips drop constraint if exists sb_daily_tips_source_urls_check;
alter table public.sb_daily_tips add constraint sb_daily_tips_source_urls_check
  check (jsonb_typeof(source_urls) = 'array');

create index if not exists sb_daily_tips_approved_date_idx
  on public.sb_daily_tips (tip_date) where status = 'approved' and approved_at is not null and active;

create or replace function public.reset_tip_approval_on_content_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.status = 'approved' and (
    new.title is distinct from old.title or new.summary is distinct from old.summary
    or new.body is distinct from old.body or new.detail_points is distinct from old.detail_points
    or new.image_url is distinct from old.image_url or new.source_urls is distinct from old.source_urls
  ) then
    new.status := 'draft';
    new.approved_at := null;
    new.approved_by := null;
    new.content_version := old.content_version + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_daily_tip_reapproval on public.sb_daily_tips;
create trigger trg_daily_tip_reapproval before update on public.sb_daily_tips
for each row execute function public.reset_tip_approval_on_content_change();
revoke execute on function public.reset_tip_approval_on_content_change() from public, anon, authenticated;

drop policy if exists p_tips_read on public.sb_daily_tips;
create policy p_tips_read on public.sb_daily_tips
  for select to anon, authenticated
  using (
    active and status = 'approved' and approved_at is not null
    and tip_date <= (now() at time zone 'Asia/Taipei')::date
  );

drop policy if exists p_tips_admin_read on public.sb_daily_tips;
create policy p_tips_admin_read on public.sb_daily_tips
  for select to authenticated
  using (exists (
    select 1 from public.sb_users u where u.auth_id = auth.uid() and u.is_admin
  ));

-- ── 2. 產稿批次與推播租約 ──────────────────────────────────
create table if not exists public.sb_tip_plan_runs (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status text not null default 'running'
    check (status in ('running','completed','failed')),
  requested_dates integer not null default 0,
  created_count integer not null default 0,
  warning_count integer not null default 0,
  notification_status text not null default 'pending'
    check (notification_status in ('pending','sent','failed')),
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (period_start, period_end)
);

alter table public.sb_tip_plan_runs enable row level security;
revoke all on public.sb_tip_plan_runs from public, anon, authenticated;

create table if not exists public.sb_daily_pushes (
  id uuid primary key default gen_random_uuid(),
  push_date date not null unique,
  tip_id uuid references public.sb_daily_tips(id),
  status text not null default 'pending'
    check (status in ('pending','sending','sent','partial','failed','skipped')),
  locked_until timestamptz,
  attempt_count integer not null default 0,
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sb_daily_push_batches (
  id uuid primary key default gen_random_uuid(),
  push_id uuid not null references public.sb_daily_pushes(id) on delete cascade,
  batch_no integer not null,
  recipient_count integer not null,
  recipient_ids jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','sending','sent','failed')),
  attempt_count integer not null default 0,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  unique (push_id, batch_no)
);

alter table public.sb_daily_pushes enable row level security;
alter table public.sb_daily_push_batches enable row level security;
revoke all on public.sb_daily_pushes from public, anon, authenticated;
revoke all on public.sb_daily_push_batches from public, anon, authenticated;

create or replace function public.rpc_claim_daily_tip_push()
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_tip_id uuid;
  v_push public.sb_daily_pushes%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('daily-tip-' || v_today::text, 0));
  select id into v_tip_id from public.sb_daily_tips
   where tip_date = v_today and active and status = 'approved' and approved_at is not null;

  select * into v_push from public.sb_daily_pushes where push_date = v_today for update;
  if v_tip_id is null then
    if v_push.id is null then
      insert into public.sb_daily_pushes(push_date, status, completed_at, last_error)
      values (v_today, 'skipped', now(), 'no approved tip') returning * into v_push;
    end if;
    return jsonb_build_object('ok', false, 'reason', 'no_approved_tip', 'push_id', v_push.id);
  end if;

  if v_push.id is null then
    insert into public.sb_daily_pushes(push_date, tip_id, status, locked_until, attempt_count, started_at)
    values (v_today, v_tip_id, 'sending', now() + interval '10 minutes', 1, now())
    returning * into v_push;
  elsif v_push.status = 'sent' then
    return jsonb_build_object('ok', false, 'reason', 'already_sent', 'push_id', v_push.id);
  elsif v_push.status = 'sending' and v_push.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'lease_active', 'push_id', v_push.id);
  else
    update public.sb_daily_pushes set
      tip_id = v_tip_id, status = 'sending', locked_until = now() + interval '10 minutes',
      attempt_count = attempt_count + 1, started_at = coalesce(started_at, now()), updated_at = now()
    where id = v_push.id returning * into v_push;
  end if;

  return jsonb_build_object('ok', true, 'push_id', v_push.id, 'tip_id', v_tip_id,
                            'push_date', v_today, 'attempt_count', v_push.attempt_count);
end;
$$;

revoke execute on function public.rpc_claim_daily_tip_push() from public, anon, authenticated;
grant execute on function public.rpc_claim_daily_tip_push() to service_role;

-- ── 3. 免責聲明與閱讀紀錄 ──────────────────────────────────
create table if not exists public.sb_tip_disclaimers (
  version text primary key,
  body text not null,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.sb_tip_disclaimers(version, body, active)
values (
  '2026-08-v1',
  '健康資訊僅供一般衛教與生活參考，不構成診斷、治療或用藥建議。若有持續不適、慢性病、懷孕或正在服藥，請先諮詢醫師或藥師；出現胸痛、呼吸困難、昏厥、意識不清等急症請立即就醫或撥打 119。',
  true
)
on conflict (version) do nothing;

create unique index if not exists sb_tip_disclaimers_one_active_idx
  on public.sb_tip_disclaimers ((active)) where active;

create table if not exists public.sb_tip_disclaimer_agreements (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null references public.line_users(line_user_id) on delete cascade,
  user_id uuid references public.sb_users(id) on delete set null,
  disclaimer_version text not null references public.sb_tip_disclaimers(version),
  disclaimer_body text not null,
  agreed_at timestamptz not null default now(),
  unique (line_user_id, disclaimer_version)
);

create table if not exists public.sb_tip_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.sb_users(id) on delete cascade,
  tip_id uuid not null references public.sb_daily_tips(id) on delete cascade,
  read_at timestamptz not null default now(),
  points_added integer not null default 0,
  unique (user_id, tip_id)
);

create index if not exists sb_tip_reads_user_read_idx
  on public.sb_tip_reads (user_id, read_at desc);

alter table public.sb_tip_disclaimers enable row level security;
alter table public.sb_tip_disclaimer_agreements enable row level security;
alter table public.sb_tip_reads enable row level security;
revoke all on public.sb_tip_disclaimers from public, anon, authenticated;
revoke all on public.sb_tip_disclaimer_agreements from public, anon, authenticated;
revoke all on public.sb_tip_reads from public, anon, authenticated;

-- 每日閱讀 +3；兌換門檻依決策調為 120。
insert into public.sb_point_rules(rule_key, points, limit_per_month, label)
values ('daily_tip_read', 3, null, '閱讀當日健康資訊')
on conflict (rule_key) do update set points = excluded.points, label = excluded.label, enabled = true;

update public.sb_point_rules
   set points = 120, updated_at = now()
 where rule_key = 'redeem_credit';

alter table public.sb_point_ledger drop constraint if exists sb_point_ledger_ref_type_check;
alter table public.sb_point_ledger add constraint sb_point_ledger_ref_type_check
  check (ref_type in ('referral','score','lottery','redeem','admin','checkin','tip_read'));

-- ── 4. 原子閱讀 RPC：伺服器日期、免責聲明、積點與全文一次完成 ──
create or replace function public.rpc_read_tip(p_line_user_id text, p_tip_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_user_id uuid;
  v_tip public.sb_daily_tips%rowtype;
  v_disclaimer public.sb_tip_disclaimers%rowtype;
  v_first boolean := false;
  v_points integer := 0;
  v_inserted integer := 0;
  v_balance integer;
begin
  select sb_user_id into v_user_id
    from public.line_users
   where line_user_id = p_line_user_id and unfollowed_at is null;

  select * into v_tip
    from public.sb_daily_tips
   where id = p_tip_id and active and status = 'approved' and approved_at is not null
     and tip_date <= v_today;
  if v_tip.id is null then
    return jsonb_build_object('ok', false, 'error', 'tip_not_found', 'message', '這則健康資訊目前無法閱讀。');
  end if;

  select * into v_disclaimer from public.sb_tip_disclaimers where active limit 1;
  if v_disclaimer.version is not null and not exists (
    select 1 from public.sb_tip_disclaimer_agreements
     where line_user_id = p_line_user_id and disclaimer_version = v_disclaimer.version
  ) then
    return jsonb_build_object('ok', true, 'needs_disclaimer', true,
      'disclaimer_version', v_disclaimer.version, 'disclaimer_body', v_disclaimer.body,
      'tip_id', v_tip.id);
  end if;

  if v_user_id is null then
    return jsonb_build_object(
      'ok', true, 'bound', false, 'needs_disclaimer', false,
      'first_time', false, 'points_added', 0,
      'message', '綁定會員後，閱讀當日健康資訊可以獲得積點。',
      'tip', jsonb_build_object('id', v_tip.id, 'date', v_tip.tip_date, 'title', v_tip.title,
        'body', v_tip.body, 'detail_points', v_tip.detail_points, 'image_url', v_tip.image_url,
        'source_urls', v_tip.source_urls)
    );
  end if;

  -- 只有今天確實進入推播流程的當日文章才有點；舊卡永遠只讀不給點。
  if v_tip.tip_date = v_today and exists (
    select 1 from public.sb_daily_pushes
     where push_date = v_today and tip_id = v_tip.id
       and status in ('sending','sent','partial')
  ) then
    select coalesce(points, 0) into v_points from public.sb_point_rules
     where rule_key = 'daily_tip_read' and enabled;
    insert into public.sb_tip_reads(user_id, tip_id, points_added)
    values (v_user_id, v_tip.id, v_points)
    on conflict (user_id, tip_id) do nothing;
    get diagnostics v_inserted = row_count;
    v_first := v_inserted = 1;
    if v_first then
      insert into public.sb_point_ledger(user_id, delta, reason, ref_type, ref_id, month_key, note)
      values (v_user_id, v_points, 'daily_tip_read', 'tip_read', v_tip.id,
              to_char(now() at time zone 'Asia/Taipei', 'YYYY-MM'), '閱讀健康資訊 ' || v_tip.tip_date::text)
      on conflict do nothing;
      update public.sb_users set points = coalesce(points, 0) + v_points where id = v_user_id;
    else
      v_points := 0;
    end if;
  end if;

  select coalesce(points, 0) into v_balance from public.sb_users where id = v_user_id;
  return jsonb_build_object(
    'ok', true, 'bound', true, 'needs_disclaimer', false,
    'first_time', v_first, 'points_added', v_points, 'balance', v_balance,
    'is_today', v_tip.tip_date = v_today,
    'tip', jsonb_build_object('id', v_tip.id, 'date', v_tip.tip_date, 'title', v_tip.title,
      'body', v_tip.body, 'detail_points', v_tip.detail_points, 'image_url', v_tip.image_url,
      'source_urls', v_tip.source_urls)
  );
end;
$$;

create or replace function public.rpc_agree_tip_disclaimer(
  p_line_user_id text, p_version text, p_tip_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare v_user_id uuid; v_body text;
begin
  select sb_user_id into v_user_id from public.line_users
   where line_user_id = p_line_user_id and unfollowed_at is null;
  if not exists (select 1 from public.line_users where line_user_id = p_line_user_id and unfollowed_at is null) then
    return jsonb_build_object('ok', false, 'error', 'line_user_not_found');
  end if;
  select body into v_body from public.sb_tip_disclaimers where version = p_version and active;
  if v_body is null then return jsonb_build_object('ok', false, 'error', 'version_expired'); end if;
  insert into public.sb_tip_disclaimer_agreements(line_user_id, user_id, disclaimer_version, disclaimer_body)
  values (p_line_user_id, v_user_id, p_version, v_body) on conflict do nothing;
  return public.rpc_read_tip(p_line_user_id, p_tip_id);
end;
$$;

-- 管理員審核只經登入 session 呼叫；修改任何已核准內容都必須重新審核。
create or replace function public.rpc_admin_review_tip(
  p_tip_id uuid, p_decision text, p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin uuid;
begin
  select id into v_admin from public.sb_users where auth_id = auth.uid() and is_admin;
  if v_admin is null then raise exception 'forbidden'; end if;
  if p_decision not in ('approve','reject') then raise exception 'invalid decision'; end if;
  update public.sb_daily_tips set
    status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
    approved_at = case when p_decision = 'approve' then now() else null end,
    approved_by = case when p_decision = 'approve' then v_admin else null end,
    rejected_at = case when p_decision = 'reject' then now() else null end,
    rejected_by = case when p_decision = 'reject' then v_admin else null end,
    review_note = p_note,
    updated_at = now()
  where id = p_tip_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'status', case when p_decision = 'approve' then 'approved' else 'rejected' end);
end;
$$;

-- service_role 會以 invoker 權限執行閱讀 RPC；一般用戶不能偽造 LINE 身分呼叫。
revoke execute on function public.rpc_read_tip(text, uuid) from public, anon, authenticated;
revoke execute on function public.rpc_agree_tip_disclaimer(text, text, uuid) from public, anon, authenticated;
grant execute on function public.rpc_read_tip(text, uuid) to service_role;
grant execute on function public.rpc_agree_tip_disclaimer(text, text, uuid) to service_role;

revoke execute on function public.rpc_admin_review_tip(uuid, text, text) from public, anon;
grant execute on function public.rpc_admin_review_tip(uuid, text, text) to authenticated, service_role;

-- 既有打卡 RPC 也必須遵守核准狀態；SECURITY DEFINER 不會被 RLS 自動擋住。
create or replace function public.latest_approved_daily_tip(p_day date)
returns public.sb_daily_tips
language sql stable security invoker set search_path = '' as $$
  select t from public.sb_daily_tips t
   where t.active and t.status = 'approved' and t.approved_at is not null and t.tip_date <= p_day
   order by t.tip_date desc limit 1;
$$;
revoke execute on function public.latest_approved_daily_tip(date) from public, anon, authenticated;
grant execute on function public.latest_approved_daily_tip(date) to service_role;

create or replace function public.rpc_daily_checkin(p_user_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := resolve_user_id(p_user_id);
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_pts integer := rule_points('daily_checkin');
  v_first boolean := false;
  v_tip sb_daily_tips%rowtype;
  v_streak integer := 0;
begin
  if v_me is null then return jsonb_build_object('ok', false, 'message', '請先綁定會員。'); end if;
  begin
    insert into sb_checkins(user_id, checkin_date, points_added) values (v_me, v_today, v_pts);
    v_first := true;
  exception when unique_violation then v_first := false;
  end;
  if v_first and v_pts > 0 then
    perform award_points(v_me, v_pts, 'daily_checkin', 'checkin', null,
                         month_key_of(now()), '每日打卡 ' || v_today::text);
  end if;
  select count(*) into v_streak from (
    select checkin_date, checkin_date - (row_number() over(order by checkin_date desc))::int as grp
      from sb_checkins where user_id = v_me and checkin_date <= v_today
  ) t where t.grp = v_today - 1;

  select * into v_tip from sb_daily_tips
   where active and status = 'approved' and approved_at is not null and tip_date <= v_today
   order by tip_date desc limit 1;

  return jsonb_build_object(
    'ok', true, 'first_time', v_first,
    'points_added', case when v_first then v_pts else 0 end,
    'balance', (select coalesce(points, 0) from sb_users where id = v_me),
    'streak', greatest(v_streak, 1),
    'tip', case when v_tip.id is null then null else jsonb_build_object(
      'title', v_tip.title, 'body', v_tip.body, 'image_url', v_tip.image_url, 'date', v_tip.tip_date) end
  );
end $$;

revoke execute on function public.rpc_daily_checkin(uuid) from public, anon;
grant execute on function public.rpc_daily_checkin(uuid) to authenticated, service_role;

-- ── 5. 排程：每週補足未來 14 天，07:30 預檢，08:00 推播 ─────
-- Vault secrets 需在部署時建立：healthbot_project_url、healthbot_tip_plan_secret、
-- healthbot_tip_push_secret。Cron 內只保存查 Vault 的 SQL，不保存明文萬能金鑰。
select cron.schedule(
  'healthbot-tip-plan-weekly', '0 14 * * 0',
  $$select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'healthbot_project_url') || '/functions/v1/tip-plan',
    headers := jsonb_build_object('Content-Type','application/json','x-tip-plan-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'healthbot_tip_plan_secret')),
    body := jsonb_build_object('scheduled_at', now()), timeout_milliseconds := 10000
  )$$
);

select cron.schedule(
  'healthbot-tip-preflight-daily', '30 23 * * *',
  $$select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'healthbot_project_url') || '/functions/v1/tip-push',
    headers := jsonb_build_object('Content-Type','application/json','x-tip-push-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'healthbot_tip_push_secret')),
    body := '{"mode":"preflight"}'::jsonb, timeout_milliseconds := 10000
  )$$
);

select cron.schedule(
  'healthbot-tip-push-daily', '0 0 * * *',
  $$select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'healthbot_project_url') || '/functions/v1/tip-push',
    headers := jsonb_build_object('Content-Type','application/json','x-tip-push-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'healthbot_tip_push_secret')),
    body := '{"mode":"push"}'::jsonb, timeout_milliseconds := 10000
  )$$
);
