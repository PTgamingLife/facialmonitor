// 會員綁定、對話記憶、AI 上下文組裝

import { selectOne, select, insert, upsert, patch } from "../_shared/db.ts";
import { ensureAccount } from "../_shared/account.ts";
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

    // 舊用戶(v2 之前加的好友)或 follow 當下建失敗的,在這裡靜默補建。
    // 補不起來不擋 —— 使用者下次開網頁時 liff-auth 還會再試一次。
    if (!existing.sb_user_id) {
      const acc = await ensureAccount(lineUserId, existing.display_name ?? profile?.displayName);
      if (acc) return { ...existing, sb_user_id: acc.id, bind_status: "bound" };
    }
    return existing;
  }

  await upsert("line_users", {
    line_user_id: lineUserId,
    display_name: profile?.displayName ?? null,
    picture_url: profile?.pictureUrl ?? null,
    followed_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
  }, { onConflict: "line_user_id" });

  // 加好友的當下就把帳號開好。webhook 的 userId 來自驗過簽章的 LINE 請求,
  // 跟 ID token 一樣可信,沒有理由再讓使用者「去綁一次」。
  const acc = await ensureAccount(lineUserId, profile?.displayName);

  return {
    line_user_id: lineUserId,
    sb_user_id: acc?.id ?? null,
    display_name: profile?.displayName ?? null,
    bind_status: acc ? "bound" : "unbound",
    ai_paused_until: null,
  };
}

export function isAiPaused(u: LineUser): boolean {
  return !!u.ai_paused_until && new Date(u.ai_paused_until) > new Date();
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
  }

  // 本週完成幾天挑戰。AI 講得出「這週做了三天」比講「第幾天」貼身,
  // 而且 14 天挑戰已經移除,那個天數也不存在了。
  // 先換成台北日期再算週一 —— 直接用 UTC 的話,台北時間週一凌晨會被
  // 算成上一週(UTC 還停在週日),使用者早上打開會看到「本週 0 天」。
  const taipei = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const d = new Date(`${taipei}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));   // 回到本週一
  const checkins = await select<{ checkin_date: string }>(
    "sb_checkins",
    `user_id=eq.${u.sb_user_id}&checkin_date=gte.${d.toISOString().slice(0, 10)}`
      + `&select=checkin_date`,
  );
  ctx.weekDone = checkins.length;

  return ctx;
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

