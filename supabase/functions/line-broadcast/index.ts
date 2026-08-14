// 群發 Flex 圖卡
//
// ⚠️ push / broadcast 是「對外且計費」的動作,所以這支預設 dry_run = true,
//    只回傳預覽 JSON 與預估人數,不會真的送出。
//    要真的送必須明確帶 { "dry_run": false }。
//
// 用法:
//   POST { "broadcast_id": "<uuid>", "dry_run": false }
//   POST { "title": "...", "subtitle": "...", "image_url": "...",
//          "link_url": "...", "audience": "bound", "dry_run": true }
//
// 部署:supabase functions deploy line-broadcast
// 不要加 --no-verify-jwt,這支只給後台呼叫。

import { broadcast, infoCard, LineMessage, multicast, uriAction } from "../_shared/line.ts";
import { patch, select, selectOne, upsert } from "../_shared/db.ts";

type Audience = "all" | "bound" | "active_30d";

type Payload = {
  broadcast_id?: string;
  title?: string;
  subtitle?: string;
  note?: string;
  image_url?: string;
  link_url?: string;
  audience?: Audience;
  dry_run?: boolean;
};

type BroadcastRow = {
  id: string;
  title: string;
  subtitle: string | null;
  note: string | null;
  image_url: string | null;
  link_url: string | null;
  audience: Audience;
  status: string;
};

function buildFlex(row: {
  title: string; subtitle?: string | null; note?: string | null;
  image_url?: string | null; link_url?: string | null;
}): LineMessage {
  return infoCard({
    title: row.title,
    subtitle: row.subtitle ?? undefined,
    hero: row.image_url ?? undefined,
    note: row.note ?? undefined,
    buttons: [
      ...(row.link_url
        ? [{ label: "立即報名", action: uriAction("立即報名", row.link_url), primary: true }]
        : []),
      { label: "先問問 AI", action: { type: "message", label: "先問問 AI", text: `我想了解「${row.title}」` } },
    ],
    altText: row.title,
  });
}

/** 依分眾條件取名單;audience=all 走 broadcast API,不需要名單 */
async function audienceList(audience: Audience): Promise<string[]> {
  if (audience === "all") return [];

  let query = "select=line_user_id&unfollowed_at=is.null";
  if (audience === "bound") {
    query += "&sb_user_id=not.is.null";
  } else if (audience === "active_30d") {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    query += `&last_active_at=gte.${since}`;
  }

  const rows = await select<{ line_user_id: string }>("line_users", `${query}&limit=10000`);
  return rows.map((r) => r.line_user_id);
}

async function estimateAll(): Promise<number> {
  const rows = await select<{ line_user_id: string }>(
    "line_users",
    "select=line_user_id&unfollowed_at=is.null&limit=10000",
  );
  return rows.length;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  // 預設不送,必須明確關掉 dry_run 才會真的推播
  const dryRun = body.dry_run !== false;

  // 來源:既有草稿,或這次呼叫直接帶的內容
  let row: BroadcastRow | null = null;
  if (body.broadcast_id) {
    row = await selectOne<BroadcastRow>("line_broadcasts", `id=eq.${body.broadcast_id}&select=*`);
    if (!row) return Response.json({ ok: false, error: "broadcast_not_found" }, { status: 404 });
    if (row.status === "sent") {
      return Response.json({ ok: false, error: "already_sent" }, { status: 409 });
    }
  } else {
    if (!body.title) return Response.json({ ok: false, error: "title_required" }, { status: 400 });
    row = {
      id: "",
      title: body.title,
      subtitle: body.subtitle ?? null,
      note: body.note ?? null,
      image_url: body.image_url ?? null,
      link_url: body.link_url ?? null,
      audience: body.audience ?? "all",
      status: "draft",
    };
  }

  const flex = buildFlex(row);
  const targets = await audienceList(row.audience);
  const estimated = row.audience === "all" ? await estimateAll() : targets.length;

  if (dryRun) {
    return Response.json({
      ok: true,
      dry_run: true,
      audience: row.audience,
      estimated_recipients: estimated,
      message: "這是預覽,沒有送出。確認後帶 dry_run: false 才會真的推播(會計費)。",
      preview: flex,
    });
  }

  // 真的要送了 —— 先把狀態標成 sending,避免重複觸發
  let broadcastId = row.id;
  if (!broadcastId) {
    const created = await upsert("line_broadcasts", {
      title: row.title,
      subtitle: row.subtitle,
      note: row.note,
      image_url: row.image_url,
      link_url: row.link_url,
      audience: row.audience,
      flex_json: flex,
      status: "sending",
    }, { returning: true });
    broadcastId = String(created?.id ?? "");
  } else {
    await patch("line_broadcasts", `id=eq.${broadcastId}`, {
      flex_json: flex,
      status: "sending",
    });
  }

  let sent = 0;
  let ok = true;

  if (row.audience === "all") {
    ok = await broadcast(flex);
    sent = ok ? estimated : 0;
  } else {
    // multicast 一批最多 500 人
    for (let i = 0; i < targets.length; i += 500) {
      const batch = targets.slice(i, i + 500);
      const batchOk = await multicast(batch, flex);
      if (batchOk) sent += batch.length;
      else ok = false;
    }
  }

  if (broadcastId) {
    await patch("line_broadcasts", `id=eq.${broadcastId}`, {
      status: ok ? "sent" : "failed",
      sent_count: sent,
      sent_at: new Date().toISOString(),
    });
  }

  return Response.json({
    ok,
    dry_run: false,
    broadcast_id: broadcastId,
    audience: row.audience,
    sent_count: sent,
  });
});
