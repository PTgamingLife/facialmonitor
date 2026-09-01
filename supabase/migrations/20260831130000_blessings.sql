-- ============================================================
-- 身邊的祝福
--
-- 取代圖文選單原本的「剩餘次數」那一格。祝福由每週兩次的祝福關卡產生
-- (週三、週六),寫的入口在每日挑戰裡,這裡只負責存放與呈現。
--
-- 兩個刻意的取捨:
--   1. 牆上顯示「寫的人」,不顯示「收到的人」。
--      顯示收件者會變成人氣比較,收到少的人反而受傷。
--   2. 實名公開要明確同意(is_public)。不同意仍然算完成、仍然給點,
--      只是不進牆 —— 不能用積點逼人公開自己的名字。
-- ============================================================

create table if not exists public.sb_blessings (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null references public.sb_users(id) on delete cascade,
  -- null = 隨機投遞。指定對象只用來推播通知,不會顯示在牆上。
  target_id    uuid references public.sb_users(id) on delete set null,
  text         text not null,
  is_public    boolean not null default false,
  status       text not null default 'visible'
               check (status in ('visible', 'withdrawn', 'blocked')),
  blessed_date date not null,
  risk_flags   jsonb not null default '[]'::jsonb,
  notified_at  timestamptz,
  withdrawn_at timestamptz,
  blocked_at   timestamptz,
  blocked_by   uuid references public.sb_users(id),
  block_reason text,
  created_at   timestamptz not null default now(),

  -- 一天一則。連點兩下、重送同一個請求都會撞到這條,而不是變成兩則。
  constraint uniq_blessing_per_day unique (author_id, blessed_date),
  constraint chk_blessing_len  check (char_length(text) between 20 and 60),
  constraint chk_blessing_self check (target_id is null or target_id <> author_id)
);

comment on table public.sb_blessings is
  '祝福池。牆上只抽 is_public 且 status = visible 的,並且只顯示作者名字。';

create index if not exists sb_blessings_wall_idx
  on public.sb_blessings (created_at desc)
  where is_public and status = 'visible';
create index if not exists sb_blessings_author_idx
  on public.sb_blessings (author_id, blessed_date desc);
create index if not exists sb_blessings_target_idx
  on public.sb_blessings (target_id) where notified_at is null;

alter table public.sb_blessings enable row level security;

-- 前端一律走 RPC 讀牆(要 join 作者名字,而 sb_users 只開放自己那列)。
-- 這條 policy 只讓人看自己寫過的,方便日後做「我的祝福」清單。
drop policy if exists p_blessings_own on public.sb_blessings;
create policy p_blessings_own on public.sb_blessings
  for select to authenticated using (author_id = current_sb_user_id());

-- ── 內容檢查 ───────────────────────────────────────────────
-- 祝福是使用者寫的,擋的東西跟每日挑戰不一樣:
-- 那邊擋的是 AI 產出的療效宣稱,這邊還要擋人身攻擊與聯絡方式外流。
create or replace function public.blessing_risk(p_text text)
returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  v_flags text[] := '{}';
  v_word  text;
  v_banned text[] := array[
    '治療', '療效', '根治', '痊癒', '治癒', '藥效', '偏方',
    '保證有效', '包治', '抗癌', '降血壓', '降血糖'
  ];
begin
  foreach v_word in array v_banned loop
    if position(v_word in p_text) > 0 then
      v_flags := v_flags || ('medical_claim:' || v_word);
    end if;
  end loop;

  -- 網址與長串數字:祝福不需要這些,出現通常是廣告或個資
  if p_text ~* '(https?://|www\.|\.com|\.tw/)' then
    v_flags := v_flags || 'contains_link'::text;
  end if;
  if p_text ~ '[0-9]{8,}' then
    v_flags := v_flags || 'contains_number'::text;
  end if;
  if p_text ~* '(line\s*id|加賴|加line|微信|whatsapp)' then
    v_flags := v_flags || 'contains_contact'::text;
  end if;

  return to_jsonb(v_flags);
end $$;

-- ── 送出祝福 ───────────────────────────────────────────────
create or replace function public.rpc_submit_blessing(
  p_text text, p_target_id uuid default null, p_public boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := resolve_user_id(null);
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_txt   text := trim(coalesce(p_text, ''));
  v_flags jsonb;
  v_id    uuid;
  v_done  jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'message', '請先登入。');
  end if;

  if char_length(v_txt) < 20 or char_length(v_txt) > 60 then
    return jsonb_build_object('ok', false, 'error', 'bad_length',
                              'message', '祝福請寫 20 到 60 個字。');
  end if;

  -- 退回不影響今天的完成 —— 使用者可以改了再送
  v_flags := blessing_risk(v_txt);
  if jsonb_array_length(v_flags) > 0 then
    return jsonb_build_object('ok', false, 'error', 'blocked', 'flags', v_flags,
      'message', case
        when v_flags::text like '%medical_claim%'
          then '祝福裡不要提到治療或療效,換個說法再送一次就好。'
        when v_flags::text like '%contains_link%' or v_flags::text like '%contains_contact%'
          then '祝福裡不要放網址或聯絡方式喔。'
        else '這句需要調整一下,換個說法再送一次。'
      end);
  end if;

  -- 指定對象必須真的跟自己有推薦關係。不擋的話等於開放對任意 user id 發訊息。
  if p_target_id is not null and not exists (
    select 1 from sb_referrals
     where status = 'confirmed'
       and ((referrer_user_id = v_me and invitee_user_id = p_target_id)
         or (invitee_user_id = v_me and referrer_user_id = p_target_id))
  ) then
    return jsonb_build_object('ok', false, 'error', 'bad_target',
                              'message', '只能指定自己的小天使或推薦過的人。');
  end if;

  begin
    insert into sb_blessings (author_id, target_id, text, is_public, blessed_date)
    values (v_me, p_target_id, v_txt, coalesce(p_public, false), v_today)
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_sent',
                              'message', '今天已經送出過一則祝福了。');
  end;

  v_done := mark_challenge_done(v_me);

  return jsonb_build_object('ok', true, 'blessing_id', v_id,
    'is_public',    coalesce(p_public, false),
    'notify_target', p_target_id is not null,   -- Edge 看到這個才推播給對方
    'first_time',   v_done->'first_time',
    'points_added', v_done->'points_added',
    'balance',      v_done->'balance',
    'week_done',    v_done->'week_done');
end $$;

-- ── 讀牆 ───────────────────────────────────────────────────
-- 隨機抽,不是照時間排:照時間排的話早上打開永遠是同幾則,
-- 「換一批」也就沒有意義了。
create or replace function public.rpc_random_blessings(p_limit integer default 6)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid;
  v_n  integer := least(greatest(coalesce(p_limit, 6), 1), 20);
begin
  begin
    v_me := resolve_user_id(null);
  exception when others then
    v_me := null;                        -- 沒登入也讀得到牆,只是沒有「下架」按鈕
  end;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',          b.id,
             'text',        b.text,
             'author_name', coalesce(nullif(trim(u.name), ''), '匿名夥伴'),
             'created_at',  b.created_at,
             'mine',        b.author_id = v_me))
      from (
        select * from sb_blessings
         where is_public and status = 'visible'
         order by random() limit v_n
      ) b
      join sb_users u on u.id = b.author_id
  ), '[]'::jsonb);
end $$;

-- ── 下架 ───────────────────────────────────────────────────
-- 只能下架自己的。發送者隨時可以收回,收回後不再被抽出。
create or replace function public.rpc_withdraw_blessing(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := resolve_user_id(null);
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'message', '請先登入。');
  end if;

  update sb_blessings
     set status = 'withdrawn', withdrawn_at = now()
   where id = p_id and author_id = v_me and status = 'visible';

  if not found then
    return jsonb_build_object('ok', false, 'message', '找不到這則祝福,或它已經不在牆上了。');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── 後台下架(檢舉處理) ─────────────────────────────────────
-- 祝福是使用者寫的內容,自動檢查擋不住所有情況,這一支保留人工。
create or replace function public.rpc_admin_block_blessing(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := current_sb_user_id();
begin
  if not coalesce((select is_admin from sb_users where id = v_me), false) then
    raise exception 'unauthorized';
  end if;

  update sb_blessings
     set status = 'blocked', blocked_at = now(), blocked_by = v_me,
         block_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_id and status <> 'blocked';

  if not found then
    return jsonb_build_object('ok', false, 'message', '找不到這則,或已經下架過了。');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── 授權 ───────────────────────────────────────────────────
revoke execute on function public.rpc_submit_blessing(text, uuid, boolean) from public, anon;
revoke execute on function public.rpc_random_blessings(integer)            from public;
revoke execute on function public.rpc_withdraw_blessing(uuid)              from public, anon;
revoke execute on function public.rpc_admin_block_blessing(uuid, text)     from public, anon;

grant execute on function public.rpc_submit_blessing(text, uuid, boolean) to authenticated, service_role;
grant execute on function public.rpc_random_blessings(integer)            to authenticated, service_role;
grant execute on function public.rpc_withdraw_blessing(uuid)              to authenticated, service_role;
grant execute on function public.rpc_admin_block_blessing(uuid, text)     to authenticated, service_role;

-- ── 後台:內容行事曆用的兩支 ─────────────────────────────────
-- 管理者不再逐則審核,但仍要能「把某一天撤下來」與「看祝福並下架」。
-- sb_daily_tips 的寫入權限只在 service_role,所以要走 RPC。
create or replace function public.rpc_admin_withdraw_tip(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := current_sb_user_id();
begin
  if not coalesce((select is_admin from sb_users where id = v_me), false) then
    raise exception 'unauthorized';
  end if;

  -- 用 active = false 而不是刪除:被撤下的那天要留著,
  -- 存量提醒才講得出「這天為什麼沒有內容」。
  update sb_daily_tips
     set active = false, review_note = '管理者手動撤下', approved_by = v_me
   where id = p_id and active;

  if not found then
    return jsonb_build_object('ok', false, 'message', '找不到這一天,或它已經撤下了。');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.rpc_admin_list_blessings(
  p_status text default 'visible', p_limit integer default 50
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := current_sb_user_id();
begin
  if not coalesce((select is_admin from sb_users where id = v_me), false) then
    raise exception 'unauthorized';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', b.id, 'text', b.text, 'status', b.status,
             'is_public', b.is_public, 'blessed_date', b.blessed_date,
             'created_at', b.created_at,
             'author_name', coalesce(nullif(trim(u.name), ''), '(無名字)'))
             order by b.created_at desc)
      from sb_blessings b
      join sb_users u on u.id = b.author_id
     where b.status = coalesce(p_status, 'visible')
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ), '[]'::jsonb);
end $$;

revoke execute on function public.rpc_admin_withdraw_tip(uuid)              from public, anon;
revoke execute on function public.rpc_admin_list_blessings(text, integer)   from public, anon;
grant  execute on function public.rpc_admin_withdraw_tip(uuid)            to authenticated, service_role;
grant  execute on function public.rpc_admin_list_blessings(text, integer) to authenticated, service_role;
