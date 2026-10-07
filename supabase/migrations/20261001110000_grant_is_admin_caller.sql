-- RLS 政策的條件式是以「呼叫者」的身分執行的,所以政策裡用到的函式,
-- 呼叫者必須有 EXECUTE 權限。is_admin_caller() 原本只授權給 postgres 與
-- service_role,拿來寫 sb_users 的管理員讀取政策會讓每一個登入者
-- 在讀自己資料時直接撞上 permission denied。
--
-- 為什麼不改用內嵌子查詢(像 sb_daily_tips 的 p_tips_admin_read 那樣):
-- 那條政策掛在別張表上,子查詢讀 sb_users 沒問題。但 sb_users 自己的政策
-- 裡再查一次 sb_users 會遞迴,Postgres 會直接報錯。掛在自己身上就只能靠
-- SECURITY DEFINER 函式繞過 RLS。
--
-- 授權本身不擴大任何人看得到的東西:這支只回報「呼叫者自己是不是管理員」,
-- 不洩漏別人的任何資料,而且是 SECURITY DEFINER + 釘住 search_path。

grant execute on function public.is_admin_caller() to authenticated;
