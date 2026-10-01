-- 推播從隔日一次改成三日一次。
--
-- 「哪一天要發」只在 is_push_day() 定義一次,產稿(rpc_push_days)、推播
-- (rpc_claim_daily_tip_push)、存量(rpc_tip_stock)、網頁(rpc_today_challenge)
-- 全部問它,所以改這一支就夠,不必動 cron —— cron 照樣天天叫,由日期本身決定發不發。
--
-- 錨點從 2026-09-03 換成 2026-10-01,不是沿用舊的:
-- (2026-10-01 - 2026-09-03) = 28,28 mod 3 = 1,沿用舊錨點的話今天就不是推播日,
-- 但今天早上已經發出去了(sb_daily_pushes 有 2026-10-01 sent)。
-- 換成今天當錨點,今天仍是推播日,接下來是 10/04、10/07、10/10…
--
-- 十月的推播日從 16 天降到 11 天。套用時另外把 5 則已核准但還沒發的內容
-- 搬到新的推播日上(10/03→10/04、10/05→10/07、10/07→10/10、10/09→10/13、
-- 10/11→10/16),不搬的話它們會卡在不再發送的日期上,安靜地永遠不會送出去。
-- 那是一次性的資料搬移,不寫進 migration —— 對新的資料庫沒有意義。
--
-- 確認過沒有索引或檢查約束建在這支 IMMUTABLE 函式上,改定義不會留下壞掉的索引。

create or replace function public.is_push_day(p_day date)
returns boolean
language sql
immutable parallel safe
set search_path to ''
as $function$
  select pg_catalog.mod(p_day - date '2026-10-01', 3) = 0
$function$;

comment on function public.is_push_day(date) is
  '三日一次,自 2026-10-01 起。發送日只在這裡定義一次 —— 產稿、推播、存量、'
  '網頁全部問這一支。各自算一次日期餘數的話,遲早有一邊算錯,'
  '而且錯了只表現成「今天怎麼沒收到」。';
