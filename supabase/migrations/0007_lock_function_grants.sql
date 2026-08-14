-- ============================================================
-- 收緊函式授權(安全修正)
--
-- 背景:Postgres 建立函式時**預設把 EXECUTE 授權給 PUBLIC**。
-- 先前的 migration 只顯式 grant 了 rpc_*,卻沒有處理內部 helper,
-- 結果 award_points ——「發點的唯一途徑」、SECURITY DEFINER ——
-- 變成 anon 可以直接呼叫:
--
--     select award_points('<自己的 uuid>', 999999, 'hack');
--
-- 任何拿到 anon key(公開在前端原始碼裡)的人都能幫自己灌無限積點,
-- 整套防刷機制形同虛設。這是部署後跑 Supabase advisor 才抓到的。
--
-- 這裡做兩件事:
--   1. 內部 helper 只留給 SECURITY DEFINER 的 rpc_* 內部呼叫
--      (內部呼叫以函式擁有者身分執行,不受這些 revoke 影響)
--   2. rpc_* 逐支明確授權,不再依賴 PUBLIC 預設
--
-- 原則:「函式內有守衛」與「根本呼叫不到」是兩層不同的防線,兩層都要有。
-- ============================================================

-- ── 1. 內部 helper:外部一律不可執行 ────────────────────────
revoke execute on function award_points(uuid, integer, text, text, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function resolve_user_id(uuid)     from public, anon, authenticated;
revoke execute on function rule_points(text)         from public, anon, authenticated;
revoke execute on function is_admin_caller()         from public, anon, authenticated;
revoke execute on function is_service_role()         from public, anon, authenticated;
revoke execute on function score_of(jsonb)           from public, anon, authenticated;
revoke execute on function month_key_of(timestamptz) from public, anon, authenticated;

-- 這兩支必須保留給前端角色,不能一起收掉:
--   current_sb_user_id() 被 RLS policy 使用,而 policy 是以查詢者身分求值;
--   gen_member_code()    是 sb_users.member_code 的欄位預設值,
--                        authenticated 建立帳號時要能執行。
grant execute on function current_sb_user_id() to anon, authenticated;
grant execute on function gen_member_code()    to anon, authenticated;

-- 固定 search_path,避免搜尋路徑劫持
alter function is_service_role()          set search_path = public, pg_catalog;
alter function month_key_of(timestamptz)  set search_path = public, pg_catalog;
alter function score_of(jsonb)            set search_path = public, pg_catalog;
alter function gen_member_code()          set search_path = public, pg_catalog;

-- ── 2. rpc_*:收掉 PUBLIC 預設,逐支明確授權 ─────────────────
revoke execute on function rpc_bind_angel(text, uuid, text)                    from public, anon;
revoke execute on function rpc_redeem_credits(integer, uuid)                   from public, anon;
revoke execute on function rpc_draw_lottery(uuid)                              from public, anon;
revoke execute on function rpc_my_reward_summary(uuid)                         from public, anon;
revoke execute on function rpc_consume_credit(uuid)                            from public, anon;
revoke execute on function rpc_redeem_health_code(text, uuid)                  from public, anon;
revoke execute on function rpc_admin_set_balance(uuid, integer, integer, text) from public, anon;

-- 這兩支只給 service_role(Edge Function / 排程呼叫),登入者也不該碰
revoke execute on function rpc_confirm_referral(uuid)   from public, anon, authenticated;
revoke execute on function rpc_settle_score(uuid, text) from public, anon, authenticated;

grant execute on function
  rpc_bind_angel(text, uuid, text),
  rpc_redeem_credits(integer, uuid),
  rpc_draw_lottery(uuid),
  rpc_my_reward_summary(uuid),
  rpc_consume_credit(uuid),
  rpc_redeem_health_code(text, uuid),
  rpc_admin_set_balance(uuid, integer, integer, text)
to authenticated, service_role;

grant execute on function
  rpc_confirm_referral(uuid),
  rpc_settle_score(uuid, text)
to service_role;
