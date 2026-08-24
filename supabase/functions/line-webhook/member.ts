// 會員綁定、對話記憶、AI 上下文組裝

import { selectOne, select, insert, upsert, patch } from "../_shared/db.ts";
import type { MemberContext, Turn } from "../_shared/claude.ts";

export type LineUser = {
  line_user_id: string;
  sb_user_id: string | null;
  display_name: string | null;
  bind_status: string;
  ai_paused_until: string | null;
};

const HISTORY_LIMIT = 12;      // 帶進 prompt 的訊息數
const SUMMARIZE_AFTER = 30;    // 一個 session 超過這麼多則就壓縮
const SESSION_IDLE_HOURS = 6;

export async function getOrCreateLineUser(
  lineUserId: string,
  profile?: { displayName?: string; pictureUrl?: string } | null,
): Promise<LineUser> {
  const existing = await selectOne<LineUser>(
    "line_users",
    `line_user_id=eq.${encodeURIComponent(lineUserId)}&select=*`,
  );

  if (existing) {
    await patch("line_users", `line_user_id=eq.${encodeURIComponent(lineUserId)}`, {
      last_active_at: new Date().toISOString(),
      ...(profile?.displayName ? { display_name: profile.displayName } : {}),
    });
    return existing;
  }

  await upsert("line_users", {
    line_user_id: lineUserId,
    display_name: profile?.displayName ?? null,
    picture_url: profile?.pictureUrl ?? null,
    followed_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
  }, { onConflict: "line_user_id" });

  return {
    line_user_id: lineUserId,
    sb_user_id: null,
    display_name: profile?.displayName ?? null,
    bind_status: "unbound",
    ai_paused_until: null,
  };
}

export function isAiPaused(u: LineUser): boolean {
  return !!u.ai_paused_until && new Date(u.ai_paused_until) > new Date();
}

/** 綁定 App 會員(輸入自己的 7 位會員碼) */
export async function bindMember(
  lineUserId: string,
  code: string,
): Promise<{ ok: boolean; message: string; name?: string }> {
  if (!/^\d{7}$/.test(code)) {
    return { ok: false, message: "會員碼是 7 位數字,請重新輸入。" };
  }

  const user = await selectOne<{ id: string; name: string }>(
    "sb_users",
    `member_code=eq.${code}&select=id,name`,
  );
  if (!user) return { ok: false, message: "找不到這組會員碼,請到 App 首頁確認。" };

  const taken = await selectOne<{ line_user_id: string }>(
    "line_users",
    `sb_user_id=eq.${user.id}&select=line_user_id`,
  );
  if (taken && taken.line_user_id !== lineUserId) {
    return { ok: false, message: "這組會員碼已經綁在另一個 LINE 帳號上了。" };
  }

  await patch("line_users", `line_user_id=eq.${encodeURIComponent(lineUserId)}`, {
    sb_user_id: user.id,
    bind_status: "bound",
    pending_code: null,
  });
  return { ok: true, message: `綁定成功,${user.name}`, name: user.name };
}

// ── 會員摘要:給 AI 的上下文 ────────────────────────────────
export async function loadMemberContext(u: LineUser): Promise<MemberContext> {
  if (!u.sb_user_id) return { bound: false };

  const [row] = await select<{
    name: string; credits: number; points: number;
  }>("sb_users", `id=eq.${u.sb_user_id}&select=name,credits,points`);

  const record = await selectOne<{ report: Record<string, unknown>; created_at: string }>(
    "sb_analysis_records",
    `user_id=eq.${u.sb_user_id}&select=report,created_at&order=created_at.desc`,
  );

  const ctx: MemberContext = {
    bound: true,
    name: row?.name,
    credits: row?.credits,
    points: row?.points,
  };

  if (record?.report) {
    const r = record.report as {
      scores?: { total?: number }; score?: number;
      constitution?: { type?: string };
    };
    ctx.lastScore = r.scores?.total ?? r.score;
    ctx.constitution = r.constitution?.type;
    ctx.lastScanAt = record.created_at.slice(0, 10);
    ctx.challengeDay = challengeDay(record.created_at);
  }

  return ctx;
}

/** 第幾天:以第一次檢測為 Day 1(與前端 features.js 同一套算法) */
export function challengeDay(firstScanAt: string): number {
  const diff = Math.floor((Date.now() - new Date(firstScanAt).getTime()) / 86400000);
  return Math.min(Math.max(diff + 1, 1), 14);
}

export async function firstScanAt(sbUserId: string): Promise<string | null> {
  const row = await selectOne<{ created_at: string }>(
    "sb_analysis_records",
    `user_id=eq.${sbUserId}&select=created_at&order=created_at.asc`,
  );
  return row?.created_at ?? null;
}

// ── 對話 session 與記憶 ────────────────────────────────────
export type Conversation = { id: string; summary: string | null; last_message_at: string };

export async function getConversation(lineUserId: string): Promise<Conversation> {
  const active = await selectOne<Conversation>(
    "line_conversations",
    `line_user_id=eq.${encodeURIComponent(lineUserId)}&status=eq.active`
      + `&select=id,summary,last_message_at`,
  );

  if (active) {
    const idleMs = Date.now() - new Date(active.last_message_at).getTime();
    if (idleMs < SESSION_IDLE_HOURS * 3600_000) return active;
    // 閒置太久,收掉開新的
    await patch("line_conversations", `id=eq.${active.id}`, { status: "closed" });
  }

  const created = await insert("line_conversations", {
    line_user_id: lineUserId,
  }, { returning: true });

  return {
    id: String(created?.id ?? ""),
    summary: (active?.summary as string | null) ?? null,
    last_message_at: new Date().toISOString(),
  };
}

/** 寫入訊息;line_message_id 重複代表 LINE 重送,回 false 讓上層跳過 */
export async function saveMessage(opts: {
  conversationId: string;
  lineUserId: string;
  role: "user" | "assistant";
  content: string;
  source?: "text" | "postback" | "system";
  lineMessageId?: string | null;
}): Promise<boolean> {
  const row = await insert("line_messages", {
    conversation_id: opts.conversationId,
    line_user_id: opts.lineUserId,
    role: opts.role,
    content: opts.content,
    source: opts.source ?? "text",
    line_message_id: opts.lineMessageId ?? null,
  }, { returning: true });

  if (row) {
    await patch("line_conversations", `id=eq.${opts.conversationId}`, {
      last_message_at: new Date().toISOString(),
    });
  }
  return !!row;
}

export async function loadHistory(conversationId: string): Promise<Turn[]> {
  const rows = await select<{ role: string; content: string }>(
    "line_messages",
    `conversation_id=eq.${conversationId}&role=in.(user,assistant)`
      + `&select=role,content&order=created_at.desc&limit=${HISTORY_LIMIT}`,
  );
  return rows
    .reverse()
    .map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));
}

export async function messageCount(conversationId: string): Promise<number> {
  const rows = await select<{ id: number }>(
    "line_messages",
    `conversation_id=eq.${conversationId}&select=id&limit=${SUMMARIZE_AFTER + 1}`,
  );
  return rows.length;
}

export const LIMITS = { HISTORY_LIMIT, SUMMARIZE_AFTER, SESSION_IDLE_HOURS };

