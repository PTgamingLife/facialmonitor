-- 修:推薦人永遠拿不到「朋友完成首檢」的積點
--
-- rpc_confirm_referral 從 0003 就寫好了、也授權給 service_role 了,
-- 但是「沒有任何程式呼叫它」—— 全庫、全前端、全 Edge Function 都找不到呼叫點。
-- 後果:sb_referrals.status 永遠停在 pending,
--   ・「我推薦的人」名單上每個人都顯示「尚未首檢」(即使已經檢測過)
--   ・invite_confirmed 這條規則在 sb_point_ledger 裡一筆紀錄都沒有,
--     30 點的推薦獎勵從上線到現在一次都沒發出去
--
-- 修法:掛 trigger 在 sb_analysis_records,而不是再找個地方補呼叫。
-- 檢測紀錄是誰寫的都有可能(前端直寫、analyze、將來的其他程式),
-- 靠「記得呼叫」就是這次出事的原因;掛在資料表上才不會再漏。

-- ── 1. 把認列邏輯抽成內部函式,RPC 與 trigger 共用一份 ──────
create or replace function public._confirm_referral(p_invitee_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref record; v_limit integer; v_used integer; v_pts integer; v_month text;
begin
  select * into v_ref from sb_referrals
   where invitee_user_id = p_invitee_id and status = 'pending'
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_pending_referral');
  end if;

  -- 必須真的做過至少一次檢測,光註冊不給點
  if not exists (select 1 from sb_analysis_records where user_id = p_invitee_id) then
    return jsonb_build_object('ok', false, 'error', 'no_scan_yet');
  end if;

  v_month := month_key_of(now());
  v_limit := (select limit_per_month from sb_point_rules
               where rule_key = 'invite_confirmed');

  if v_limit is not null then
    select count(*) into v_used from sb_point_ledger
     where user_id = v_ref.referrer_user_id
       and reason = 'invite_confirmed' and month_key = v_month;
    if v_used >= v_limit then
      -- 超過月上限仍然要認列,否則名單會一直顯示「尚未首檢」
      update sb_referrals set status = 'confirmed', confirmed_at = now()
       where id = v_ref.id;
      return jsonb_build_object('ok', true, 'points_awarded', 0,
                                'error', 'monthly_limit_reached');
    end if;
  end if;

  update sb_referrals set status = 'confirmed', confirmed_at = now()
   where id = v_ref.id;

  v_pts := rule_points('invite_confirmed');
  perform award_points(v_ref.referrer_user_id, v_pts, 'invite_confirmed',
                       'referral', v_ref.id, v_month, '推薦的人完成首次檢測');

  return jsonb_build_object('ok', true, 'points_awarded', v_pts,
                            'referrer_id', v_ref.referrer_user_id);
end $$;

revoke execute on function public._confirm_referral(uuid) from public, anon, authenticated;

-- 對外的 RPC 保留原本的行為與授權,只是把邏輯轉呼叫內部函式。
create or replace function public.rpc_confirm_referral(p_invitee_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_service_role() then raise exception 'unauthorized'; end if;
  return public._confirm_referral(p_invitee_id);
end $$;

revoke execute on function public.rpc_confirm_referral(uuid) from public, anon, authenticated;
grant execute on function public.rpc_confirm_referral(uuid) to service_role;

-- ── 2. 掛在檢測紀錄上,寫入即認列 ────────────────────────────
create or replace function public.trg_confirm_referral_on_scan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 認列失敗(沒有待認列的推薦、超過月上限)都是正常情況,
  -- 絕對不能讓它把使用者的檢測紀錄一起 rollback 掉。
  begin
    perform public._confirm_referral(new.user_id);
  exception when others then
    raise warning 'confirm referral failed for %: %', new.user_id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists confirm_referral_on_scan on public.sb_analysis_records;
create trigger confirm_referral_on_scan
  after insert on public.sb_analysis_records
  for each row execute function public.trg_confirm_referral_on_scan();

-- ── 3. 補發已經漏掉的 ────────────────────────────────────────
-- 只補「被推薦之後才做首檢」的人。先前就已經是客戶、後來才被填成
-- 被推薦人的(檢測時間早於推薦時間),不在這次補發範圍 —— 那不是
-- 帶進來的新客戶,要不要給是營運決定,不該由這支 migration 代決。
do $$
declare r record;
begin
  for r in
    select ref.invitee_user_id
      from sb_referrals ref
     where ref.status = 'pending'
       and exists (
         select 1 from sb_analysis_records a
          where a.user_id = ref.invitee_user_id
            and a.created_at >= ref.created_at)
  loop
    perform public._confirm_referral(r.invitee_user_id);
  end loop;
end $$;
