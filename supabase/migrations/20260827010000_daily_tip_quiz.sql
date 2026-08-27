-- 每日挑戰:健康資訊附一題選擇題
--
-- 「每日打卡」改成「每日挑戰」—— 純簽到只是點一下拿分,跟內容無關;
-- 附一題選擇題,至少要看過當天的健康資訊才答得出來。
--
-- 給分沿用既有的 rpc_daily_checkin(一天一次的冪等保護已經驗過),
-- 這裡只負責存題目。答案由伺服器比對,postback 只帶「選了第幾個」。

alter table public.sb_daily_tips
  add column if not exists quiz_question text,
  add column if not exists quiz_options  jsonb,
  add column if not exists quiz_answer   smallint,
  add column if not exists quiz_explain  text;

-- 選項必須是 2~4 個字串的陣列,答案必須落在範圍內。
-- 不擋的話,模型少給一個選項就會在 LINE 上變成點不到的按鈕。
do $$ begin
  alter table public.sb_daily_tips
    add constraint sb_daily_tips_quiz_shape_check
    check (
      quiz_options is null
      or (
        jsonb_typeof(quiz_options) = 'array'
        and jsonb_array_length(quiz_options) between 2 and 4
        and quiz_answer is not null
        and quiz_answer >= 0
        and quiz_answer < jsonb_array_length(quiz_options)
      )
    );
exception when duplicate_object then null; end $$;

comment on column public.sb_daily_tips.quiz_question is
  '每日挑戰的題目;為空表示當天沒有題目,按鈕會退回原本的打卡。';
comment on column public.sb_daily_tips.quiz_answer is
  '正確選項的索引(0 起算)。答案只存在資料庫,不會出現在 postback。';
