-- ============================================================
-- 帳本的 ref_type 白名單補上 'checkin'
--
-- 0009 的 rpc_daily_checkin 用 ref_type = 'checkin' 寫帳本,但 0002 建表時
-- 的 check 只放行 referral/score/lottery/redeem/admin,於是每次打卡都在
-- award_points 那一步撞 23514 —— 使用者看到的是「打卡失敗,請稍後再試」。
--
-- 整個 RPC 在同一個交易裡,所以 sb_checkins 那筆搶格也跟著 rollback,
-- 沒有留下半套資料;修好之後直接可以打,不必清任何東西。
-- ============================================================

alter table sb_point_ledger drop constraint if exists sb_point_ledger_ref_type_check;

alter table sb_point_ledger add constraint sb_point_ledger_ref_type_check
  check (ref_type in ('referral','score','lottery','redeem','admin','checkin'));
