-- ============================================================
-- 推薦 / 積點 / 抽獎 — RPC(唯一寫入入口)
--
-- 呼叫者有兩種:
--   1) 網頁前端:帶登入者 JWT,auth.uid() 有值 → 一律以本人身分執行,
--      p_user_id 參數會被忽略(防止冒充別人)。
--   2) LINE bot / 排程:用 service_role key,auth.uid() 為 null →
--      必須明確帶 p_user_id。
-- anon(未登入且非 service_role)一律 unauthorized。
-- ============================================================

-- ── 身分解析 ───────────────────────────────────────────────
create or replace function is_service_role() returns boolean
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json->>'role',
    ''
  ) = 'service_role';
$$;

create or replace function resolve_user_id(p_user_id uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null then
    select id into v_id from sb_users where auth_id = auth.uid();
    if v_id is null then raise exception 'user_not_found'; end if;
    return v_id;                        -- 登入者一律只能操作自己
  end if;

  if is_service_role() then
    if p_user_id is null then raise exception 'user_id_required'; end if;
    return p_user_id;
  end if;

  raise exception 'unauthorized';
end $$;

-- ── 小工具 ─────────────────────────────────────────────────
create or replace function month_key_of(p_ts timestamptz)
returns text language sql immutable as $$
  select to_char(p_ts at time zone 'Asia/Taipei', 'YYYY-MM');
$$;

create or replace function rule_points(p_key text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select points from sb_point_rules
                   where rule_key = p_key and enabled), 0);
$$;

-- 從 report jsonb 取健康分數:新格式 scores.total,舊格式 score
create or replace function score_of(p_report jsonb)
returns numeric language plpgsql immutable as $$
declare v text;
begin
  v := coalesce(p_report->'scores'->>'total', p_report->>'score');
  if v is null or v !~ '^[0-9]+(\.[0-9]+)?$' then return null; end if;
  return v::numeric;
end $$;

-- 發點的唯一途徑:寫總帳 + 同步 sb_users.points 快取
-- uniq_ledger_event 會擋掉同一事件重複發點,遇到就靜靜跳過。
create or replace function award_points(
  p_user_id uuid, p_delta integer, p_reason text,
  p_ref_type text default null, p_ref_id uuid default null,
  p_month_key text default null, p_note text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_delta = 0 then return false; end if;

  begin
    insert into sb_point_ledger(user_id, delta, reason, ref_type, ref_id, month_key, note)
    values (p_user_id, p_delta, p_reason, p_ref_type, p_ref_id, p_month_key, p_note);
  exception when unique_violation then
    return false;                      -- 這個事件已經發過點
  end;

  update sb_users set points = greatest(0, coalesce(points, 0) + p_delta)
   where id = p_user_id;
  return true;
end $$;

-- ============================================================
-- 1. 填寫小天使
-- ============================================================
create or replace function rpc_bind_angel(
  p_code text, p_user_id uuid default null, p_source text default 'web'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid; v_angel uuid; v_ref_id uuid; v_pts integer;
begin
  v_me := resolve_user_id(p_user_id);
  p_code := trim(coalesce(p_code, ''));

  if p_code !~ '^[0-9]{7}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_code',
                              'message', '推薦碼是 7 位數字');
  end if;

  select id into v_angel from sb_users where member_code = p_code;
  if v_angel is null then
    return jsonb_build_object('ok', false, 'error', 'not_found',
                              'message', '找不到這個推薦碼');
  end if;

  if v_angel = v_me then
    return jsonb_build_object('ok', false, 'error', 'self',
                              'message', '不能填自己的推薦碼喔');
  end if;

  if exists (select 1 from sb_referrals where invitee_user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'already_bound',
                              'message', '你已經有小天使了,綁定後不能更改');
  end if;

  -- 不可互推成環:對方的小天使不能是我
  if exists (select 1 from sb_referrals
              where invitee_user_id = v_angel and referrer_user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'circular',
                              'message', '對方已經填了你當小天使,不能互填');
  end if;

  insert into sb_referrals(referrer_user_id, invitee_user_id, referral_code, source)
  values (v_angel, v_me, p_code,
          case when p_source = 'line' then 'line' else 'web' end)
  returning id into v_ref_id;

  v_pts := rule_points('bind_angel');
  perform award_points(v_me, v_pts, 'bind_angel', 'referral', v_ref_id,
                       month_key_of(now()), '填寫小天使');

  return jsonb_build_object(
    'ok', true, 'points_awarded', v_pts,
    'angel_name', (select name from sb_users where id = v_angel),
    'balance', (select points from sb_users where id = v_me),
    'message', format('已認定小天使,獲得 %s 點', v_pts));
end $$;

-- ============================================================
-- 2. 被推薦人完成首次檢測 → 小天使得點
--    由 analyze 完成後 / score-settle 呼叫(service_role)
-- ============================================================
create or replace function rpc_confirm_referral(p_invitee_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ref record; v_limit integer; v_used integer; v_pts integer; v_month text;
begin
  if not is_service_role() then raise exception 'unauthorized'; end if;

  select * into v_ref from sb_referrals
   where invitee_user_id = p_invitee_id and status = 'pending';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_pending_referral');
  end if;

  -- 必須真的做過至少一次檢測,光註冊不給點
  if not exists (select 1 from sb_analysis_records where user_id = p_invitee_id) then
    return jsonb_build_object('ok', false, 'error', 'no_scan_yet');
  end if;

  v_month := month_key_of(now());
  v_limit := (select limit_per_month from sb_point_rules
               where rule_key = 'invite_confirmed');

  if v_limit is not null then
    select count(*) into v_used from sb_point_ledger
     where user_id = v_ref.referrer_user_id
       and reason = 'invite_confirmed' and month_key = v_month;
    if v_used >= v_limit then
      update sb_referrals set status = 'confirmed', confirmed_at = now()
       where id = v_ref.id;
      return jsonb_build_object('ok', true, 'points_awarded', 0,
                                'error', 'monthly_limit_reached');
    end if;
  end if;

  update sb_referrals set status = 'confirmed', confirmed_at = now()
   where id = v_ref.id;

  v_pts := rule_points('invite_confirmed');
  perform award_points(v_ref.referrer_user_id, v_pts, 'invite_confirmed',
                       'referral', v_ref.id, v_month, '推薦的人完成首次檢測');

  return jsonb_build_object('ok', true, 'points_awarded', v_pts,
                            'referrer_id', v_ref.referrer_user_id);
end $$;

-- ============================================================
-- 3. 月度分數結算(當月進步 >= 門檻 → 本人與小天使得點)
--    口徑:當月 2 筆以上 → first = 當月最早、best = 當月最高
--          當月 1 筆     → baseline 取上月最後一筆
--          上月也沒有     → 不計獎
-- ============================================================
create or replace function rpc_settle_score(
  p_user_id uuid, p_month_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_month text; v_cnt integer; v_first numeric; v_best numeric;
  v_baseline text; v_delta numeric; v_threshold numeric;
  v_snap sb_score_snapshots%rowtype; v_angel uuid;
  v_pts_self integer; v_pts_angel integer;
begin
  if not is_service_role() then raise exception 'unauthorized'; end if;

  v_month := coalesce(p_month_key, month_key_of(now()));

  select count(*), max(score_of(report))
    into v_cnt, v_best
    from sb_analysis_records
   where user_id = p_user_id
     and month_key_of(created_at) = v_month
     and score_of(report) is not null;

  if v_cnt = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_records');
  end if;

  if v_cnt >= 2 then
    select score_of(report) into v_first from sb_analysis_records
     where user_id = p_user_id and month_key_of(created_at) = v_month
       and score_of(report) is not null
     order by created_at asc limit 1;
    v_baseline := 'same_month';
  else
    select score_of(report) into v_first from sb_analysis_records
     where user_id = p_user_id
       and month_key_of(created_at) < v_month
       and score_of(report) is not null
     order by created_at desc limit 1;
    v_baseline := 'prev_month';
    if v_first is null then
      return jsonb_build_object('ok', false, 'error', 'no_baseline');
    end if;
  end if;

  v_delta := v_best - v_first;

  insert into sb_score_snapshots(user_id, month_key, first_score, best_score,
                                 delta, baseline_source, updated_at)
  values (p_user_id, v_month, v_first, v_best, v_delta, v_baseline, now())
  on conflict (user_id, month_key) do update
    set first_score = excluded.first_score,
        best_score  = excluded.best_score,
        delta       = excluded.delta,
        baseline_source = excluded.baseline_source,
        updated_at  = now()
  returning * into v_snap;

  v_threshold := rule_points('score_up_threshold');
  if v_threshold = 0 then v_threshold := 10; end if;

  if v_snap.rewarded or v_delta < v_threshold then
    return jsonb_build_object('ok', true, 'rewarded', false,
                              'delta', v_delta, 'threshold', v_threshold,
                              'first_score', v_first, 'best_score', v_best);
  end if;

  update sb_score_snapshots set rewarded = true, rewarded_at = now()
   where id = v_snap.id;

  v_pts_self := rule_points('score_up_referee');
  perform award_points(p_user_id, v_pts_self, 'score_up_referee', 'score',
                       v_snap.id, v_month, format('當月進步 %s 分', v_delta));

  select referrer_user_id into v_angel from sb_referrals
   where invitee_user_id = p_user_id and status = 'confirmed';

  v_pts_angel := 0;
  if v_angel is not null then
    v_pts_angel := rule_points('score_up_angel');
    perform award_points(v_angel, v_pts_angel, 'score_up_angel', 'score',
                         v_snap.id, v_month,
                         format('推薦的人當月進步 %s 分', v_delta));
  end if;

  return jsonb_build_object('ok', true, 'rewarded', true,
    'delta', v_delta, 'first_score', v_first, 'best_score', v_best,
    'points_self', v_pts_self, 'points_angel', v_pts_angel,
    'angel_id', v_angel);
end $$;

-- ── 授權(本檔的 RPC)──────────────────────────────────────
grant execute on function rpc_bind_angel(text, uuid, text) to authenticated, service_role;
grant execute on function rpc_confirm_referral(uuid) to service_role;
grant execute on function rpc_settle_score(uuid, text) to service_role;
