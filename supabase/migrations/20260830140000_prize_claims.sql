-- 獎品保留區 + 後台領獎管理,並把抽獎機率改成照剩餘數量
--
-- 三件事一起做,因為它們是同一條線:抽中 → 留在保留區 → 後台確認領取。
--
-- ① 機率改成照 stock
--    轉盤要照「還剩幾個」畫格子(200 罐能量飲就是 200 格),但原本是照 weight 抽的。
--    格數與機率不一致的話,轉盤就是在說謊 —— 跟先前「卡片寫 100 點但實際扣 0 點」
--    是同一種 bug。要嘛不畫格子,要嘛機率照數量。這裡選後者。
--    weight 欄位保留不刪:已經填好的值還在,之後想改回權重制不必重建資料。
--
-- ② sb_lottery_draws 已經有 status(目前全是 pending),不另開新表。
--    補 claimed_at / claimed_by,才知道是誰在什麼時候確認的。
--
-- ③ 後台的兩支 RPC 都擋 is_admin_caller()。抽獎名單裡有其他人的姓名與電話,
--    不擋等於任何登入者都查得到全部會員的中獎紀錄。

-- ── ① 抽獎改成照剩餘數量 ────────────────────────────────────
create or replace function public.rpc_draw_lottery(p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid; v_cost integer; v_bal integer; v_ticket uuid;
  v_total bigint; v_roll bigint; v_acc bigint := 0;
  v_prize sb_lottery_prizes%rowtype; v_draw_id uuid; v_free boolean := false;
begin
  v_me   := resolve_user_id(p_user_id);
  v_cost := rule_points('lottery_draw');

  select points into v_bal from sb_users where id = v_me for update;

  -- skip locked:同時連按兩下時第二次拿不到這張券,不會一券兩用。
  select id into v_ticket
    from sb_lottery_tickets
   where user_id = v_me and used_at is null
   order by granted_at
   for update skip locked
   limit 1;

  if v_ticket is not null then
    v_free := true;
    v_cost := 0;
  elsif coalesce(v_bal, 0) < v_cost then
    return jsonb_build_object('ok', false, 'error', 'insufficient',
      'balance', coalesce(v_bal, 0), 'need', v_cost,
      'message', format('積點不足,抽一次要 %s 點', v_cost));
  end if;

  -- 這裡是這次唯一的行為改變:權重 = 剩餘數量。
  -- 轉盤上一個格子就是一份獎品,抽到的機率就是那一份被抽中的機率。
  select coalesce(sum(stock), 0) into v_total
    from sb_lottery_prizes where active and stock > 0;
  if v_total = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_prize',
                              'message', '獎品都被抽完了,晚點再來');
  end if;

  v_roll := floor(random() * v_total)::bigint;

  for v_prize in
    select * from sb_lottery_prizes
     where active and stock > 0 order by sort, id
  loop
    v_acc := v_acc + v_prize.stock;
    if v_roll < v_acc then exit; end if;
  end loop;

  update sb_lottery_prizes set stock = stock - 1
   where id = v_prize.id and stock > 0;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'race_lost',
                              'message', '手速差一點,再抽一次');
  end if;

  if not v_free then
    insert into sb_point_ledger(user_id, delta, reason, ref_type, month_key, note)
    values (v_me, -v_cost, 'lottery_draw', 'lottery', month_key_of(now()),
            format('抽中 %s', v_prize.name));
    update sb_users set points = points - v_cost where id = v_me;
  end if;

  insert into sb_lottery_draws(user_id, prize_id, prize_name, cost_points)
  values (v_me, v_prize.id, v_prize.name, v_cost)
  returning id into v_draw_id;

  if v_free then
    update sb_lottery_tickets
       set used_at = now(), draw_id = v_draw_id
     where id = v_ticket;
  end if;

  return jsonb_build_object('ok', true, 'draw_id', v_draw_id,
    'prize_name', v_prize.name, 'prize_image', v_prize.image_url,
    'points_spent', v_cost, 'used_free_ticket', v_free,
    'free_tickets', (select count(*) from sb_lottery_tickets
                      where user_id = v_me and used_at is null),
    'balance', (select points from sb_users where id = v_me));
end $function$;

-- ── ② 領取狀態 ──────────────────────────────────────────────
alter table public.sb_lottery_draws
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by uuid references public.sb_users(id);

do $$ begin
  alter table public.sb_lottery_draws
    add constraint sb_lottery_draws_status_check
    check (status in ('pending', 'claimed', 'void'));
exception when duplicate_object then null; end $$;

create index if not exists sb_lottery_draws_pending_idx
  on public.sb_lottery_draws (drawn_at desc) where status = 'pending';

comment on column public.sb_lottery_draws.claimed_at is
  '後台按下「確認領取」的時間。null 表示還沒領。';

-- ── ③ 獎品保留區:使用者自己的中獎清單 ──────────────────────
create or replace function public.rpc_my_prizes(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_me uuid;
begin
  v_me := resolve_user_id(p_user_id);
  if v_me is null then
    return jsonb_build_object('ok', false, 'message', '請先綁定會員。');
  end if;

  return jsonb_build_object(
    'ok', true,
    'pending', (select count(*) from sb_lottery_draws
                 where user_id = v_me and status = 'pending'),
    'prizes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'name', d.prize_name, 'image', p.image_url,
               'status', d.status, 'drawn_at', d.drawn_at, 'claimed_at', d.claimed_at)
             order by d.drawn_at desc)
        from sb_lottery_draws d
        left join sb_lottery_prizes p on p.id = d.prize_id
       where d.user_id = v_me), '[]'::jsonb)
  );
end $function$;

-- ── ④ 後台:所有中獎者 ──────────────────────────────────────
create or replace function public.rpc_admin_prize_claims(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  -- 這份名單有其他人的姓名與電話,不擋等於任何登入者都查得到。
  if not is_admin_caller() then
    return jsonb_build_object('ok', false, 'message', '需要管理員權限。');
  end if;

  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
             'draw_id', d.id, 'prize_name', d.prize_name,
             'status', d.status, 'drawn_at', d.drawn_at, 'claimed_at', d.claimed_at,
             'user_id', u.id, 'user_name', u.name,
             'member_code', u.member_code, 'phone', u.phone,
             'has_line', (l.line_user_id is not null))
           order by (d.status = 'pending') desc, d.drawn_at desc)
      from sb_lottery_draws d
      join sb_users u on u.id = d.user_id
      left join line_users l on l.sb_user_id = u.id
     where p_status is null or d.status = p_status), '[]'::jsonb));
end $function$;

-- ── ⑤ 後台:確認領取 ────────────────────────────────────────
-- 回傳 line_user_id 給呼叫端去推訊息。推播要打 LINE API,那是 Edge Function
-- 的事,資料庫不該自己對外發訊息。
create or replace function public.rpc_admin_confirm_claim(p_draw_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_admin uuid; v_row record;
begin
  if not is_admin_caller() then
    return jsonb_build_object('ok', false, 'message', '需要管理員權限。');
  end if;

  select id into v_admin from sb_users where auth_id = auth.uid();

  -- 條件式 UPDATE 搶鎖:兩個人同時按,只有一個會更新到,另一個拿到 already_claimed。
  update sb_lottery_draws
     set status = 'claimed', claimed_at = now(), claimed_by = v_admin
   where id = p_draw_id and status = 'pending';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'already_claimed',
                              'message', '這筆已經確認過了,或不存在。');
  end if;

  select d.prize_name, u.name as user_name, l.line_user_id
    into v_row
    from sb_lottery_draws d
    join sb_users u on u.id = d.user_id
    left join line_users l on l.sb_user_id = u.id
   where d.id = p_draw_id;

  return jsonb_build_object('ok', true, 'draw_id', p_draw_id,
    'prize_name', v_row.prize_name, 'user_name', v_row.user_name,
    'line_user_id', v_row.line_user_id);
end $function$;

revoke all on function public.rpc_admin_prize_claims(text) from public, anon;
revoke all on function public.rpc_admin_confirm_claim(uuid) from public, anon;
grant execute on function public.rpc_my_prizes(uuid)          to authenticated;
grant execute on function public.rpc_admin_prize_claims(text) to authenticated;
grant execute on function public.rpc_admin_confirm_claim(uuid) to authenticated;
