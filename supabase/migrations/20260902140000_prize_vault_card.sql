-- 「你抽中的獎品」卡片:兌換/抽獎的第一張

-- ── 「再接再厲」不是獎品 ────────────────────────────────────
-- 它是轉盤上沒中的那一格,但在資料上跟其他獎項長得一模一樣,
-- 於是每個地方都要自己比對名字:doDraw、reward.js 各一份,
-- game.html 的獎品保留區忘了比,結果沒中的人也看得到「再接再厲・待領取」。
--
-- 名字是會被改的(換季活動改成「銘謝惠顧」就全壞了),用欄位講清楚才對。
alter table public.sb_lottery_prizes
  add column if not exists is_win boolean not null default true;

comment on column public.sb_lottery_prizes.is_win is
  'false = 轉盤上「沒中」的那一格。不進獎品保留區,不顯示兌獎按鈕。';

update public.sb_lottery_prizes set is_win = false where name = '再接再厲';

-- ── 獎品保留區:只留真的中獎的 ──────────────────────────────
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

  -- prize_id 可能是 null(獎項被刪掉了),那時退回比對名字 ——
  -- 舊資料還在,不能因為查不到獎項就把沒中的那些放進保留區。
  return jsonb_build_object(
    'ok', true,
    'pending', (select count(*)
                  from sb_lottery_draws d
                  left join sb_lottery_prizes p on p.id = d.prize_id
                 where d.user_id = v_me and d.status = 'pending'
                   and coalesce(p.is_win, d.prize_name <> '再接再厲')),
    'prizes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'name', d.prize_name, 'image', p.image_url,
               'status', d.status, 'drawn_at', d.drawn_at, 'claimed_at', d.claimed_at)
             order by d.drawn_at desc)
        from sb_lottery_draws d
        left join sb_lottery_prizes p on p.id = d.prize_id
       where d.user_id = v_me
         and coalesce(p.is_win, d.prize_name <> '再接再厲')), '[]'::jsonb)
  );
end $function$;

-- ── 抽獎:直接回「這次算不算中」 ────────────────────────────
-- 呼叫端不必再比對名字。其餘邏輯與上一版相同。
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

  -- 權重 = 剩餘數量。轉盤上一個格子就是一份獎品。
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
    'won', v_prize.is_win,
    'points_spent', v_cost, 'used_free_ticket', v_free,
    'free_tickets', (select count(*) from sb_lottery_tickets
                      where user_id = v_me and used_at is null),
    'balance', (select points from sb_users where id = v_me));
end $function$;

-- create or replace 會保留原有的 ACL,這裡寫出來只是把權限講清楚:
-- 帶 p_user_id 呼叫要 service_role 才有效(resolve_user_id 會擋),
-- 登入者呼叫一律只拿得到自己的。
grant execute on function public.rpc_my_prizes(uuid)     to authenticated, service_role;
grant execute on function public.rpc_draw_lottery(uuid)  to authenticated, service_role;
