-- ============================================================
-- 每日挑戰 v2 —— 內容併入、語氣人格、自動檢查取代人工審核
--
-- 三件事一起改,因為它們是同一個決定的三面:
--   1. 每日健康資訊不再單獨推播,它就是當天挑戰的「主題」段落。
--   2. 開場白與遊戲標題跟主題「同一次」產出,推播時只挑不生成。
--   3. 拿掉待審佇列:通過自動檢查就直接排程,存量少了才提醒管理者。
--
-- ⚠️ 已發布狀態沿用既有的 status = 'approved',沒有改成 'scheduled'。
--    line-webhook/handlers.ts、tip-push、admin.js 三處都在查 approved,
--    為了一個名字改三支程式不划算。意思已經不同了:現在是自動蓋章,
--    不是有人按過通過。approved_by 為 null 就代表「自動放行」。
-- ============================================================

-- ── 1. sb_daily_tips:主題 + 三版開場白 + 行動 ────────────────
alter table public.sb_daily_tips
  add column if not exists kind          text not null default 'quiz',
  add column if not exists intros        jsonb not null default '{}'::jsonb,
  add column if not exists game_titles   jsonb not null default '{}'::jsonb,
  add column if not exists action_today  text,
  add column if not exists source_name   text,
  add column if not exists source_date   text,
  add column if not exists auto_checked_at timestamptz,
  add column if not exists auto_check    jsonb not null default '{}'::jsonb;

comment on column public.sb_daily_tips.kind is
  'quiz = 知識題(一週 5 天);blessing = 祝福關卡(一週 2 天,週三與週六)。';
comment on column public.sb_daily_tips.intros is
  '三種語氣的開場白:{"zhou":"…","kang":"…","xs":"…"}。與主題同一次產出,推播時只挑不生成。';
comment on column public.sb_daily_tips.game_titles is
  '三種語氣的遊戲標題,鍵同 intros。卡片標題 = 今日主題 + 這裡的標題。';
comment on column public.sb_daily_tips.action_today is
  '揭曉時給的「今天可以做的一件事」。沒有它,答對就只是答對。';

do $$ begin
  alter table public.sb_daily_tips
    add constraint sb_daily_tips_kind_check check (kind in ('quiz', 'blessing'));
exception when duplicate_object then null; end $$;

-- 開場白與標題必須是物件。不擋的話模型回一個字串,前端取 ->>'zhou' 會拿到 null,
-- 卡片就變成沒有開場白的空白開頭。
do $$ begin
  alter table public.sb_daily_tips
    add constraint sb_daily_tips_intros_shape_check
    check (jsonb_typeof(intros) = 'object' and jsonb_typeof(game_titles) = 'object');
exception when duplicate_object then null; end $$;

-- ── 2. 語氣人格 ────────────────────────────────────────────
alter table public.sb_users
  add column if not exists tone text not null default 'zhou';

do $$ begin
  alter table public.sb_users
    add constraint sb_users_tone_check check (tone in ('zhou', 'kang', 'xs'));
exception when duplicate_object then null; end $$;

comment on column public.sb_users.tone is
  'zhou = 周小輪(預設,音樂感)、kang = 康小泳(細膩談話)、xs = 小XS(活潑綜藝)。'
  '語氣只影響開場白與引導語,題目、解析、來源三種一律相同。';

-- ── 3. 自動檢查 ────────────────────────────────────────────
-- 命中就「不排入那一天」,不是照發但標記。
-- 標記了沒人看等於沒擋 —— 拿掉人工審核之後,這裡是唯一的關卡。
create or replace function public.tip_auto_check(p_tip public.sb_daily_tips)
returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  v_flags text[] := '{}';
  v_text  text;
  v_word  text;
  -- 衛福部與食藥署列為可能涉及醫療效能宣稱的表述。
  -- 這是黑名單,不是萬靈丹:它擋的是最常出現、最貴的那幾種踩線寫法。
  v_banned text[] := array[
    '治療', '療效', '根治', '痊癒', '治癒', '藥效',
    '預防疾病', '改善病症', '減輕症狀', '診斷',
    '抗癌', '降血壓', '降血糖', '降膽固醇', '消炎止痛'
  ];
begin
  v_text := coalesce(p_tip.title, '') || ' ' || coalesce(p_tip.body, '') || ' '
         || coalesce(p_tip.summary, '') || ' ' || coalesce(p_tip.quiz_question, '') || ' '
         || coalesce(p_tip.quiz_explain, '') || ' ' || coalesce(p_tip.action_today, '') || ' '
         || coalesce(p_tip.intros::text, '');

  foreach v_word in array v_banned loop
    if position(v_word in v_text) > 0 then
      v_flags := v_flags || ('medical_claim:' || v_word);
    end if;
  end loop;

  if coalesce(trim(p_tip.title), '') = '' then v_flags := v_flags || 'missing_title'::text; end if;
  if coalesce(trim(p_tip.body),  '') = '' then v_flags := v_flags || 'missing_body'::text;  end if;

  -- 來源與日期是健康內容的信任底線,缺了就不能發
  if jsonb_array_length(coalesce(p_tip.source_urls, '[]'::jsonb)) = 0
     and coalesce(trim(p_tip.source_name), '') = '' then
    v_flags := v_flags || 'missing_source'::text;
  end if;

  -- 三版開場白缺任何一版就退回。缺的那版會 fallback 到周小輪,
  -- 但那代表有人的語氣設定形同虛設,寧可補齊再發。
  if not (p_tip.intros ? 'zhou' and p_tip.intros ? 'kang' and p_tip.intros ? 'xs') then
    v_flags := v_flags || 'missing_intro'::text;
  end if;

  if p_tip.kind = 'quiz' then
    if coalesce(trim(p_tip.quiz_question), '') = '' then v_flags := v_flags || 'missing_quiz'::text; end if;
    if coalesce(trim(p_tip.quiz_explain),  '') = '' then v_flags := v_flags || 'missing_explain'::text; end if;
    if coalesce(trim(p_tip.action_today),  '') = '' then v_flags := v_flags || 'missing_action'::text; end if;
  end if;

  return jsonb_build_object(
    'passed', cardinality(v_flags) = 0,
    'flags',  to_jsonb(v_flags),
    'at',     now()
  );
end $$;

-- 寫入或改稿時自動跑一次。通過就直接排程,不通過就退回 draft 並記 flags。
create or replace function public.tg_tip_auto_check()
returns trigger
language plpgsql set search_path = public as $$
declare
  v_res jsonb;
  v_changed boolean;
begin
  -- 內容有沒有真的變。沒變就什麼都不做 ——
  -- tip-push 更新推播狀態時也會 UPDATE 這張表,不能因此把已發的稿退回。
  v_changed := tg_op = 'INSERT' or (
       new.title         is distinct from old.title
    or new.summary       is distinct from old.summary
    or new.body          is distinct from old.body
    or new.detail_points is distinct from old.detail_points
    or new.image_url     is distinct from old.image_url
    or new.source_urls   is distinct from old.source_urls
    or new.source_name   is distinct from old.source_name
    or new.intros        is distinct from old.intros
    or new.game_titles   is distinct from old.game_titles
    or new.action_today  is distinct from old.action_today
    or new.kind          is distinct from old.kind
    or new.quiz_question is distinct from old.quiz_question
    or new.quiz_options  is distinct from old.quiz_options
    or new.quiz_answer   is distinct from old.quiz_answer
    or new.quiz_explain  is distinct from old.quiz_explain
  );

  if not v_changed then
    new.updated_at := now();
    return new;
  end if;

  v_res := tip_auto_check(new);
  new.auto_check      := v_res;
  new.auto_checked_at := now();
  new.risk_flags      := v_res->'flags';

  if (v_res->>'passed')::boolean then
    new.status      := 'approved';
    new.approved_at := coalesce(new.approved_at, now());
    -- approved_by 保持 null:null = 自動放行,有值 = 管理者手動改過
  else
    new.status      := 'draft';
    new.approved_at := null;
  end if;

  if tg_op = 'UPDATE' then
    new.content_version := coalesce(old.content_version, 1) + 1;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- 舊的 trg_daily_tip_reapproval 做的是同一件事的前半段(內容變動就退回 draft)。
-- 兩個 BEFORE UPDATE trigger 疊在同一張表上,只會讓「為什麼狀態變成這樣」
-- 變得沒人講得清楚。狀態的決定權從現在起只有 tip_auto_check 一個。
drop trigger if exists trg_daily_tip_reapproval on public.sb_daily_tips;

drop trigger if exists trg_tip_auto_check on public.sb_daily_tips;
create trigger trg_tip_auto_check
  before insert or update on public.sb_daily_tips
  for each row execute function public.tg_tip_auto_check();

-- ── 4. 完成一天的挑戰(知識題與祝福共用) ──────────────────────
-- 沿用 sb_checkins 的 unique(user_id, checkin_date):
-- 答對兩次、重開頁面、祝福重送,都會撞到唯一鍵而不是變成兩次加點。
create or replace function public.mark_challenge_done(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_pts   integer := rule_points('daily_checkin');
  v_first boolean := false;
  v_week  integer;
begin
  begin
    insert into sb_checkins (user_id, checkin_date, points_added)
    values (p_user, v_today, v_pts);
    v_first := true;
  exception when unique_violation then
    v_first := false;
  end;

  if v_first and v_pts > 0 then
    perform award_points(p_user, v_pts, 'daily_checkin', 'checkin', null,
                         month_key_of(now()), '每日挑戰 ' || v_today::text);
  end if;

  -- 本週完成天數。週一起算,做滿 5 天就算完成 ——
  -- 用「7 天完成 5 天」而不是連續簽到:斷一天就全部歸零只會讓人直接放棄。
  select count(*) into v_week
    from sb_checkins
   where user_id = p_user
     and checkin_date >= v_today - ((extract(isodow from v_today)::int - 1))
     and checkin_date <= v_today;

  return jsonb_build_object(
    'first_time',   v_first,
    'points_added', case when v_first then v_pts else 0 end,
    'balance',      (select coalesce(points, 0) from sb_users where id = p_user),
    'week_done',    v_week
  );
end $$;

-- ── 5. 今天的挑戰 ──────────────────────────────────────────
create or replace function public.rpc_today_challenge()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := resolve_user_id(null);
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_tone  text;
  v_tip   sb_daily_tips%rowtype;
  v_done  boolean;
  v_week  integer;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'message', '請先登入。');
  end if;

  select coalesce(tone, 'zhou') into v_tone from sb_users where id = v_me;

  select * into v_tip from sb_daily_tips
   where tip_date = v_today and status = 'approved' and active;

  if v_tip.id is null then
    -- 當天缺稿。前端會退回長青備用題,這裡誠實回報,不要假裝有內容。
    return jsonb_build_object('ok', false, 'error', 'no_content',
                              'message', '今天的題目還在準備中。');
  end if;

  select exists(select 1 from sb_checkins where user_id = v_me and checkin_date = v_today)
    into v_done;

  select count(*) into v_week
    from sb_checkins
   where user_id = v_me
     and checkin_date >= v_today - ((extract(isodow from v_today)::int - 1))
     and checkin_date <= v_today;

  return jsonb_build_object(
    'ok',   true,
    'kind', v_tip.kind,
    'tip_id',   v_tip.id,
    'tip_date', v_tip.tip_date,
    -- 缺哪一版就退回周小輪。使用者不該因為產稿漏了一版而看到空白開頭。
    'intro', coalesce(v_tip.intros ->> v_tone, v_tip.intros ->> 'zhou'),
    'title', coalesce(v_tip.game_titles ->> v_tone, v_tip.game_titles ->> 'zhou', v_tip.title),
    'topic_title', v_tip.title,
    'body',        v_tip.body,
    'image_url',   v_tip.image_url,
    'source_name', v_tip.source_name,
    'source_url',  v_tip.source_urls -> 0,
    'source_date', v_tip.source_date,
    -- 正確答案不在這裡。前端拿不到答案,只拿得到題目與選項。
    'quiz_question', v_tip.quiz_question,
    'quiz_options',  v_tip.quiz_options,
    'completed_today', v_done,
    'week_done', v_week,
    'balance',   (select coalesce(points, 0) from sb_users where id = v_me),
    -- 祝福關卡才需要:可以指定的對象(小天使與自己推薦成功的人)
    'targets', case when v_tip.kind = 'blessing' then (
        select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name)), '[]'::jsonb)
          from sb_users u
         where u.id in (
           -- 自己的小天使,以及自己推薦成功的人
           select referrer_user_id from sb_referrals
            where invitee_user_id = v_me and status = 'confirmed'
           union
           select invitee_user_id from sb_referrals
            where referrer_user_id = v_me and status = 'confirmed'
         )
      ) else null end
  );
end $$;

-- ── 6. 作答 ────────────────────────────────────────────────
create or replace function public.rpc_answer_challenge(
  p_tip_id uuid, p_choice smallint
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := resolve_user_id(null);
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_tip   sb_daily_tips%rowtype;
  v_done  jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'message', '請先登入。');
  end if;

  -- 一定要綁當天。舊卡片翻回去按也沒用,tip_date 已經對不上今天。
  select * into v_tip from sb_daily_tips
   where id = p_tip_id and tip_date = v_today and status = 'approved' and active;

  if v_tip.id is null or v_tip.quiz_answer is null then
    return jsonb_build_object('ok', false, 'error', 'expired',
                              'message', '這題已經過期了,回選單看今天的挑戰吧。');
  end if;

  if p_choice is null or p_choice < 0
     or p_choice >= jsonb_array_length(coalesce(v_tip.quiz_options, '[]'::jsonb)) then
    return jsonb_build_object('ok', false, 'error', 'bad_choice', 'message', '選項不正確。');
  end if;

  -- 答錯不扣分、不中斷紀錄,也不留下任何痕跡 —— 想幾次都可以
  if p_choice <> v_tip.quiz_answer then
    return jsonb_build_object('ok', true, 'correct', false);
  end if;

  v_done := mark_challenge_done(v_me);

  return jsonb_build_object('ok', true, 'correct', true,
    'explain',      v_tip.quiz_explain,
    'action_today', v_tip.action_today,
    'first_time',   v_done->'first_time',
    'points_added', v_done->'points_added',
    'balance',      v_done->'balance',
    'week_done',    v_done->'week_done');
end $$;

-- ── 7. 語氣設定 ────────────────────────────────────────────
create or replace function public.rpc_set_tone(p_tone text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := resolve_user_id(null);
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'message', '請先登入。');
  end if;
  if p_tone not in ('zhou', 'kang', 'xs') then
    return jsonb_build_object('ok', false, 'message', '沒有這個語氣。');
  end if;
  update sb_users set tone = p_tone where id = v_me;
  return jsonb_build_object('ok', true, 'tone', p_tone);
end $$;

-- ── 8. 存量:給每天 07:30 預檢用 ─────────────────────────────
-- 「今天起還有幾天有稿」。≤ 4 天推 LINE 提醒管理者,4/3/2/1 各提醒一次。
-- 回傳整個清單而不是只回數字,提醒訊息才講得出「缺的是哪幾天」。
create or replace function public.rpc_tip_stock()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_ok    integer;
  v_blocked jsonb;
begin
  if not is_service_role() then
    raise exception 'unauthorized';
  end if;

  select count(*) into v_ok from sb_daily_tips
   where status = 'approved' and active and tip_date >= v_today;

  -- 被自動檢查擋下來的那幾天:後台要看得到,不然沒人知道為什麼存量在掉
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', tip_date, 'title', title, 'flags', risk_flags) order by tip_date), '[]'::jsonb)
    into v_blocked
    from sb_daily_tips
   where status = 'draft' and tip_date >= v_today;

  return jsonb_build_object(
    'ok', true,
    'days_left',   v_ok,
    'today_ready', exists(select 1 from sb_daily_tips
                           where tip_date = v_today and status = 'approved' and active),
    'should_alert', v_ok <= 4,
    'blocked', v_blocked
  );
end $$;

-- ── 9. 點數規則改名 ────────────────────────────────────────
-- 打卡與讀健康資訊合併成一次每日挑戰,一天只給一次。
update sb_point_rules set label = '每日挑戰' where rule_key = 'daily_checkin';

-- ── 10. 授權 ───────────────────────────────────────────────
revoke execute on function public.rpc_today_challenge()                  from public, anon;
revoke execute on function public.rpc_answer_challenge(uuid, smallint)   from public, anon;
revoke execute on function public.rpc_set_tone(text)                     from public, anon;
revoke execute on function public.rpc_tip_stock()                        from public, anon, authenticated;
revoke execute on function public.mark_challenge_done(uuid)              from public, anon, authenticated;

grant execute on function public.rpc_today_challenge()                to authenticated, service_role;
grant execute on function public.rpc_answer_challenge(uuid, smallint) to authenticated, service_role;
grant execute on function public.rpc_set_tone(text)                   to authenticated, service_role;
grant execute on function public.rpc_tip_stock()                      to service_role;
grant execute on function public.mark_challenge_done(uuid)            to service_role;
