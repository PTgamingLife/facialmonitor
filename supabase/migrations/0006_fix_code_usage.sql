-- ============================================================
-- 修正兌換碼的使用紀錄表
--
-- 背景:0004 的 rpc_redeem_health_code 原本寫進 code_usages,
-- 但正式庫裡根本沒有這張表。真實存在的是 code_usage(單數),
-- 欄位是 code_used 而非 code,而且外鍵指向舊的 users 表 ——
-- sb 會員的 id 不在 users 裡,就算改對表名也會違反外鍵。
--
-- 所以這裡另建一張 sb_ 前綴、外鍵指向 sb_users 的表,
-- 不動舊的 code_usage(那是舊 App 的資料,留著)。
-- ============================================================

create table if not exists sb_code_usages (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references sb_users(id) on delete cascade,
  code    text not null,
  credits integer not null default 0,   -- 當時換到幾次,存證用
  used_at timestamptz not null default now(),
  -- 同一組碼每人只能用一次
  constraint uniq_code_usage_per_user unique (user_id, code)
);

create index if not exists idx_sb_code_usages_user
  on sb_code_usages(user_id, used_at desc);

alter table sb_code_usages enable row level security;

drop policy if exists p_code_usages_own on sb_code_usages;
create policy p_code_usages_own on sb_code_usages
  for select to authenticated using (user_id = current_sb_user_id());

-- ── 改寫兌換碼 RPC ─────────────────────────────────────────
-- 語意:兌換碼是「共用密碼」,每個人各自可以用一次。
-- 因此不動 sb_health_codes.used_by —— js/admin.js 靠
-- .is('used_by', null) 顯示目前生效的碼,一標記使用後台就看不到了。
create or replace function rpc_redeem_health_code(
  p_code text, p_user_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid; v_row sb_health_codes%rowtype;
begin
  v_me := resolve_user_id(p_user_id);
  p_code := trim(coalesce(p_code, ''));

  if p_code !~ '^[0-9]{7}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_code',
                              'message', '兌換碼是 7 位數字');
  end if;

  select * into v_row from sb_health_codes where code = p_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid',
                              'message', '兌換碼無效');
  end if;

  -- 用唯一鍵擋重複,不用先查再寫,避免同時送兩次各加一次次數
  begin
    insert into sb_code_usages(user_id, code, credits)
    values (v_me, p_code, coalesce(v_row.credits, 0));
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'used',
                              'message', '這個兌換碼你已經用過了');
  end;

  update sb_users
     set credits = coalesce(credits, 0) + coalesce(v_row.credits, 0)
   where id = v_me;

  return jsonb_build_object('ok', true,
    'credits_added', coalesce(v_row.credits, 0),
    'credits', (select credits from sb_users where id = v_me));
end $$;

grant execute on function rpc_redeem_health_code(text, uuid)
  to authenticated, service_role;
