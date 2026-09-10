-- ============================================================
-- 計分模型版本隔離
--
-- 背景:analyze v4 換了健康分數的計算方式(眼診納入計分、三診加權、
-- 總分改後端算),新舊分數不是同一把尺。但月結 rpc_settle_score 與
-- rpc_latest_score 都是「拿最近兩筆相減」,切換當下會把 v1 分數
-- 減 v2 分數當成進步/退步 —— 前者會誤發或漏發積點(20/50 點),
-- 後者會讓使用者看到憑空出現的退步。
--
-- 這裡的處理:舊資料一列都不改,但**直接跳出比較範圍**。
--   - 月結只看目前版本的紀錄,舊版紀錄不能當 baseline 也不計入最佳分
--   - 最新分數仍會顯示舊版那筆(使用者的紀錄不該憑空消失),
--     但不跟它算差額,並回傳 legacy 旗標讓前端標示「舊模型計算」
--
-- 之後再改計分模型,只要 bump current_score_version() 就會自動隔離。
-- ============================================================

-- ── 1. 版本 helper ─────────────────────────────────────────
-- 目前的計分模型版本。analyze 寫進 report.scores.version 的值要跟這裡一致。
create or replace function current_score_version()
returns integer language sql immutable as $$ select 2 $$;

-- 一筆報告是用哪一版算的:沒有 version 欄位的都是 v1(舊模型)
create or replace function score_version(p_report jsonb)
returns integer language plpgsql immutable as $$
declare v text;
begin
  v := p_report->'scores'->>'version';
  if v is null or v !~ '^[0-9]+$' then return 1; end if;
  return v::integer;
end $$;

-- ── 2. 月結:只結算目前版本的紀錄 ──────────────────────────
create or replace function rpc_settle_score(
  p_user_id uuid, p_month_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_month text; v_cnt integer; v_first numeric; v_best numeric;
  v_baseline text; v_delta numeric; v_threshold numeric;
  v_snap sb_score_snapshots%rowtype; v_angel uuid;
  v_pts_self integer; v_pts_angel integer;
  v_ver integer := current_score_version();
begin
  if not is_service_role() then raise exception 'unauthorized'; end if;

  v_month := coalesce(p_month_key, month_key_of(now()));

  select count(*), max(score_of(report))
    into v_cnt, v_best
    from sb_analysis_records
   where user_id = p_user_id
     and month_key_of(created_at) = v_month
     and score_of(report) is not null
     and score_version(report) = v_ver;

  if v_cnt = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_records');
  end if;

  if v_cnt >= 2 then
    select score_of(report) into v_first from sb_analysis_records
     where user_id = p_user_id and month_key_of(created_at) = v_month
       and score_of(report) is not null
       and score_version(report) = v_ver
     order by created_at asc limit 1;
    v_baseline := 'same_month';
  else
    -- 上個月的 baseline 也必須是同一版模型,不然是拿兩把尺相減
    select score_of(report) into v_first from sb_analysis_records
     where user_id = p_user_id
       and month_key_of(created_at) < v_month
       and score_of(report) is not null
       and score_version(report) = v_ver
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

-- ── 3. 最新分數:舊模型那筆照顯示,但不參與比較 ────────────
create or replace function rpc_latest_score(p_user_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me   uuid := resolve_user_id(p_user_id);
  v_last record;
  v_prev record;
  v_ver  integer;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'message', '請先綁定會員。');
  end if;

  select score_of(report) as score, created_at, score_version(report) as ver
    into v_last
    from sb_analysis_records
   where user_id = v_me and score_of(report) is not null
   order by created_at desc limit 1;

  if v_last.score is null then
    return jsonb_build_object('ok', true, 'has_record', false);
  end if;

  v_ver := v_last.ver;

  -- 只跟同一版模型的前一筆比較;跨版本的差額沒有意義
  select score_of(report) as score, created_at into v_prev
    from sb_analysis_records
   where user_id = v_me and score_of(report) is not null
     and created_at < v_last.created_at
     and score_version(report) = v_ver
   order by created_at desc limit 1;

  return jsonb_build_object(
    'ok', true,
    'has_record', true,
    'latest', v_last.score,
    'latest_at', v_last.created_at,
    'score_version', v_ver,
    -- 舊模型算的分數:前端要標示「不列入比較範圍」
    'legacy', v_ver <> current_score_version(),
    -- 只有一次檢測就沒有差額可談,前端要靠這個判斷要不要顯示
    'has_previous', v_prev.score is not null,
    'previous', v_prev.score,
    'previous_at', v_prev.created_at,
    'delta', case when v_prev.score is null then null else v_last.score - v_prev.score end
  );
end $$;

-- ── 4. 授權(helper 一律不對外,rpc_* 維持原本的授權)────────
revoke execute on function current_score_version()  from public, anon, authenticated;
revoke execute on function score_version(jsonb)     from public, anon, authenticated;
alter  function current_score_version() set search_path = public, pg_catalog;
alter  function score_version(jsonb)    set search_path = public, pg_catalog;

revoke execute on function rpc_settle_score(uuid, text) from public, anon, authenticated;
grant  execute on function rpc_settle_score(uuid, text) to service_role;
revoke execute on function rpc_latest_score(uuid)  from public, anon;
grant  execute on function rpc_latest_score(uuid)  to authenticated, service_role;
