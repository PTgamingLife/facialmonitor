-- ============================================================
-- 移除 14 天健康挑戰的每日推播
--
-- 功能在 v2 拿掉了(每日挑戰改成一天一題的文字遊戲),
-- challenge-push 這支 Edge Function 也一併刪除。
--
-- ⚠️ 只停排程,不動資料。
--    sb_health_challenges / sb_health_challenge_deliveries 兩張表與
--    rpc_apply_health_challenge 都保留 —— 已經參加過的人留下的紀錄
--    之後研究要用,而且排程停掉之後它們本來就不會再被寫入。
--    真的要清是另一件事,要清之前先備份。
-- ============================================================

do $$ begin
  perform cron.unschedule('health-challenge-daily-push');
exception
  when undefined_function then null;   -- 沒裝 pg_cron 的環境(本機)
  when others then null;               -- 這個工作本來就不存在
end $$;

comment on table public.sb_health_challenges is
  '14 天健康挑戰(v2 已停用)。排程與 Edge Function 都已移除,資料保留供日後研究。';

-- ── 推播分批要記語氣 ───────────────────────────────────────
-- 三種語氣的卡片不一樣,所以分批時就要依語氣分組。
-- 語氣寫在 batch 上,重試才會用同一張卡 —— 不然重送會換一個人說話。
alter table public.sb_daily_push_batches
  add column if not exists tone text;

comment on column public.sb_daily_push_batches.tone is
  '這一批收件人的語氣(zhou / kang / xs)。null 視為 zhou。';
