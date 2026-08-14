-- ============================================================
-- LINE AI 健康顧問 Bot — 基礎資料表
-- 專案:facialmonitor (wcemkmwrlvijxxwybrgs)
-- 原則:所有 line_ 表一律開 RLS 且不建任何 anon policy,
--       只有 Edge Function 用 service_role key 存取。
-- ============================================================

-- ── 1. LINE 用戶 ↔ App 會員綁定 ────────────────────────────
create table if not exists line_users (
  line_user_id    text primary key,
  sb_user_id      uuid references sb_users(id) on delete set null,
  display_name    text,
  picture_url     text,
  bind_status     text not null default 'unbound'
                  check (bind_status in ('unbound','pending','bound')),
  pending_code    text,
  ai_paused_until timestamptz,
  current_tab     text not null default 'health',
  followed_at     timestamptz not null default now(),
  unfollowed_at   timestamptz,
  last_active_at  timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists idx_line_users_sb_user
  on line_users(sb_user_id) where sb_user_id is not null;
create index if not exists idx_line_users_active
  on line_users(last_active_at desc) where unfollowed_at is null;

-- ── 2. 對話 session ────────────────────────────────────────
create table if not exists line_conversations (
  id              uuid primary key default gen_random_uuid(),
  line_user_id    text not null references line_users(line_user_id) on delete cascade,
  status          text not null default 'active'
                  check (status in ('active','closed')),
  summary         text,
  started_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

-- 每位用戶同時只該有一個 active session
create unique index if not exists uniq_line_conv_active
  on line_conversations(line_user_id) where status = 'active';

-- ── 3. 對話訊息(記憶) ─────────────────────────────────────
create table if not exists line_messages (
  id              bigserial primary key,
  conversation_id uuid not null references line_conversations(id) on delete cascade,
  line_user_id    text not null,
  role            text not null check (role in ('user','assistant','system')),
  content         text not null,
  source          text not null default 'text'
                  check (source in ('text','postback','system')),
  -- LINE 會重送 webhook,靠這欄去重(postback 事件無 message id,故允許 null)
  line_message_id text unique,
  created_at      timestamptz not null default now()
);

create index if not exists idx_line_messages_conv
  on line_messages(conversation_id, created_at desc);

-- ── 4. 圖文選單註冊表(建立腳本寫入,方便重跑與回滾) ────────
create table if not exists line_rich_menus (
  id          bigserial primary key,
  tab_key     text not null unique check (tab_key in ('health','reward')),
  richmenu_id text not null,
  alias_id    text not null,
  image_file  text,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ── 5. 群發圖卡 ────────────────────────────────────────────
create table if not exists line_broadcasts (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  subtitle   text,
  note       text,
  image_url  text,
  link_url   text,
  flex_json  jsonb,
  audience   text not null default 'all'
             check (audience in ('all','bound','active_30d')),
  status     text not null default 'draft'
             check (status in ('draft','sending','sent','failed')),
  sent_count integer not null default 0,
  sent_at    timestamptz,
  error      text,
  created_at timestamptz not null default now()
);

create index if not exists idx_line_broadcasts_recent
  on line_broadcasts(created_at desc) where status = 'sent';

-- ── 6. 選單點擊記錄(哪一格有效、推薦轉換率) ────────────────
create table if not exists line_postback_logs (
  id           bigserial primary key,
  line_user_id text not null,
  action       text not null,
  tab_key      text,
  payload      jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists idx_line_postback_action
  on line_postback_logs(action, created_at desc);

-- ── RLS:全開,且不建 policy = 只有 service_role 進得來 ──────
alter table line_users          enable row level security;
alter table line_conversations  enable row level security;
alter table line_messages       enable row level security;
alter table line_rich_menus     enable row level security;
alter table line_broadcasts     enable row level security;
alter table line_postback_logs  enable row level security;
