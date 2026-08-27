-- 圖文排程:8/28 ~ 9/06 共七則
--
-- 刻意排在「沒有健康資訊」的日子(8/30、9/01、9/03~9/06 那批被退稿的),
-- 一次解決兩件事:不跟每天 08:00 的健康資訊推播撞在一起,順便補滿斷檔。
-- 8/28 是例外 —— 當天有健康資訊,兩則會隔一小時,這是使用者確認過的決定。
--
-- 時間存 UTC。台北 09:00 = 01:00 UTC。

do $$
declare
  v_liff  text := 'https://liff.line.me/2011132698-FNcAIg39';
  v_note  text := '本服務提供中醫養生與體質參考，不是醫療診斷，也不能取代醫師。身體不適請儘速就醫。';
begin

  -- 8/28 已經存在(先前建的草稿),這裡只補排程時間。
  update public.line_broadcasts
     set scheduled_at = timestamptz '2026-08-28 01:00:00+00'
   where title = '有病就去看醫生⋯⋯' and status = 'draft';

  insert into public.line_broadcasts
    (title, subtitle, note, link_url, link_label, image_layout, audience, status, scheduled_at)
  select v.title, v.subtitle, v_note, v.link_url, v.link_label, 'hero', 'all', 'draft', v.at
    from (values

      ('你有 1 次免費檢測還沒用',
       E'開放期間，每個月都會自動送你 1 次面舌診檢測，一路送到 2027 年 1 月。\n\n次數會留著，但留著不會變成健康。\n\n拍一張臉、一張舌頭，60 秒。',
       v_liff || '?p=page-challenge', '用掉這次',
       timestamptz '2026-08-30 01:00:00+00'),

      ('你有一次抽獎機會還沒用',
       E'完成第一次面舌診，就送一次抽獎。\n\n獎品有紅橙飲、XS 提神能量飲、優質蛋白素，還有個人健康全面高級諮詢。\n\n每抽必中，不會槓龜。',
       v_liff || '?p=wheel', '去轉盤抽',
       timestamptz '2026-09-01 01:00:00+00'),

      ('為什麼是臉和舌頭？',
       E'中醫看診第一件事就是望診。\n\n舌苔的厚薄、舌色的深淺、面色的明暗，反映的是水分代謝、氣血運行與臟腑狀態。\n\n這些變化，在你自己感覺到不舒服之前就已經開始了。',
       v_liff || '?p=page-challenge', '看看我的',
       timestamptz '2026-09-03 01:00:00+00'),

      ('你上一次好好看自己的身體，是什麼時候？',
       E'大部分人是等到不舒服才處理。\n\n但身體的變化是連續的 —— 今天的疲倦、上個月的睡不好、去年悄悄上升的體重，都是同一條線上的點。\n\n有紀錄，才看得出方向；看得出方向，才來得及轉彎。',
       v_liff || '?p=page-challenge', '開始記錄',
       timestamptz '2026-09-04 01:00:00+00'),

      ('一個人容易放棄，兩個人比較走得下去',
       E'把你的專屬網址傳給朋友。\n\n他完成第一次檢測，你得 30 點，他也拿到 1 次免費檢測。\n\n積點可以換檢測次數，也可以抽獎。',
       v_liff || '?p=share', '分享給朋友',
       timestamptz '2026-09-05 01:00:00+00'),

      ('舌頭上的那層苔，其實每天都在變',
       E'早上起床時舌苔最厚，那是一夜代謝留下的痕跡。\n\n刷牙前先看一眼：偏白偏厚，常跟前一天吃太油、太甜或睡太晚有關；偏黃偏乾，多半是水喝得太少。\n\n這是最容易養成的自我觀察習慣，不用任何工具。',
       v_liff || '?p=page-challenge', '看懂我的舌象',
       timestamptz '2026-09-06 01:00:00+00')

    ) as v(title, subtitle, link_url, link_label, at)
   where not exists (
     select 1 from public.line_broadcasts b where b.title = v.title
   );

end $$;
