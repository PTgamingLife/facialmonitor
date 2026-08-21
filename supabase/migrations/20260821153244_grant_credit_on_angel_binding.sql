-- 第一次填寫小天使：原本 +10 積點，現在再贈送 1 次檢測。
-- 欄位同時是稽核紀錄與冪等保護；一筆 referral 永遠只能領一次。
alter table public.sb_referrals
  add column if not exists binding_credit_granted_at timestamptz;

comment on column public.sb_referrals.binding_credit_granted_at is
  '首次綁定小天使所贈 1 次檢測的入帳時間；非空表示已發放。';

create or replace function public.rpc_bind_angel(
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
                              'message', '你已經有小天使了，綁定後不能更改');
  end if;

  if exists (select 1 from sb_referrals
              where invitee_user_id = v_angel and referrer_user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'circular',
                              'message', '對方已經填了你當小天使，不能互填');
  end if;

  insert into sb_referrals(
    referrer_user_id, invitee_user_id, referral_code, source,
    binding_credit_granted_at
  ) values (
    v_angel, v_me, p_code,
    case when p_source = 'line' then 'line' else 'web' end,
    now()
  ) returning id into v_ref_id;

  v_pts := rule_points('bind_angel');
  perform award_points(v_me, v_pts, 'bind_angel', 'referral', v_ref_id,
                       month_key_of(now()), '填寫小天使');

  update sb_users
     set credits = coalesce(credits, 0) + 1
   where id = v_me;

  return jsonb_build_object(
    'ok', true,
    'points_awarded', v_pts,
    'credits_awarded', 1,
    'angel_name', (select name from sb_users where id = v_angel),
    'balance', (select points from sb_users where id = v_me),
    'credits', (select credits from sb_users where id = v_me),
    'message', format('已認定小天使，獲得 %s 點及 1 次免費檢測', v_pts));
end $$;

revoke execute on function public.rpc_bind_angel(text, uuid, text) from public, anon;
grant execute on function public.rpc_bind_angel(text, uuid, text) to authenticated, service_role;

-- 上線前唯一既有綁定也適用新規則。以時間欄位鎖住，migration 重跑不會重複發放。
with grants as (
  update public.sb_referrals
     set binding_credit_granted_at = now()
   where binding_credit_granted_at is null
  returning invitee_user_id
), totals as (
  select invitee_user_id, count(*)::integer as credits_to_add
    from grants
   group by invitee_user_id
)
update public.sb_users u
   set credits = coalesce(u.credits, 0) + totals.credits_to_add
  from totals
 where u.id = totals.invitee_user_id;
