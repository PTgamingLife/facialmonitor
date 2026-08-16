-- ============================================================
-- LINE 登入 + 舊 Google 帳號資料轉移
--
-- 網頁改成用 LINE 登入(LIFF),Google 只留一條路:把舊帳號的資料
-- 搬到新的 LINE 帳號。搬完舊帳號就封存,不再是入口。
--
-- 轉移為什麼要用「票券」而不是直接傳目標 user_id:
--   轉移的流程一定會換 session —— 先用 LINE 登入拿到新帳號,再跳去 Google
--   登入舊帳號,兩邊不可能同時在線。如果讓瀏覽器自己說「請搬到 X」,
--   任何人都能把自己的資料塞進別人的帳號裡。
--   改成「新帳號在自己還登入時先開一張票」,票裡才寫得了目標,
--   舊帳號只能拿票來兌換 —— 目標無法偽造。
-- ============================================================

-- ── 1. sb_users 欄位 ────────────────────────────────────────
alter table sb_users add column if not exists line_user_id text;
alter table sb_users add column if not exists merged_into   uuid references sb_users(id);
alter table sb_users add column if not exists merged_at     timestamptz;

-- 一個 LINE 帳號只能對到一個會員
create unique index if not exists sb_users_line_user_id_key
  on sb_users (line_user_id) where line_user_id is not null;

comment on column sb_users.line_user_id is 'LINE 的 userId,LIFF 登入用。與 line_users.line_user_id 同一組值。';
comment on column sb_users.merged_into   is '這個帳號已經被合併到哪個帳號;非 null 代表已封存,不該再當入口。';

-- ── 2. 轉移票券 ─────────────────────────────────────────────
create table if not exists sb_merge_tickets (
  ticket      text primary key,
  target_user_id uuid not null references sb_users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  redeemed_at timestamptz,
  source_user_id uuid references sb_users(id)
);

create index if not exists sb_merge_tickets_target_idx on sb_merge_tickets (target_user_id);

alter table sb_merge_tickets enable row level security;
-- 沒有任何 policy:票券只能透過下面兩支 RPC 存取,前端讀不到別人的票

-- ── 3. 開票(新帳號登入中時呼叫) ─────────────────────────────
create or replace function rpc_issue_merge_ticket()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me     uuid := current_sb_user_id();
  v_ticket text;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'message', '請先登入。');
  end if;

  if exists (select 1 from sb_users where id = v_me and merged_into is not null) then
    return jsonb_build_object('ok', false, 'message', '這個帳號已經被合併過了。');
  end if;

  -- 同一個帳號重開票就把舊的作廢,避免票券越積越多
  delete from sb_merge_tickets
   where target_user_id = v_me and redeemed_at is null;

  v_ticket := encode(gen_random_bytes(24), 'hex');

  insert into sb_merge_tickets (ticket, target_user_id, expires_at)
  values (v_ticket, v_me, now() + interval '15 minutes');

  return jsonb_build_object('ok', true, 'ticket', v_ticket);
end $$;

-- ── 4. 兌換(舊 Google 帳號登入中時呼叫) ──────────────────────
create or replace function rpc_redeem_merge_ticket(p_ticket text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_src    uuid := current_sb_user_id();
  v_tgt    uuid;
  v_src_row sb_users%rowtype;
  v_code   text;
  v_moved_records int := 0;
  v_moved_points  int := 0;
begin
  if v_src is null then
    return jsonb_build_object('ok', false, 'message', '請先用舊的 Google 帳號登入。');
  end if;

  select target_user_id into v_tgt
    from sb_merge_tickets
   where ticket = p_ticket
     and redeemed_at is null
     and expires_at > now()
   for update;

  if v_tgt is null then
    return jsonb_build_object('ok', false, 'message', '轉移連結已失效,請回到 App 重新點一次。');
  end if;

  if v_tgt = v_src then
    return jsonb_build_object('ok', false, 'message', '這已經是同一個帳號了。');
  end if;

  select * into v_src_row from sb_users where id = v_src for update;

  if v_src_row.merged_into is not null then
    return jsonb_build_object('ok', false, 'message', '這個舊帳號已經轉移過了。');
  end if;

  -- 目標也鎖起來,避免兩邊同時搬
  perform 1 from sb_users where id = v_tgt for update;

  -- 4-1 檢測紀錄:全部搬過去
  update sb_analysis_records set user_id = v_tgt where user_id = v_src;
  get diagnostics v_moved_records = row_count;

  -- 4-2 積點帳本:搬「每一筆」而不是搬總額,帳本才留得住歷史
  update sb_point_ledger set user_id = v_tgt where user_id = v_src;
  get diagnostics v_moved_points = row_count;

  -- 4-3 月度快照:同月份已經有就跳過(unique(user_id, month_key))
  update sb_score_snapshots s set user_id = v_tgt
   where s.user_id = v_src
     and not exists (
       select 1 from sb_score_snapshots t
        where t.user_id = v_tgt and t.month_key = s.month_key);
  delete from sb_score_snapshots where user_id = v_src;

  -- 4-4 我推薦的人:跟著搬
  update sb_referrals set referrer_user_id = v_tgt where referrer_user_id = v_src;

  -- 4-5 我的小天使:新帳號還沒填才搬,已經填了就保留新的
  if not exists (select 1 from sb_referrals where invitee_user_id = v_tgt) then
    update sb_referrals set invitee_user_id = v_tgt where invitee_user_id = v_src;
  else
    delete from sb_referrals where invitee_user_id = v_src;
  end if;

  -- 4-6 抽獎紀錄、兌換碼使用紀錄
  update sb_lottery_draws set user_id = v_tgt where user_id = v_src;
  update sb_code_usages c set user_id = v_tgt
   where c.user_id = v_src
     and not exists (
       select 1 from sb_code_usages d where d.user_id = v_tgt and d.code = c.code);
  delete from sb_code_usages where user_id = v_src;

  -- 4-7 數值欄位:次數與硬幣相加,連續天數取大的
  --     member_code 把舊的搬過來 —— 舊碼可能已經發給朋友了,
  --     新帳號剛開沒多久,它的碼幾乎不可能流出去。
  v_code := v_src_row.member_code;
  update sb_users set member_code = null where id = v_src;

  update sb_users t set
    credits     = t.credits    + coalesce(v_src_row.credits, 0),
    total_used  = t.total_used + coalesce(v_src_row.total_used, 0),
    coins       = t.coins      + coalesce(v_src_row.coins, 0),
    streak      = greatest(t.streak, coalesce(v_src_row.streak, 0)),
    email       = coalesce(nullif(t.email, ''), v_src_row.email),
    phone       = case when t.phone is null or t.phone = '' then v_src_row.phone else t.phone end,
    member_code = coalesce(v_code, t.member_code),
    -- 管理員身分跟著人走。少了這行,管理員改用 LINE 登入之後會拿不到後台,
    -- 而且完全看不出原因(轉移看起來都成功了)。
    is_admin    = t.is_admin or coalesce(v_src_row.is_admin, false),
    -- points 是帳本的快取,重算比相加安全
    points      = coalesce((select sum(delta) from sb_point_ledger where user_id = v_tgt), 0)
  where t.id = v_tgt;

  -- 4-8 封存舊帳號
  --     credits 與 points 都是「花得掉的餘額」,一定要歸零 ——
  --     帳本已經整批搬走了,舊 row 的 points 若留著就是一筆對不上帳的幽靈點數。
  --     total_used / coins / streak 是歷史數字,留著當紀錄不影響任何餘額。
  update sb_users set
    credits     = 0,
    points      = 0,
    merged_into = v_tgt,
    merged_at   = now()
  where id = v_src;

  update sb_merge_tickets
     set redeemed_at = now(), source_user_id = v_src
   where ticket = p_ticket;

  return jsonb_build_object(
    'ok', true,
    'records', v_moved_records,
    'ledger_rows', v_moved_points,
    'credits', (select credits from sb_users where id = v_tgt),
    'points',  (select points  from sb_users where id = v_tgt),
    'member_code', (select member_code from sb_users where id = v_tgt)
  );
end $$;

-- ── 5. 授權 ─────────────────────────────────────────────────
-- 沿用 0007 的原則:預設全收回,只把該開的開給該開的角色。
revoke execute on function rpc_issue_merge_ticket()          from public, anon;
revoke execute on function rpc_redeem_merge_ticket(text)     from public, anon;
grant  execute on function rpc_issue_merge_ticket()          to authenticated;
grant  execute on function rpc_redeem_merge_ticket(text)     to authenticated;

-- line_user_id 是後端(liff-auth)寫的,前端不准碰。
-- 0002 已經把 sb_users 的 update 收成白名單,這裡不用再動;
-- 補一句確認新欄位沒有被誤放進白名單:
revoke update (line_user_id, merged_into, merged_at) on sb_users from anon, authenticated;
