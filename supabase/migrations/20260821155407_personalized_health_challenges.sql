create table if not exists public.sb_health_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.sb_users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  source_report_id uuid references public.sb_analysis_records(id) on delete set null,
  health_focus text not null,
  plan jsonb not null check (jsonb_typeof(plan)='array' and jsonb_array_length(plan)=14),
  starts_on date not null default ((now() at time zone 'Asia/Taipei')::date + 1),
  created_at timestamptz not null default now(), completed_at timestamptz
);
create unique index if not exists sb_health_challenges_one_active
  on public.sb_health_challenges(user_id) where status='active';
alter table public.sb_health_challenges enable row level security;

create table if not exists public.sb_health_challenge_deliveries (
  challenge_id uuid not null references public.sb_health_challenges(id) on delete cascade,
  day_no integer not null check (day_no between 1 and 14),
  sent_at timestamptz not null default now(),
  primary key(challenge_id,day_no)
);
alter table public.sb_health_challenge_deliveries enable row level security;

create or replace function public.rpc_apply_health_challenge(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_report public.sb_analysis_records%rowtype; v_focus text; v_id uuid; v_user uuid;
begin
  v_user := case when current_setting('request.jwt.claim.role',true)='service_role' then p_user_id else resolve_user_id(null) end;
  if v_user is null then raise exception 'unauthorized'; end if;
  if exists(select 1 from public.sb_health_challenges where user_id=v_user and status='active') then
    return jsonb_build_object('ok',true,'already_active',true);
  end if;
  select * into v_report from public.sb_analysis_records where user_id=v_user order by created_at desc limit 1;
  if v_report.id is null then return jsonb_build_object('ok',false,'error','no_report'); end if;
  v_focus := coalesce(v_report.report->>'constitution',v_report.report#>>'{analysis,constitution}',
                      v_report.report#>>'{scores,constitution}','日常體質調養');
  insert into public.sb_health_challenges(user_id,source_report_id,health_focus,plan)
  values(v_user,v_report.id,v_focus,jsonb_build_array(
    jsonb_build_object('day',1,'category','飲水','title','晨起溫水啟動','task','起床後慢慢喝 300ml 溫水。','why','補充夜間流失水分，溫和喚醒腸胃。'),
    jsonb_build_object('day',2,'category','飲食','title','五色蔬果餐盤','task','今天至少吃到 3 種顏色的蔬果。','why','增加纖維與植化素多樣性。'),
    jsonb_build_object('day',3,'category','運動','title','飯後走 15 分鐘','task','晚餐後輕鬆步行 15 分鐘。','why','幫助餐後代謝與消化。'),
    jsonb_build_object('day',4,'category','睡眠','title','睡前一小時離線','task','睡前 60 分鐘停止滑手機。','why','降低藍光與刺激，幫助入睡。'),
    jsonb_build_object('day',5,'category','飲食','title','少一份精製糖','task','今天以無糖飲品取代一杯含糖飲。','why','減少血糖波動與額外熱量。'),
    jsonb_build_object('day',6,'category','呼吸','title','腹式呼吸 5 分鐘','task','吸 4 秒、呼 6 秒，持續 5 分鐘。','why','協助放鬆與壓力調節。'),
    jsonb_build_object('day',7,'category','蛋白質','title','每餐一掌心蛋白質','task','至少兩餐加入豆、蛋、魚或瘦肉。','why','支持肌肉與修復。'),
    jsonb_build_object('day',8,'category','飲食','title','七分飽練習','task','用餐放慢，每口多嚼幾下，七分飽停下。','why','減少過量並增加飽足覺察。'),
    jsonb_build_object('day',9,'category','活動','title','久坐中斷','task','每坐 50 分鐘起身活動 3 分鐘。','why','改善循環並減少久坐負擔。'),
    jsonb_build_object('day',10,'category','纖維','title','補一份全穀雜糧','task','一餐以糙米、燕麥或地瓜取代精製澱粉。','why','增加纖維並讓能量較穩定。'),
    jsonb_build_object('day',11,'category','睡眠','title','固定就寢時間','task','設定今晚就寢時間，前後誤差不超過 30 分鐘。','why','建立穩定生理時鐘。'),
    jsonb_build_object('day',12,'category','運動','title','10 分鐘肌力','task','完成深蹲、靠牆伏地挺身各 2 組。','why','維持肌力與日常代謝。'),
    jsonb_build_object('day',13,'category','腸道','title','一份發酵食物','task','選擇無糖優格、味噌或納豆一份。','why','增加飲食多樣性，支持腸道健康。'),
    jsonb_build_object('day',14,'category','回顧','title','14 天健康回顧','task','記錄最有感的 3 個改變，選 1 項繼續做。','why','把短期任務轉成可持續習慣。')
  )) returning id into v_id;
  return jsonb_build_object('ok',true,'challenge_id',v_id,'focus',v_focus,'starts_on',((now() at time zone 'Asia/Taipei')::date+1));
end $$;
revoke execute on function public.rpc_apply_health_challenge(uuid) from public,anon;
grant execute on function public.rpc_apply_health_challenge(uuid) to authenticated,service_role;

select cron.schedule('health-challenge-daily-push','20 0 * * *',$cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='healthbot_project_url' order by created_at desc limit 1)||'/functions/v1/challenge-push',
    headers := jsonb_build_object('Content-Type','application/json','x-tip-push-secret',(select decrypted_secret from vault.decrypted_secrets where name='healthbot_tip_push_secret' order by created_at desc limit 1)),
    body := '{"mode":"push"}'::jsonb, timeout_milliseconds := 30000);
$cron$);
