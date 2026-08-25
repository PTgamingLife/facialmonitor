-- 群發草稿:「有病就去看醫生⋯⋯」
--
-- 文案本來只存在正式資料庫裡,repo 完全查不到 —— 跟 challenge-push、
-- cofounder-line 是同一種毛病。對外要發出去的東西沒有版本紀錄,
-- 之後要問「當初到底發了什麼」就只能翻資料庫。
--
-- 只建草稿(status = 'draft'),不會送出任何訊息。實際發送要另外呼叫
-- line-broadcast 並明確帶 dry_run: false。

insert into public.line_broadcasts
  (title, subtitle, note, image_url, link_url, link_label, image_layout, audience, status)
select
  '有病就去看醫生⋯⋯',
  E'那還沒生病的時候呢？\n\n有點累、有點不舒服，\n但又還沒到要掛號的程度。\n\n那個「說不上來哪裡怪」的階段，\n才是最該被看見的時候。\n\n拍一張臉、一張舌頭，\n60 秒看懂你的體質正在偏向哪裡。',
  -- 免責聲明是必要的,不是客套話。健康資訊管道有人工審核與聲明,
  -- 行銷管道不能沒有 —— 兩邊標準不一致,寬的那邊就是破口。
  '本服務提供中醫養生與體質參考，不是醫療診斷，也不能取代醫師。身體不適請儘速就醫。',
  'https://ptgaminglife.github.io/facialmonitor/img/testimonials/story-2026-08-25.jpg',
  'https://liff.line.me/2011132698-FNcAIg39?p=page-challenge',
  '開始檢測',
  -- 見證截圖是 804x1230 的直式圖。走 hero 會被 20:13 的 cover 裁掉
  -- 七成以上,文字全看不到,只能用獨立的圖片訊息。
  'message',
  'all',
  'draft'
where not exists (
  select 1 from public.line_broadcasts where title = '有病就去看醫生⋯⋯'
);
