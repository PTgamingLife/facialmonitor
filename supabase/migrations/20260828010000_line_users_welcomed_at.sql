-- 綁定完成的歡迎訊息:一人只送一次
--
-- liff-auth 在綁定當下往 OA 推一則歡迎訊息。使用者重新整理、重新登入、
-- 多開分頁都會再打一次 liff-auth,沒有鎖就會連送好幾則 —— 而 LINE push
-- 是按人計費的,洗版又花錢。
--
-- 作法是「條件式 UPDATE 搶鎖」:PATCH ... where welcomed_at is null,
-- 搶到那一列的人才送。同時兩個請求進來只會有一個搶到。

alter table public.line_users
  add column if not exists welcomed_at timestamptz;

comment on column public.line_users.welcomed_at is
  '綁定完成歡迎訊息的送出時間;非空表示已送過,不會再送。';

-- 既有好友都已經收過加好友的歡迎訊息了,補上時間戳避免下次登入被補送一則。
update public.line_users
   set welcomed_at = coalesce(followed_at, created_at, now())
 where welcomed_at is null;
