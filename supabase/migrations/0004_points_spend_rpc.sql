-- ============================================================
-- 積點花用(兌換 / 抽獎)、次數消耗、兌換碼、後台調整
-- 接續 0003_referral_rpc.sql,共用該檔的 resolve_user_id /
-- rule_points / award_points / month_key_of 等 helper。
-- ============================================================

-- ============================================================
-- 4. 積點兌換檢測次數
-- ============================================================
create or replace function rpc_redeem_credits(
  p_count integer default 1, p_user_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid; v_cost integer; v_total integer; v_bal integer;
begin
  v_me := resolve_user_id(p_user_id);
  if p_count is null or p_count < 1 or p_count > 10 then
    return jsonb_build_object('ok', false, 'error', 'bad_count',
                              'message', '一次只能兌換 1 到 10 次');
  end if;

  v_cost  := rule_points('redeem_credit');
  v_total := v_cost * p_count;

  -- 鎖住這一列,避免同時兩個請求各扣一次
  select points into v_bal from sb_users where id = v_me for update;
  if coalesce(v_bal, 0) < v_total then
    return jsonb_build_object('ok', false, 'error', 'insufficient',
      'balance', coalesce(v_bal, 0), 'need', v_total,
      'message', format('積點不足,還差 %s 點', v_total - coalesce(v_bal, 0)));
  end if;

  insert into sb_point_ledger(user_id, delta, reason, ref_type, month_key, note)
  values (v_me, -v_total, 'redeem_credit', 'redeem', month_key_of(now()),
          format('兌換 %s 次檢測', p_count));

  update sb_users
     set points  = points - v_total,
         credits = coalesce(credits, 0) + p_count
   where id = v_me;

  return jsonb_build_object('ok', true, 'credits_added', p_count,
    'points_spent', v_total,
    'balance', (select points from sb_users where id = v_me),
    'credits', (select credits from sb_users where id = v_me));
end $$;

-- ============================================================
-- 5. 抽獎(扣點 + 抽獎 + 扣庫存,同一個 transaction)
-- ============================================================
create or replace function rpc_draw_lottery(p_user_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid; v_cost integer; v_bal integer;
  v_total_weight bigint; v_roll bigint; v_acc bigint := 0;
  v_prize sb_lottery_prizes%rowtype; v_draw_id uuid;
begin
  v_me   := resolve_user_id(p_user_id);
  v_cost := rule_points('lottery_draw');

  select points into v_bal from sb_users where id = v_me for update;
  if coalesce(v_bal, 0) < v_cost then
    return jsonb_build_object('ok', false, 'error', 'insufficient',
      'balance', coalesce(v_bal, 0), 'need', v_cost,
      'message', format('積點不足,抽一次要 %s 點', v_cost));
  end if;

  select coalesce(sum(weight), 0) into v_total_weight
    from sb_lottery_prizes where active and stock > 0;
  if v_total_weight = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_prize',
                              'message', '獎品都被抽完了,晚點再來');
  end if;

  v_roll := floor(random() * v_total_weight)::bigint;

  for v_prize in
    select * from sb_lottery_prizes
     where active and stock > 0 order by sort, id
  loop
    v_acc := v_acc + v_prize.weight;
    if v_roll < v_acc then exit; end if;
  end loop;

  -- 扣庫存;條件式 update 擋住同時抽光最後一件的競態
  update sb_lottery_prizes set stock = stock - 1
   where id = v_prize.id and stock > 0;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'race_lost',
                              'message', '手速差一點,再抽一次');
  end if;

  insert into sb_point_ledger(user_id, delta, reason, ref_type, month_key, note)
  values (v_me, -v_cost, 'lottery_draw', 'lottery', month_key_of(now()),
          format('抽中 %s', v_prize.name));

  update sb_users set points = points - v_cost where id = v_me;

  insert into sb_lottery_draws(user_id, prize_id, prize_name, cost_points)
  values (v_me, v_prize.id, v_prize.name, v_cost)
  returning id into v_draw_id;

  return jsonb_build_object('ok', true, 'draw_id', v_draw_id,
    'prize_name', v_prize.name, 'prize_image', v_prize.image_url,
    'points_spent', v_cost,
    'balance', (select points from sb_users where id = v_me));
end $$;

-- ============================================================
-- 6. 一次撈完獎勵頁要的所有資料
-- ============================================================
create or replace function rpc_my_reward_summary(p_user_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid; v_row sb_users%rowtype;
begin
  v_me := resolve_user_id(p_user_id);
  select * into v_row from sb_users where id = v_me;

  return jsonb_build_object(
    'member_code', v_row.member_code,
    'points',      coalesce(v_row.points, 0),
    'credits',     coalesce(v_row.credits, 0),
    'angel', (
      select jsonb_build_object('name', u.name, 'code', u.member_code,
                                'status', r.status)
        from sb_referrals r join sb_users u on u.id = r.referrer_user_id
       where r.invitee_user_id = v_me),
    'invitees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', u.name, 'status', r.status,
               'created_at', r.created_at,
               'delta', (select s.delta from sb_score_snapshots s
                          where s.user_id = u.id
                            and s.month_key = month_key_of(now())))
             order by r.created_at desc)
        from sb_referrals r join sb_users u on u.id = r.invitee_user_id
       where r.referrer_user_id = v_me), '[]'::jsonb),
    'invitee_stats', (
      select jsonb_build_object(
        'total', count(*),
        'confirmed', count(*) filter (where status = 'confirmed'))
        from sb_referrals where referrer_user_id = v_me),
    'recent_ledger', coalesce((
      select jsonb_agg(x order by x->>'created_at' desc) from (
        select jsonb_build_object('delta', delta, 'reason', reason,
                                  'note', note, 'created_at', created_at) as x
          from sb_point_ledger where user_id = v_me
         order by created_at desc limit 5) t), '[]'::jsonb),
    'rates', jsonb_build_object(
      'redeem_credit', rule_points('redeem_credit'),
      'lottery_draw',  rule_points('lottery_draw'),
      'threshold',     rule_points('score_up_threshold'))
  );
end $$;

-- ============================================================
-- 7. 扣檢測次數(取代前端直接 update sb_users.credits)
-- ============================================================
create or replace function rpc_consume_credit(p_user_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid; v_credits integer;
begin
  v_me := resolve_user_id(p_user_id);

  select credits into v_credits from sb_users where id = v_me for update;
  if coalesce(v_credits, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'no_credits',
                              'message', '檢測次數不足');
  end if;

  update sb_users
     set credits    = credits - 1,
         total_used = coalesce(total_used, 0) + 1
   where id = v_me;

  return jsonb_build_object('ok', true,
    'credits',    (select credits from sb_users where id = v_me),
    'total_used', (select total_used from sb_users where id = v_me));
end $$;

-- 8. 兌換碼加次數 → 見 0006_fix_code_usage.sql
--    這支原本寫在這裡,但它參照的 code_usages 表在正式庫並不存在
--    (真實的表是 code_usage,單數,且外鍵指向舊的 users 表)。
--    改由 0006 建立正確版本,這裡刻意不定義,避免先建一支壞的再覆蓋。

-- ============================================================
-- 9. 後台調整次數 / 積點(取代 admin.js 直接 update sb_users)
-- ============================================================
create or replace function is_admin_caller() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select is_admin from sb_users where auth_id = auth.uid()), false
  ) or is_service_role();
$$;

create or replace function rpc_admin_set_balance(
  p_target_user_id uuid,
  p_credits integer default null,
  p_points integer default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_old_points integer; v_diff integer;
begin
  if not is_admin_caller() then raise exception 'forbidden'; end if;

  if p_credits is not null then
    if p_credits < 0 then
      return jsonb_build_object('ok', false, 'error', 'negative');
    end if;
    update sb_users set credits = p_credits where id = p_target_user_id;
  end if;

  if p_points is not null then
    if p_points < 0 then
      return jsonb_build_object('ok', false, 'error', 'negative');
    end if;
    select points into v_old_points from sb_users where id = p_target_user_id;
    v_diff := p_points - coalesce(v_old_points, 0);
    if v_diff <> 0 then
      -- 後台手動調整也要留在總帳裡,不然對帳會對不起來
      insert into sb_point_ledger(user_id, delta, reason, ref_type, month_key, note)
      values (p_target_user_id, v_diff, 'admin_adjust', 'admin',
              month_key_of(now()), coalesce(p_note, '後台調整'));
      update sb_users set points = p_points where id = p_target_user_id;
    end if;
  end if;

  return jsonb_build_object('ok', true,
    'credits', (select credits from sb_users where id = p_target_user_id),
    'points',  (select points  from sb_users where id = p_target_user_id));
end $$;


-- ── 授權(本檔的 RPC)──────────────────────────────────────
grant execute on function
  rpc_redeem_credits(integer, uuid),
  rpc_draw_lottery(uuid),
  rpc_my_reward_summary(uuid),
  rpc_consume_credit(uuid),
  rpc_admin_set_balance(uuid, integer, integer, text)
to authenticated, service_role;
