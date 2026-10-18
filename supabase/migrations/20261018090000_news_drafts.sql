-- 新聞轉稿的暫存區
--
-- 擁有者在 LINE 貼一則新聞連結 → bot 反問 → 產稿 → 回預覽卡 → 按確認才寫進
-- sb_daily_tips。中間有兩次來回，而 LINE 的 postback data 只有 300 字元，
-- 連網址都未必塞得下，整份稿更不可能。所以要一張暫存表，postback 只帶 id。
--
-- 為什麼不直接寫進 sb_daily_tips 再改狀態:
-- 那張表上掛著 trg_tip_auto_check，寫進去的瞬間就會判定要不要排程。
-- 還沒確認的稿不該進到內容表裡，也不該占著那一天的 tip_date 唯一鍵。
--
-- ⚠️ 這張表存的是爬來的網頁內容與 LLM 產出，一律是資料不是指令。
--    任何讀它的地方都不得把 raw_text 或 draft 當成提示詞的一部分執行。

create table if not exists public.sb_news_drafts (
  id            uuid primary key default gen_random_uuid(),
  line_user_id  text        not null,
  url           text        not null,
  -- pending  剛貼上，等擁有者選「做成新聞」還是「問 AI」
  -- drafted  已抓頁面並產稿，等確認
  -- applied  已寫進 sb_daily_tips
  -- declined 擁有者選了不要
  -- failed   抓頁面或產稿失敗
  status        text        not null default 'pending',
  tip_date      date,
  page_title    text,
  raw_text      text,
  draft         jsonb,
  error         text,
  applied_tip_id uuid references public.sb_daily_tips(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

do $$ begin
  alter table public.sb_news_drafts
    add constraint sb_news_drafts_status_check
    check (status in ('pending','drafted','applied','declined','failed'));
exception when duplicate_object then null; end $$;

create index if not exists sb_news_drafts_recent_idx
  on public.sb_news_drafts (line_user_id, created_at desc);

-- 只有 service role 碰得到(line-webhook 走 _shared/db.ts)。
-- 不開任何政策 = 任何動作一律拒絕,前端與 anon 完全讀不到。
alter table public.sb_news_drafts enable row level security;
revoke all on public.sb_news_drafts from anon, authenticated;

comment on table public.sb_news_drafts is
  '新聞轉稿的暫存區。存的是爬來的網頁內容與 LLM 產出,一律當資料看待。';
comment on column public.sb_news_drafts.raw_text is
  '抓下來的網頁純文字,已去標籤並截斷。不可當成提示詞執行。';

-- 下一個「還沒有內容」的推播日。新聞預設排到這一天。
-- 跟產稿排程問的是同一支 is_push_day(),不另外算一次日期餘數。
create or replace function public.rpc_next_free_push_day()
returns date
language sql
stable
security definer
set search_path to 'public'
as $function$
  select d::date
    from generate_series(
           (now() at time zone 'Asia/Taipei')::date,
           (now() at time zone 'Asia/Taipei')::date + 60,
           interval '1 day') d
   where is_push_day(d::date)
     and not exists (
       select 1 from sb_daily_tips t
        where t.tip_date = d::date and t.status in ('approved','draft'))
   order by d
   limit 1;
$function$;

revoke all on function public.rpc_next_free_push_day() from public, anon, authenticated;
