-- 群發排程:一支每日 cron 撿當天該發的,而不是每則各排一個 cron
--
-- 每則排一個 one-shot cron 的話,七則圖文就是七個 cron job,
-- 改時間要去動排程、取消要記得刪 job,而且 cron.job 會越積越多。
-- 改成資料驅動:排程時間寫在資料列上,cron 每天固定跑一次撿件。

alter table public.line_broadcasts
  add column if not exists scheduled_at timestamptz;

-- 只對「還沒送出的排程」建索引。已送出的列會越來越多,
-- 但撿件只看得到 draft,不需要為歷史資料付索引成本。
create index if not exists line_broadcasts_due_idx
  on public.line_broadcasts (scheduled_at)
  where status = 'draft' and scheduled_at is not null;

comment on column public.line_broadcasts.scheduled_at is
  '預定發送時間(UTC)。到點後由 healthbot-broadcast-daily 撿起來送;'
  '為空表示只是草稿,不會自動發送。';
