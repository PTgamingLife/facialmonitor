-- 每月免費檢測次數:排程自 2026-08-23 起 39 次全部失敗,一次都沒發出去過。
--
-- 錯誤:function pg_catalog.coalesce(integer, integer) does not exist
--
-- 這支設了 search_path TO '',於是每個呼叫都被加上 pg_catalog. 前綴。
-- 但 coalesce 不是一般函式,是 SQL 的語法結構,pg_catalog 底下沒有這個名字。
-- 其他幾個(date_trunc / now / count)是真的函式,加前綴沒事。
--
-- 順帶一提,那些前綴本來就不需要:pg_catalog 永遠隱含在 search_path 最前面,
-- 就算設成 '' 也一樣 —— 同一支裡沒加前綴的 jsonb_build_object 也解析得到。
-- 這裡只拿掉出錯的那一個,其餘不動,讓 diff 停在真正的原因上。
--
-- 影響:歡迎卡上寫著「開放期每月自動送 1 次檢測」,這句話至今沒有兌現過。
-- 修好之後當天 16:05 UTC 會補發當月份給 24 位會員(merged_into is null)。
-- 8 月與 9 月不會自動補 —— v_month 取的是當下月份,唯一鍵是 (user_id, grant_month),
-- 要補那兩個月得另外決定、另外寫。

create or replace function public.rpc_grant_monthly_free_credits()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_promo public.sb_promo_free_credit%rowtype;
  v_month date;
  v_granted integer := 0;
begin
  select * into v_promo from public.sb_promo_free_credit where id = true;
  if not found or not v_promo.active then
    return jsonb_build_object('ok', true, 'skipped', 'inactive', 'granted', 0);
  end if;

  v_month := pg_catalog.date_trunc(
    'month', (pg_catalog.now() at time zone 'Asia/Taipei')
  )::date;

  if v_month < v_promo.first_month or v_month > v_promo.last_month then
    return jsonb_build_object('ok', true, 'skipped', 'out_of_window',
                              'month', v_month, 'granted', 0);
  end if;

  -- 只發給還在使用中的會員；被合併掉的舊帳號不算一份。
  -- on conflict do nothing：這支每天跑，當月第二次以後就是整批 no-op。
  with claimed as (
    insert into public.sb_free_credit_grants (user_id, grant_month, credits)
    select u.id, v_month, v_promo.credits_per_month
      from public.sb_users u
     where u.merged_into is null
    on conflict (user_id, grant_month) do nothing
    returning user_id
  ), applied as (
    update public.sb_users s
       -- 這一行是 bug 的所在:原本是 pg_catalog.coalesce(...)
       set credits = coalesce(s.credits, 0) + v_promo.credits_per_month
      from claimed c
     where s.id = c.user_id
    returning s.id
  )
  select pg_catalog.count(*) into v_granted from applied;

  return jsonb_build_object('ok', true, 'month', v_month, 'granted', v_granted);
end;
$function$;
