-- 群發卡片:可自訂按鈕文字、可把圖片改成獨立的圖片訊息

-- 按鈕文字原本寫死「立即報名」。不是每張卡都在招生 ——
-- 見證分享、活動通知、健康資訊各有各的行動,用同一句話會很怪。
alter table public.line_broadcasts
  add column if not exists link_label text;

-- hero    圖片當卡片頂圖(現況)。infoCard 的 hero 固定 20:13 且 cover,
--         直式圖塞進去只會看到中間一條,文字會被裁掉。
-- message 圖片改成獨立的 LINE 圖片訊息,接在卡片前面。圖片訊息會保留
--         原始比例,直式截圖只能走這條。
alter table public.line_broadcasts
  add column if not exists image_layout text not null default 'hero';

do $$ begin
  alter table public.line_broadcasts
    add constraint line_broadcasts_image_layout_check
    check (image_layout in ('hero', 'message'));
exception when duplicate_object then null; end $$;

comment on column public.line_broadcasts.link_label is
  '主要按鈕的文字;留空則用預設「立即報名」。';
comment on column public.line_broadcasts.image_layout is
  'hero = 卡片頂圖(20:13 裁切);message = 獨立圖片訊息(保留原比例)。';
