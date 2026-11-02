-- 綁定小天使不再另外送檢測次數
--
-- 新政策:新加入就是 1 次,而且那一次算進當月免費額度。
--
-- 原本有兩條路會送次數給「被邀請的人」:
--   ① rpc_grant_signup_credit   註冊當下,會寫進 sb_free_credit_grants
--   ② rpc_bind_angel            綁定小天使當下,只改 credits、不記帳
-- 兩條都跑的話,從邀請連結進來的人會拿到 2 次,而卡片上寫 1 次。
--
-- 留 ①、拿掉 ② 的理由:只有 ① 會記進每月額度帳本。
-- 拿掉 ① 的話,② 送的那一次不算額度,當晚排程還是會再送一次,
-- 結果照樣是 2 次 —— 那正是要避免的。
--
-- 這支只動「送次數」那一段。綁定本身、積點、所有錯誤檢查都原樣保留。
--
-- ⚠️ sb_referrals.binding_credit_granted_at 從此不再填值。
--    已經發過的 18 筆保留原樣 —— 那是歷史,不能回頭改成沒發過。

create or replace function public.rpc_bind_angel(
  p_code text, p_user_id uuid default null::uuid, p_source text default 'web'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- binding_credit_granted_at 不再填值:這條路已經不送次數了。
  insert into sb_referrals(
    referrer_user_id, invitee_user_id, referral_code, source
  ) values (
    v_angel, v_me, p_code,
    case when p_source = 'line' then 'line' else 'web' end
  ) returning id into v_ref_id;

  v_pts := rule_points('bind_angel');
  perform award_points(v_me, v_pts, 'bind_angel', 'referral', v_ref_id,
                       month_key_of(now()), '填寫小天使');

  return jsonb_build_object(
    'ok', true,
    'points_awarded', v_pts,
    'credits_awarded', 0,
    'angel_name', (select name from sb_users where id = v_angel),
    'balance', (select points from sb_users where id = v_me),
    'credits', (select credits from sb_users where id = v_me),
    'message', format('已認定小天使，獲得 %s 點', v_pts));
end $function$;
