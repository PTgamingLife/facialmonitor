/**
 * 管理中心的群發動作。
 *
 * 卡片怎麼組、分眾怎麼算,都是跟 line-broadcast 共用同一份模組 ——
 * 預覽看到的、測試收到的、真正群發出去的,必須是同一個東西。
 */

import { broadcast as lineBroadcast, LineMessage, multicast, push } from "../_shared/line.ts";
import { patch, remove, select, upsert } from "../_shared/db.ts";
import { buildMessages, type CardInput, type ImageLayout } from "../_shared/broadcast-card.ts";
import { type Audience, audienceCount, audienceList, isAudience } from "../_shared/audience.ts";

const MAX_TITLE = 60;
const MAX_BODY = 1000;

export type Draft = CardInput & { id?: string; audience?: Audience; scheduled_at?: string | null };

/**
 * 前端送什麼都當成不可信。
 * 標題是唯一必填 —— 沒有標題的卡片 altText 會是空的,在通知列顯示成一片空白。
 */
export function clean(raw: Record<string, unknown>): { ok: true; draft: Draft } | { ok: false; error: string } {
  const str = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t ? t.slice(0, max) : null;
  };
  const title = str(raw.title, MAX_TITLE);
  if (!title) return { ok: false, error: "標題不能空白。" };

  const url = (v: unknown): string | null => {
    const t = str(v, 500);
    if (!t) return null;
    try {
      const u = new URL(t);
      // 只收 https —— 卡片按鈕與圖片都會送到使用者手機上。
      return u.protocol === "https:" ? u.toString() : null;
    } catch { return null; }
  };

  const layout: ImageLayout = raw.image_layout === "message" ? "message" : "hero";
  const audience: Audience = isAudience(raw.audience) ? raw.audience : "all";

  let scheduled: string | null = null;
  if (typeof raw.scheduled_at === "string" && raw.scheduled_at.trim()) {
    const d = new Date(raw.scheduled_at);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "排程時間看不懂。" };
    scheduled = d.toISOString();
  }

  return {
    ok: true,
    draft: {
      id: typeof raw.id === "string" && raw.id ? raw.id : undefined,
      title,
      subtitle: str(raw.subtitle, MAX_BODY),
      note: str(raw.note, MAX_BODY),
      image_url: url(raw.image_url),
      link_url: url(raw.link_url),
      link_label: str(raw.link_label, 20),
      image_layout: layout,
      // 預設不加。理由見 _shared/broadcast-card.ts ——
      // 標題不是健康主題時,那顆按鈕會把使用者帶到一句「我沒有相關資訊」。
      ask_ai: raw.ask_ai === true,
      audience,
      scheduled_at: scheduled,
    },
  };
}

function row(d: Draft) {
  return {
    title: d.title,
    subtitle: d.subtitle ?? null,
    note: d.note ?? null,
    image_url: d.image_url ?? null,
    link_url: d.link_url ?? null,
    link_label: d.link_label ?? null,
    image_layout: d.image_layout ?? "hero",
    audience: d.audience ?? "all",
  };
}

export async function preview(d: Draft) {
  const messages = buildMessages(d);
  return {
    messages,
    audience: d.audience ?? "all",
    estimated_recipients: await audienceCount(d.audience ?? "all"),
  };
}

/** 只送給擁有者自己。計費一則,但那是確認卡片長相最便宜的方式。 */
export async function test(d: Draft, ownerLineId: string) {
  const ok = await push(ownerLineId, buildMessages(d));
  return { ok, sent: ok ? 1 : 0 };
}

/** 真的送出去。會計費,而且收不回來。 */
export async function send(d: Draft) {
  const audience = d.audience ?? "all";
  const messages: LineMessage[] = buildMessages(d);
  const flex = messages.at(-1)!;

  const created = await upsert("line_broadcasts", {
    ...row(d), flex_json: flex, status: "sending",
  }, { returning: true });
  const id = String((created as { id?: string } | null)?.id ?? "");

  let ok = true;
  let sent = 0;
  if (audience === "all") {
    ok = await lineBroadcast(messages);
    sent = ok ? await audienceCount("all") : 0;
  } else {
    const targets = await audienceList(audience);
    // multicast 一批最多 500 人
    for (let i = 0; i < targets.length; i += 500) {
      const batch = targets.slice(i, i + 500);
      if (await multicast(batch, messages)) sent += batch.length;
      else ok = false;
    }
  }

  if (id) {
    await patch("line_broadcasts", `id=eq.${id}`, {
      status: ok ? "sent" : "failed",
      sent_count: sent,
      sent_at: new Date().toISOString(),
      error: ok ? null : "部分或全部批次送出失敗,詳見函式日誌。",
    });
  }
  return { ok, sent, id };
}

/**
 * 排程:寫一列 draft 並設 scheduled_at,等每天早上的 cron 撿。
 *
 * ⚠️ cron 是台北時間 09:00 跑,而且一次只撿一則。
 *    所以排 08:00 會在 09:00 送出,同一天排兩則第二則會留到隔天。
 *    這兩件事畫面上要講清楚,不然使用者會以為是壞掉。
 */
export async function schedule(d: Draft) {
  if (!d.scheduled_at) return { ok: false, error: "沒有排程時間。" };
  const created = await upsert("line_broadcasts", {
    ...row(d), status: "draft", scheduled_at: d.scheduled_at,
  }, { returning: true });
  return { ok: true, id: String((created as { id?: string } | null)?.id ?? "") };
}

export async function list() {
  return await select("line_broadcasts",
    "select=id,title,subtitle,audience,status,sent_count,sent_at,scheduled_at,created_at"
    + "&order=created_at.desc&limit=30");
}

/** 只准刪還沒送出去的。已送出的是紀錄,刪掉等於把帳本撕一頁。 */
export async function drop(id: string) {
  const ok = await remove("line_broadcasts", `id=eq.${id}&status=eq.draft`);
  return { ok };
}
