-- 抽獎轉盤:新增獎項、首檢送一次免費抽

-- ── 1. 獎項 ──────────────────────────────────────────────
-- stock 是「還有幾個」,weight 是「多容易抽到」,兩者無關。
-- 使用者給的是數量,機率由 weight 決定,這裡湊成總和 100 讓百分比一眼可讀:
--   再接再厲 60% / 紅橙飲 20% / XS 15% / 諮詢 4% / 蛋白素 1%
-- 要調機率改 weight 就好,不必動庫存。
-- name 沒有唯一鍵,on conflict 擋不住重跑,用 where not exists 才真的冪等。
insert into public.sb_lottery_prizes (name, description, stock, weight, sort, active)
select v.name, v.description, v.stock, v.weight, v.sort, true
  from (values
    ('再接再厲',      '這次沒中,下次再來', 100, 60, 10),
    ('紅橙飲',        '每次一包',           100, 20, 20),
    ('XS 提神能量飲', '每次一罐',           100, 15, 30),
    ('優質蛋白素',    '限量 1 個',            1,  1, 50)
  ) as v(name, description, stock, weight, sort)
 where not exists (
   select 1 from public.sb_lottery_prizes p where p.name = v.name);

-- 既有的「個人健康全面高級諮詢」原本 weight=100(獨佔),
-- 現在有五個獎項了,調成 4 讓總權重是 100。
update public.sb_lottery_prizes set weight = 4, sort = 40
 where name = '個人健康全面高級諮詢';

-- ── 2. 免費抽獎券 ────────────────────────────────────────
create table if not exists public.sb_lottery_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.sb_users(id) on delete cascade,
  source      text not null,
  granted_at  timestamptz not null default now(),
  used_at     timestamptz,
  draw_id     uuid references public.sb_lottery_draws(id) on delete set null
);

-- 首檢券一人一張,唯一索引就是冪等保護 —— 重跑、重送都只會有一張。
create unique index if not exists sb_lottery_tickets_one_first_scan
  on public.sb_lottery_tickets (user_id) where source = 'first_scan';

create index if not exists sb_lottery_tickets_unused_idx
  on public.sb_lottery_tickets (user_id) where used_at is null;

alter table public.sb_lottery_tickets enable row level security;
revoke all on table public.sb_lottery_tickets from public, anon, authenticated;

-- 不開任何 policy:前端要看剩幾張券是走 rpc_my_lottery_status,
-- 直接開 select 給 authenticated 只會多一條可以被繞的路。

-- ── 3. 抽獎改成「有券先用券,沒券才扣點」────────────────────
create or replace function public.rpc_draw_lottery(p_user_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid; v_cost integer; v_bal integer; v_ticket uuid;
  v_total_weight bigint; v_roll bigint; v_acc bigint := 0;
  v_prize sb_lottery_prizes%rowtype; v_draw_id uuid; v_free boolean := false;
begin
  v_me   := resolve_user_id(p_user_id);
  v_cost := rule_points('lottery_draw');

  select points into v_bal from sb_users where id = v_me for update;

  -- 先看有沒有沒用過的券。skip locked:同時連按兩下時,
  -- 第二次拿不到這張券,會走扣點或積點不足,不會一券兩用。
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

  update sb_lottery_prizes set stock = stock - 1
   where id = v_prize.id and stock > 0;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'race_lost',
                              'message', '手速差一點,再抽一次');
  end if;

  -- 免費抽不寫 ledger:記一筆 delta = 0 只會讓積點明細多出看不懂的空行。
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
end $$;

revoke execute on function public.rpc_draw_lottery(uuid) from public, anon;
grant execute on function public.rpc_draw_lottery(uuid) to authenticated, service_role;

-- ── 4. 首檢自動送券 ──────────────────────────────────────
create or replace function public._grant_first_scan_ticket(p_user_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into sb_lottery_tickets (user_id, source)
  values (p_user_id, 'first_scan')
  on conflict do nothing;
  return found;
end $$;

revoke execute on function public._grant_first_scan_ticket(uuid) from public, anon, authenticated;

-- 一支 trigger 做完檢測後該做的兩件事:認列推薦、送首檢抽獎券。
-- 分成兩支 trigger 的話,順序與例外處理會各寫一份,遲早有一份被漏改。
create or replace function public.trg_after_scan_inserted()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- 任何一步失敗都不能連帶 rollback 使用者的檢測紀錄。
  begin
    perform public._confirm_referral(new.user_id);
  exception when others then
    raise warning 'confirm referral failed for %: %', new.user_id, sqlerrm;
  end;

  begin
    perform public._grant_first_scan_ticket(new.user_id);
  exception when others then
    raise warning 'grant first scan ticket failed for %: %', new.user_id, sqlerrm;
  end;

  return null;
end $$;

drop trigger if exists confirm_referral_on_scan on public.sb_analysis_records;
drop trigger if exists after_scan_inserted on public.sb_analysis_records;
create trigger after_scan_inserted
  after insert on public.sb_analysis_records
  for each row execute function public.trg_after_scan_inserted();

-- 已經做過檢測的人補送一張,不然這批人永遠拿不到首檢券。
insert into public.sb_lottery_tickets (user_id, source)
select distinct a.user_id, 'first_scan'
  from public.sb_analysis_records a
  join public.sb_users u on u.id = a.user_id and u.merged_into is null
on conflict do nothing;

-- ── 5. 摘要帶出剩餘券數,前端才知道要不要跳轉盤 ──────────────
create or replace function public.rpc_my_lottery_status(p_user_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid;
begin
  v_me := resolve_user_id(p_user_id);
  return jsonb_build_object(
    'free_tickets', (select count(*) from sb_lottery_tickets
                      where user_id = v_me and used_at is null),
    'cost', rule_points('lottery_draw'),
    'points', (select coalesce(points, 0) from sb_users where id = v_me),
    'prizes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', id, 'name', name, 'description', description,
               'stock', stock, 'weight', weight) order by sort, id)
        from sb_lottery_prizes where active and stock > 0), '[]'::jsonb)
  );
end $$;

revoke execute on function public.rpc_my_lottery_status(uuid) from public, anon;
grant execute on function public.rpc_my_lottery_status(uuid) to authenticated, service_role;
