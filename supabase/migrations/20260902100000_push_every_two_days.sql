-- 每日自動推播改成「兩天一次」
--
-- 「哪一天要發」只在 is_push_day() 定義一次,產稿、推播、網頁全部問它。
-- 各自算一次日期奇偶,遲早有一邊算錯,而且錯了不會有人發現 ——
-- 使用者只會覺得「今天怎麼沒收到」,查起來要翻三個地方。
--
-- 為什麼不改 cron 的 '0 0 */2 * *':day-of-month 的 */2 每個月從 1 號重來,
-- 31 號接著 1 號會連兩天發,2 月更亂。cron 照樣天天叫,由日期本身決定發不發。
--
-- 錨點取 2026-09-03(週四):9/2 以前照舊,新節奏從隔天開始。
-- 這個奇偶之下 9/5(六)、9/9(三)兩個祝福關卡剛好都留得住。
--
-- 順帶一提的節奏變化:週三與週六相隔三天(奇數),奇偶必定相反,
-- 所以每週剛好只有一個是發送日 —— 祝福關卡從「一週兩次」變成
-- 「一週一次,週三與週六輪流」。這是隔天發的必然結果,不是另外設計的。

create or replace function public.is_push_day(p_day date)
returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select pg_catalog.mod(p_day - date '2026-09-03', 2) = 0
$$;

comment on function public.is_push_day(date) is
  '每日挑戰的發送日:自 2026-09-03 起每隔一天。所有排程與網頁都以此為準。';

-- 給 tip-plan 用:從 p_start 起算 p_days 個日曆天,回傳其中該產稿的日子。
-- 產稿端不自己算奇偶,問資料庫要日期清單,兩邊就不可能對不起來。
create or replace function public.rpc_push_days(p_start date, p_days integer)
returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(d::date order by d), '[]'::jsonb)
    from generate_series(
           p_start,
           p_start + (least(greatest(coalesce(p_days, 14), 1), 60) - 1),
           interval '1 day'
         ) d
   where is_push_day(d::date)
$$;

-- 下一個發送日(含今天)。休息日的文案要講得出「下一次是哪天」。
create or replace function public.next_push_day(p_from date)
returns date
language sql immutable parallel safe set search_path = public as $$
  select case when is_push_day(p_from) then p_from else p_from + 1 end
$$;

revoke execute on function public.rpc_push_days(date, integer) from public, anon, authenticated;
grant  execute on function public.rpc_push_days(date, integer) to service_role;

-- ── 推播:非發送日直接不發 ─────────────────────────────────
-- cron 天天叫,這裡擋掉。擋在最前面 —— 連 sb_daily_pushes 的 skipped 都不要寫,
-- 不然一半的日子都是「跳過」紀錄,真正的缺稿反而被淹沒。
create or replace function public.rpc_claim_daily_tip_push()
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_tip_id uuid;
  v_push public.sb_daily_pushes%rowtype;
begin
  if not public.is_push_day(v_today) then
    return jsonb_build_object('ok', false, 'reason', 'not_push_day', 'push_date', v_today);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('daily-tip-' || v_today::text, 0));
  select id into v_tip_id from public.sb_daily_tips
   where tip_date = v_today and active and status = 'approved' and approved_at is not null;

  select * into v_push from public.sb_daily_pushes where push_date = v_today for update;
  if v_tip_id is null then
    if v_push.id is null then
      insert into public.sb_daily_pushes(push_date, status, completed_at, last_error)
      values (v_today, 'skipped', now(), 'no approved tip') returning * into v_push;
    end if;
    return jsonb_build_object('ok', false, 'reason', 'no_approved_tip', 'push_id', v_push.id);
  end if;

  if v_push.id is null then
    insert into public.sb_daily_pushes(push_date, tip_id, status, locked_until, attempt_count, started_at)
    values (v_today, v_tip_id, 'sending', now() + interval '10 minutes', 1, now())
    returning * into v_push;
  elsif v_push.status = 'sent' then
    return jsonb_build_object('ok', false, 'reason', 'already_sent', 'push_id', v_push.id);
  elsif v_push.status = 'sending' and v_push.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'lease_active', 'push_id', v_push.id);
  else
    update public.sb_daily_pushes set
      tip_id = v_tip_id, status = 'sending', locked_until = now() + interval '10 minutes',
      attempt_count = attempt_count + 1, started_at = coalesce(started_at, now()), updated_at = now()
    where id = v_push.id returning * into v_push;
  end if;

  return jsonb_build_object('ok', true, 'push_id', v_push.id, 'tip_id', v_tip_id,
                            'push_date', v_today, 'attempt_count', v_push.attempt_count);
end;
$$;

revoke execute on function public.rpc_claim_daily_tip_push() from public, anon, authenticated;
grant  execute on function public.rpc_claim_daily_tip_push() to service_role;

-- ── 存量:只數發送日 ───────────────────────────────────────
-- 改成兩天一次之後,「還有幾則稿」與「還能撐幾天」不再是同一個數字。
-- 提醒訊息要講的是後者(管理者關心的是什麼時候會斷),所以兩個都回。
create or replace function public.rpc_tip_stock()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_ok    integer;
  v_last  date;
  v_blocked jsonb;
begin
  if not is_service_role() then
    raise exception 'unauthorized';
  end if;

  select count(*), max(tip_date) into v_ok, v_last from sb_daily_tips
   where status = 'approved' and active and tip_date >= v_today and is_push_day(tip_date);

  -- 被自動檢查擋下來的那幾天:後台要看得到,不然沒人知道為什麼存量在掉。
  -- 只列發送日 —— 非發送日的草稿本來就不會發,列出來只是雜訊。
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', tip_date, 'title', title, 'flags', risk_flags) order by tip_date), '[]'::jsonb)
    into v_blocked
    from sb_daily_tips
   where status = 'draft' and tip_date >= v_today and is_push_day(tip_date);

  return jsonb_build_object(
    'ok', true,
    'pushes_left', v_ok,
    -- 還能撐幾天。沒稿了就是 0,不是負數。
    'days_left',   greatest(coalesce(v_last - v_today + 1, 0), 0),
    'covers_until', v_last,
    'is_push_day', is_push_day(v_today),
    -- 非發送日本來就不該有稿,不算缺稿
    'today_ready', (not is_push_day(v_today)) or exists(
      select 1 from sb_daily_tips
       where tip_date = v_today and status = 'approved' and active),
    -- 四則約等於一週。少於這個數就每天提醒一次,直到補進去為止。
    'should_alert', v_ok <= 4,
    'blocked', v_blocked
  );
end $$;

revoke execute on function public.rpc_tip_stock() from public, anon, authenticated;
grant  execute on function public.rpc_tip_stock() to service_role;

-- ── 網頁:休息日要說「今天休息」,不是「準備中」 ───────────
-- 圖文選單的「今日挑戰」天天都按得到,但只有一半的日子有題目。
-- 缺稿與休息是兩件事,回同一個 no_content 的話,前端只能退回示範內容,
-- 使用者會把示範題當成今天的真題目來做。
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

  select count(*) into v_week
    from sb_checkins
   where user_id = v_me
     and checkin_date >= v_today - ((extract(isodow from v_today)::int - 1))
     and checkin_date <= v_today;

  -- 休息日。照樣把進度與點數帶回去 —— 使用者是為了看進度才點進來的。
  if not is_push_day(v_today) then
    return jsonb_build_object(
      'ok', true, 'kind', 'rest',
      'next_date', next_push_day(v_today + 1),
      'week_done', v_week,
      'balance',   (select coalesce(points, 0) from sb_users where id = v_me));
  end if;

  select * into v_tip from sb_daily_tips
   where tip_date = v_today and status = 'approved' and active;

  if v_tip.id is null then
    -- 當天缺稿。前端會退回長青備用題,這裡誠實回報,不要假裝有內容。
    return jsonb_build_object('ok', false, 'error', 'no_content',
                              'message', '今天的題目還在準備中。');
  end if;

  select exists(select 1 from sb_checkins where user_id = v_me and checkin_date = v_today)
    into v_done;

  return jsonb_build_object(
    'ok',   true,
    'kind', v_tip.kind,
    'tip_id',   v_tip.id,
    'tip_date', v_tip.tip_date,
    'next_date', next_push_day(v_today + 1),
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

-- ── 作答:休息日不給分 ─────────────────────────────────────
-- 9/2 之前排定的稿,有幾天落在新節奏的休息日上,那些 row 還在資料庫裡
-- 而且是 approved。少了這道檢查,直接帶著那天的 tip_id 呼叫就領得到點數。
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

  if not is_push_day(v_today) then
    return jsonb_build_object('ok', false, 'error', 'rest_day',
                              'message', '今天沒有挑戰,下一次見 🌿');
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

revoke execute on function public.rpc_today_challenge()                from public, anon;
revoke execute on function public.rpc_answer_challenge(uuid, smallint) from public, anon;
grant  execute on function public.rpc_today_challenge()                to authenticated, service_role;
grant  execute on function public.rpc_answer_challenge(uuid, smallint) to authenticated, service_role;
