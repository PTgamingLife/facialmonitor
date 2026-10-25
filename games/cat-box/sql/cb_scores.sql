-- 貓咪躲紙箱 排行榜(尚未執行,需經同意才套用到 Supabase)
-- 表本身不開放直接讀寫,只能透過下面兩個 RPC

create table if not exists public.cb_scores (
  cb_user_id    text primary key,
  cb_name       text not null default '玩家',
  cb_avatar     text,
  cb_stars      int  not null default 0 check (cb_stars between 0 and 30),
  cb_cleared    int  not null default 0 check (cb_cleared between 0 and 10),
  cb_time_ms    int  not null default 0 check (cb_time_ms >= 0),
  cb_updated_at timestamptz not null default now()
);
alter table public.cb_scores enable row level security;

-- 上傳成績:只在「星數多 > 過關數多 > 總時間短」更好時才覆蓋
create or replace function public.cb_submit_score(
  p_user_id text, p_name text, p_avatar text, p_stars int, p_cleared int, p_time_ms int
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is null or length(p_user_id) not between 5 and 64 then raise exception 'cb: bad user'; end if;
  if p_stars not between 0 and 30 or p_cleared not between 0 and 10
     or p_stars > p_cleared * 3 or p_time_ms < p_cleared * 1500 then
    raise exception 'cb: bad score';
  end if;
  insert into cb_scores (cb_user_id, cb_name, cb_avatar, cb_stars, cb_cleared, cb_time_ms)
  values (p_user_id, left(coalesce(p_name, '玩家'), 30), left(p_avatar, 400), p_stars, p_cleared, p_time_ms)
  on conflict (cb_user_id) do update set
    cb_name = excluded.cb_name, cb_avatar = excluded.cb_avatar, cb_stars = excluded.cb_stars,
    cb_cleared = excluded.cb_cleared, cb_time_ms = excluded.cb_time_ms, cb_updated_at = now()
  where (excluded.cb_stars, excluded.cb_cleared, -excluded.cb_time_ms)
      > (cb_scores.cb_stars, cb_scores.cb_cleared, -cb_scores.cb_time_ms);
end $$;

-- 前十名(不回傳 user_id)
create or replace function public.cb_get_top10()
returns table (cb_name text, cb_avatar text, cb_stars int, cb_cleared int, cb_time_ms int)
language sql security definer set search_path = public stable as $$
  select s.cb_name, s.cb_avatar, s.cb_stars, s.cb_cleared, s.cb_time_ms
  from cb_scores s
  order by s.cb_stars desc, s.cb_cleared desc, s.cb_time_ms asc
  limit 10;
$$;

revoke all on function public.cb_submit_score(text, text, text, int, int, int) from public;
revoke all on function public.cb_get_top10() from public;
grant execute on function public.cb_submit_score(text, text, text, int, int, int) to anon, authenticated;
grant execute on function public.cb_get_top10() to anon, authenticated;
