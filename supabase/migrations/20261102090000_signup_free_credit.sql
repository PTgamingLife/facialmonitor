-- 建帳號就先給這個月的免費檢測次數
--
-- 原本:新帳號 credits = 0,要等每天台北 00:05 那支排程跑過才拿得到 1 次。
-- 可是邀請卡片上寫的是「登入後⋯⋯並獲得 1 次免費檢測」——
-- 朋友在意願最高的那一刻點進來、登入、按檢測,然後被 analyze.js 擋下來,
-- 最長等快 24 小時。那是整條推薦鏈最糟的一個環節。
--
-- 這支做的事:把「每月贈送」那一筆提前在註冊當下發掉。
--
-- ⚠️ 關鍵是沿用同一本帳 sb_free_credit_grants,而不是另外送一次。
--    (user_id, grant_month) 是唯一鍵,所以註冊當下領掉這個月的份之後,
--    每天跑的 rpc_grant_monthly_free_credits 對這個人就是 no-op。
--    另開一條路送的話,當月會變成兩次 —— 而且要等到有人去對帳才會發現。
--
-- 期間與額度一律讀 sb_promo_free_credit,不在這裡寫死 ——
-- 活動結束或改額度時只要改那一列,兩條路一起跟著變。

create or replace function public.rpc_grant_signup_credit(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_promo public.sb_promo_free_credit%rowtype;
  v_month date;
  v_rows integer := 0;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_user');
  end if;

  select * into v_promo from public.sb_promo_free_credit where id = true;
  if not found or not v_promo.active then
    return jsonb_build_object('ok', true, 'skipped', 'inactive', 'granted', 0);
  end if;

  v_month := date_trunc('month', (now() at time zone 'Asia/Taipei'))::date;

  if v_month < v_promo.first_month or v_month > v_promo.last_month then
    return jsonb_build_object('ok', true, 'skipped', 'out_of_window', 'granted', 0);
  end if;

  -- 這個月已經領過(極少數情況:帳號合併、重複呼叫)就什麼都不做。
  insert into public.sb_free_credit_grants (user_id, grant_month, credits)
  values (p_user_id, v_month, v_promo.credits_per_month)
  on conflict (user_id, grant_month) do nothing;

  get diagnostics v_rows = row_count;   -- row_count 是整數,不是布林
  if v_rows = 0 then
    return jsonb_build_object('ok', true, 'skipped', 'already_granted', 'granted', 0);
  end if;

  update public.sb_users
     set credits = coalesce(credits, 0) + v_promo.credits_per_month
   where id = p_user_id;

  return jsonb_build_object('ok', true, 'month', v_month,
                            'granted', v_promo.credits_per_month);
end;
$function$;

-- 只有 service role 叫得到。這支會加次數,不能讓前端自己打。
revoke all on function public.rpc_grant_signup_credit(uuid) from public, anon, authenticated;

comment on function public.rpc_grant_signup_credit(uuid) is
  '註冊當下先把這個月的免費檢測次數發掉。與 rpc_grant_monthly_free_credits 共用 sb_free_credit_grants,同月只會有一次。';
