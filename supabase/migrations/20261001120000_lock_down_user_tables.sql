-- 收緊 sb_users / sb_analysis_records / sb_health_codes 的 RLS
--
-- 這三張表原本都只有一條政策:ALL / PUBLIC / USING (true) / WITH CHECK (true),
-- 而 anon 與 authenticated 都握有 SELECT、INSERT、DELETE 的表層權限。
-- anon key 本來就印在每一頁裡(設計如此),所以實際上等於:
--
--   · 任何人都讀得到全部會員的姓名、電話、email、積點
--   · 任何人都讀得到全部人的面舌診報告(健康資料)
--   · 任何人都刪得掉任何一列
--   · 兌換碼整張表可讀 —— 等於免費次數可以自己兌
--
-- 還有一條提權路徑:is_admin_caller() 讀的就是 sb_users.is_admin。
-- 刪掉自己那列、再插一列 is_admin = true,就通過管理員檢查,
-- 於是領獎名單(含其他會員姓名電話)那道鎖形同虛設。
--
-- ── 為什麼可以這樣鎖 ────────────────────────────────────────
-- 盤過全部前端路徑(js/*.js、index.html、scan.html、share.html、game.html):
--   sb_users            auth.js 讀自己那列、首次登入插入自己那列;
--                       features.js 讀自己那列;admin.js 讀全部;
--                       scan.html / share.html 讀自己那列;
--                       排行榜讀全部人的 name/coins/total_used/streak ← 唯一的跨人讀取
--   sb_analysis_records report.js 只讀自己的(eq user_id),前端完全不寫
--   sb_health_codes     只有 admin.js 讀/寫
-- 前端對這三張表沒有任何 UPDATE 或 DELETE。
--
-- 後端全部走 service role(_shared/db.ts 讀 SUPABASE_SERVICE_ROLE_KEY),
-- analyze 那支也是(createClient 用 SERVICE_ROLE_KEY 寫檢測紀錄),
-- service role 不受 RLS 影響,所以 webhook、結算、推播、檢測都不會被這次改動擋到。
--
-- 跨人讀取的排行榜改走 rpc_leaderboard() —— 只回那四個欄位,
-- 不再讓前端為了排行榜而擁有整張 sb_users 的讀取權。
--
-- RLS 的預設是「沒有對應政策的動作一律拒絕」,所以不替 UPDATE / DELETE 寫政策
-- 就等於關掉它們;另外再 revoke 一次表層權限當第二道防線。
--
-- current_sb_user_id() 與 is_admin_caller() 都是 SECURITY DEFINER,
-- 在政策裡呼叫不會回頭觸發 sb_users 自己的 RLS,不會遞迴。
-- is_admin_caller() 原本沒授權給 authenticated,政策會 permission denied ——
-- 前一支 migration (20261001110000) 已補上 grant,這支依賴它。

-- ── sb_users ────────────────────────────────────────────────
drop policy if exists allow_all_sb_users on public.sb_users;

create policy p_users_self_read on public.sb_users
  for select to authenticated
  using (auth_id = auth.uid());

create policy p_users_admin_read on public.sb_users
  for select to authenticated
  using (public.is_admin_caller());

-- 首次登入要能建立自己那一列(auth.js)。
-- 擋住 is_admin:沒有這個條件,任何人插一列 is_admin = true 就成了管理員。
create policy p_users_self_insert on public.sb_users
  for insert to authenticated
  with check (auth_id = auth.uid() and coalesce(is_admin, false) = false);

revoke all on public.sb_users from anon;
revoke delete, truncate, references, trigger on public.sb_users from authenticated;

-- ── sb_analysis_records ─────────────────────────────────────
drop policy if exists allow_all_sb_records on public.sb_analysis_records;

create policy p_records_own on public.sb_analysis_records
  for select to authenticated
  using (user_id = public.current_sb_user_id());

create policy p_records_admin_read on public.sb_analysis_records
  for select to authenticated
  using (public.is_admin_caller());

revoke all on public.sb_analysis_records from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.sb_analysis_records from authenticated;

-- ── sb_health_codes ─────────────────────────────────────────
-- 兌換碼。整張表可讀等於免費次數可以自己兌,只有後台需要碰它。
drop policy if exists allow_all_sb_codes on public.sb_health_codes;

create policy p_codes_admin on public.sb_health_codes
  for all to authenticated
  using (public.is_admin_caller())
  with check (public.is_admin_caller());

revoke all on public.sb_health_codes from anon;

-- ── 排行榜:唯一需要跨人讀取的地方,改走 RPC ──────────────────
-- 只回四個欄位。原本前端是直接 select 整張 sb_users 再取四欄 ——
-- 那等於為了排行榜把姓名、電話、email、積點一起開出去。
create or replace function public.rpc_leaderboard(p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'name',       t.name,
           'coins',      t.coins,
           'total_used', t.total_used,
           'streak',     t.streak) order by t.coins desc), '[]'::jsonb)
    from (
      select name,
             coalesce(coins, 0)      as coins,
             coalesce(total_used, 0) as total_used,
             coalesce(streak, 0)     as streak
        from sb_users
       where merged_into is null and name is not null
       order by coalesce(coins, 0) desc
       limit least(greatest(coalesce(p_limit, 20), 1), 50)
    ) t;
$function$;

revoke all on function public.rpc_leaderboard(integer) from public, anon;
grant execute on function public.rpc_leaderboard(integer) to authenticated;

comment on function public.rpc_leaderboard(integer) is
  '排行榜前 N 名,只回 name / coins / total_used / streak。'
  '存在的理由:前端為了排行榜而直接 select sb_users,'
  '等於連姓名電話 email 一起開出去。';
