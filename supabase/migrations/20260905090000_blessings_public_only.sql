-- 祝福不再指定對象,送出就上牆
--
-- 原本的設計有兩個開關:送給誰(target_id)、要不要公開(is_public)。
-- 實際上「指定對象」只寫進資料庫,沒有任何地方推播給那個人 ——
-- 選單上那一格從頭到尾沒有作用。而「同意公開」預設不勾,
-- 等於多數祝福寫完就沉在資料庫裡,祝福牆長不出東西來。
--
-- 現在的規則簡單一句話:寫了就是寫給大家看的,署自己的名字。
--
-- ⚠️ 舊資料不動。已經送出的 is_public = false 那些,
-- 是在「不同意也可以送出,但不會出現在祝福牆上」這句話下面寫的,
-- 事後把它們翻成公開等於違背當初的承諾。它們就留在原地。

-- ── 送出祝福 ───────────────────────────────────────────────
-- 參數保留 p_target_id / p_public 但不再使用。
-- 網頁掛在 GitHub Pages,使用者手上可能還是舊的那份 —— 直接改簽章的話,
-- 舊頁面會整個送不出去。留著吃掉、行為統一,等頁面都汰換完再拿掉。
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

  begin
    -- target_id 一律 null、is_public 一律 true。
    insert into sb_blessings (author_id, target_id, text, is_public, blessed_date)
    values (v_me, null, v_txt, true, v_today)
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_sent',
                              'message', '今天已經送出過一則祝福了。');
  end;

  v_done := mark_challenge_done(v_me);

  return jsonb_build_object('ok', true, 'blessing_id', v_id,
    'is_public',    true,
    'first_time',   v_done->'first_time',
    'points_added', v_done->'points_added',
    'balance',      v_done->'balance',
    'week_done',    v_done->'week_done');
end $$;

comment on function public.rpc_submit_blessing(text, uuid, boolean) is
  '送出今天的祝福。一律公開署名、不指定對象;p_target_id 與 p_public 已停用。';

comment on column public.sb_blessings.target_id is
  '已停用。舊資料保留,新的一律 null。';
comment on column public.sb_blessings.is_public is
  '新資料一律 true。false 的是舊制「不同意公開」的祝福,不會上牆。';

-- 指定對象沒了,這個索引跟著失去用途(它是給「通知收件者」用的)。
drop index if exists public.sb_blessings_target_idx;

-- ── 每日挑戰:不再回傳可指定的對象 ──────────────────────────
-- 只有 targets 那一段拿掉,其餘與上一版相同。
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
    'balance',   (select coalesce(points, 0) from sb_users where id = v_me)
  );
end $$;

revoke execute on function public.rpc_submit_blessing(text, uuid, boolean) from public, anon;
revoke execute on function public.rpc_today_challenge()                    from public, anon;
grant  execute on function public.rpc_submit_blessing(text, uuid, boolean) to authenticated, service_role;
grant  execute on function public.rpc_today_challenge()                    to authenticated, service_role;
