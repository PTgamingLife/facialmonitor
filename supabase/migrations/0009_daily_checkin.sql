-- ============================================================
-- 每日打卡 + 每日健康資訊圖文
--
-- 打卡一天只能拿一次點。防重複不靠程式判斷,靠 unique(user_id, checkin_date)：
-- 使用者連點兩下、LINE 重送同一則 postback,都會撞到唯一鍵而不是變成兩次加點。
-- ============================================================

-- ── 1. 每日健康資訊(內容由後台每天放一筆) ──────────────────
create table if not exists sb_daily_tips (
  id         uuid primary key default gen_random_uuid(),
  tip_date   date not null unique,
  title      text not null,
  body       text not null,
  image_url  text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table sb_daily_tips is
  '每日健康資訊。打卡後跳出當天這一筆;當天沒放就退回最近一筆已發布的。';

alter table sb_daily_tips enable row level security;

-- 健康資訊是公開內容,誰都能讀,但只有後台(service_role)能寫
drop policy if exists p_tips_read on sb_daily_tips;
create policy p_tips_read on sb_daily_tips
  for select to anon, authenticated using (active and tip_date <= (now() at time zone 'Asia/Taipei')::date);

-- ── 2. 打卡紀錄 ────────────────────────────────────────────
create table if not exists sb_checkins (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references sb_users(id) on delete cascade,
  checkin_date date not null,
  points_added integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (user_id, checkin_date)          -- 一天一次,這條就是防重複的全部
);

create index if not exists sb_checkins_user_idx on sb_checkins (user_id, checkin_date desc);

alter table sb_checkins enable row level security;

drop policy if exists p_checkins_own on sb_checkins;
create policy p_checkins_own on sb_checkins
  for select to authenticated using (user_id = current_sb_user_id());

-- ── 3. 打卡點數規則 ────────────────────────────────────────
insert into sb_point_rules (rule_key, points, limit_per_month, label) values
  ('daily_checkin', 3, null, '每日打卡')
on conflict (rule_key) do update set points = excluded.points, label = excluded.label;

-- ── 4. 打卡 RPC ────────────────────────────────────────────
create or replace function rpc_daily_checkin(p_user_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := resolve_user_id(p_user_id);
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_pts   integer := rule_points('daily_checkin');
  v_first boolean := false;
  v_tip   sb_daily_tips%rowtype;
  v_streak integer := 0;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'message', '請先綁定會員。');
  end if;

  -- 先搶今天這一格。搶到才發點 —— 併發或重送都只會有一個人搶到。
  begin
    insert into sb_checkins (user_id, checkin_date, points_added)
    values (v_me, v_today, v_pts);
    v_first := true;
  exception when unique_violation then
    v_first := false;
  end;

  if v_first and v_pts > 0 then
    -- ref_id 用不到,但 reason + month_key 讓帳本看得出這是哪個月的打卡
    perform award_points(v_me, v_pts, 'daily_checkin', 'checkin', null,
                         month_key_of(now()), '每日打卡 ' || v_today::text);
  end if;

  -- 連續天數:從今天往回數,斷了就停
  select count(*) into v_streak
    from (
      select checkin_date,
             checkin_date - (row_number() over (order by checkin_date desc))::int as grp
        from sb_checkins
       where user_id = v_me and checkin_date <= v_today
    ) t
   where t.grp = v_today - 1;

  -- 今天的圖文;沒放就退回最近一筆(不要讓沒上稿就打不了卡)
  select * into v_tip from sb_daily_tips
   where active and tip_date <= v_today
   order by tip_date desc limit 1;

  return jsonb_build_object(
    'ok', true,
    'first_time', v_first,
    'points_added', case when v_first then v_pts else 0 end,
    'balance', (select coalesce(points, 0) from sb_users where id = v_me),
    'streak', greatest(v_streak, 1),
    'tip', case when v_tip.id is null then null else jsonb_build_object(
      'title', v_tip.title, 'body', v_tip.body,
      'image_url', v_tip.image_url, 'date', v_tip.tip_date) end
  );
end $$;

-- ── 5. 最新分數 + 與上一次的差額 ───────────────────────────
create or replace function rpc_latest_score(p_user_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me   uuid := resolve_user_id(p_user_id);
  v_last record;
  v_prev record;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'message', '請先綁定會員。');
  end if;

  select score_of(report) as score, created_at into v_last
    from sb_analysis_records
   where user_id = v_me and score_of(report) is not null
   order by created_at desc limit 1;

  if v_last.score is null then
    return jsonb_build_object('ok', true, 'has_record', false);
  end if;

  select score_of(report) as score, created_at into v_prev
    from sb_analysis_records
   where user_id = v_me and score_of(report) is not null
     and created_at < v_last.created_at
   order by created_at desc limit 1;

  return jsonb_build_object(
    'ok', true,
    'has_record', true,
    'latest', v_last.score,
    'latest_at', v_last.created_at,
    -- 只有一次檢測就沒有差額可談,前端要靠這個判斷要不要顯示
    'has_previous', v_prev.score is not null,
    'previous', v_prev.score,
    'previous_at', v_prev.created_at,
    'delta', case when v_prev.score is null then null else v_last.score - v_prev.score end
  );
end $$;

-- ── 6. 授權 ────────────────────────────────────────────────
revoke execute on function rpc_daily_checkin(uuid) from public, anon;
revoke execute on function rpc_latest_score(uuid)  from public, anon;
grant  execute on function rpc_daily_checkin(uuid) to authenticated, service_role;
grant  execute on function rpc_latest_score(uuid)  to authenticated, service_role;
