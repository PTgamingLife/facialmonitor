import { authorizeCronHash } from "../_shared/cron-auth.ts";
import { appUrl, infoCard, multicast, postbackAction, push, uriAction } from "../_shared/line.ts";
import { patch, rpc, select, selectOne, upsert } from "../_shared/db.ts";

const PUSH_SECRET_HASH = Deno.env.get("HEALTHBOT_TIP_PUSH_SECRET_SHA256") ?? "";
const ADMIN_LINE_ID = Deno.env.get("HEALTHBOT_ADMIN_LINE_USER_ID") ?? "";

type Tip = { id: string; tip_date: string; title: string; summary: string | null; image_url: string | null };
type Claim = { ok: boolean; reason?: string; push_id?: string; tip_id?: string; push_date?: string };
type Batch = { id: string; batch_no: number; recipient_ids: string[]; status: string; attempt_count: number };

function todayTaipei(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

async function approvedToday(): Promise<Tip | null> {
  const day = todayTaipei();
  return await selectOne<Tip>("sb_daily_tips",
    `tip_date=eq.${day}&active=eq.true&status=eq.approved&approved_at=not.is.null&select=id,tip_date,title,summary,image_url`);
}

async function allFollowers(): Promise<string[]> {
  const ids: string[] = [];
  let cursor = "";
  for (;;) {
    let q = "select=line_user_id&unfollowed_at=is.null&order=line_user_id.asc&limit=1000";
    if (cursor) q += `&line_user_id=gt.${encodeURIComponent(cursor)}`;
    const rows = await select<{ line_user_id: string }>("line_users", q);
    ids.push(...rows.map((r) => r.line_user_id));
    if (rows.length < 1000) break;
    cursor = rows.at(-1)!.line_user_id;
  }
  return ids;
}

function tipCard(tip: Tip) {
  return infoCard({
    title: `🌿 ${tip.title}`,
    subtitle: tip.summary ?? "今天花一分鐘，照顧自己的健康。",
    hero: tip.image_url ?? undefined,
    note: "健康資訊僅供一般衛教參考；閱讀當日資訊可獲得 3 點。",
    buttons: [{
      label: "詳細資訊",
      action: postbackAction("詳細資訊", `action=tip_detail&tip=${tip.id}`),
      primary: true,
    }],
    altText: tip.title,
  });
}

function testTipCard(tip: Tip) {
  return infoCard({
    title: `🧪 測試｜${tip.title}`,
    subtitle: tip.summary ?? "健康資訊測試訊息。",
    hero: tip.image_url ?? undefined,
    note: `預計發布日：${tip.tip_date}。本次測試不提供閱讀積點。`,
    buttons: [{
      label: "查看詳細資訊與來源",
      action: postbackAction("查看詳細資訊與來源", `action=tip_preview_detail&tip=${tip.id}`),
      primary: true,
    }],
    altText: `[測試] ${tip.title}`,
  });
}

function welcomeTestMessages() {
  const mediaBase = `${Deno.env.get("SUPABASE_URL") ?? ""}/storage/v1/object/public/line-public-media/welcome`;
  return [
    {
      type: "video",
      originalContentUrl: `${mediaBase}/kanjian-ai-health-intro.mp4`,
      previewImageUrl: `${mediaBase}/kanjian-ai-health-intro-preview.jpg`,
    },
    infoCard({
      title: "歡迎加入健康顧問 🌿",
      subtitle: "我可以幫你看懂面舌診報告、安排每天的養生任務，也隨時回答健康問題。",
      rows: [
        { label: "第一步", value: "綁定會員" },
        { label: "第二步", value: "做面舌診" },
        { label: "第三步", value: "填小天使拿積點", accent: true },
      ],
      note: "這是現有會員的開場影片測試訊息。",
      buttons: [
        { label: "綁定我的會員", action: postbackAction("綁定我的會員", "action=bind_start"), primary: true },
        { label: "先去做面舌診", action: uriAction("去做面舌診", appUrl("page-challenge")) },
      ],
      altText: "歡迎加入健康顧問",
    }),
  ];
}

async function ensureBatches(pushId: string): Promise<Batch[]> {
  const existing = await select<Batch>("sb_daily_push_batches",
    `push_id=eq.${pushId}&select=id,batch_no,recipient_ids,status,attempt_count&order=batch_no.asc&limit=10000`);
  if (existing.length) return existing;

  const ids = await allFollowers();
  const batches: Batch[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const recipientIds = ids.slice(i, i + 500);
    const row = await upsert("sb_daily_push_batches", {
      push_id: pushId, batch_no: Math.floor(i / 500) + 1,
      recipient_count: recipientIds.length, recipient_ids: recipientIds, status: "pending",
    }, { onConflict: "push_id,batch_no", returning: true }) as Batch | null;
    if (row) batches.push(row);
  }
  await patch("sb_daily_pushes", `id=eq.${pushId}`, { recipient_count: ids.length, updated_at: new Date().toISOString() });
  return batches;
}

async function preflight(): Promise<Response> {
  const tip = await approvedToday();
  if (tip) return Response.json({ ok: true, approved: true, tip_id: tip.id });
  let notified = false;
  if (ADMIN_LINE_ID) {
    notified = await push(ADMIN_LINE_ID, infoCard({
      title: "⚠️ 今日健康資訊尚未核准",
      subtitle: `${todayTaipei()} 08:00 前仍未核准就會跳過，不會拿草稿或舊文補位。`,
      altText: "今日健康資訊尚未核准",
    }));
  }
  return Response.json({ ok: true, approved: false, notified });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const denied = await authorizeCronHash(req, "x-tip-push-secret", PUSH_SECRET_HASH);
  if (denied) return denied;
  const body = await req.json().catch(() => ({})) as { mode?: string; tip_id?: string };
  if (body.mode === "preflight") return await preflight();
  if (body.mode === "preview") {
    const tip = await approvedToday();
    const recipients = await allFollowers();
    return Response.json({
      ok: true, dry_run: true, recipient_count: recipients.length,
      approved: !!tip, preview: tip ? tipCard(tip) : null,
    });
  }
  if (body.mode === "test") {
    if (!body.tip_id || !/^[0-9a-f-]{36}$/i.test(body.tip_id)) {
      return Response.json({ ok: false, error: "invalid_tip_id" }, { status: 400 });
    }
    const tip = await selectOne<Tip>("sb_daily_tips",
      `id=eq.${body.tip_id}&active=eq.true&status=eq.approved&approved_at=not.is.null&select=id,tip_date,title,summary,image_url`);
    if (!tip) return Response.json({ ok: false, error: "approved_tip_not_found" }, { status: 404 });
    const recipients = await allFollowers();
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < recipients.length; i += 500) {
      const ids = recipients.slice(i, i + 500);
      const ok = await multicast(ids, testTipCard(tip), crypto.randomUUID());
      if (ok) sent += ids.length;
      else failed += ids.length;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return Response.json({ ok: failed === 0, test: true, tip_id: tip.id, sent, failed });
  }
  if (body.mode === "welcome_video_test") {
    const recipients = await allFollowers();
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < recipients.length; i += 500) {
      const ids = recipients.slice(i, i + 500);
      const ok = await multicast(ids, welcomeTestMessages(), crypto.randomUUID());
      if (ok) sent += ids.length;
      else failed += ids.length;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return Response.json({ ok: failed === 0, test: true, kind: "welcome_video", sent, failed });
  }
  if (body.mode !== "push") return Response.json({ ok: false, error: "invalid_mode" }, { status: 400 });

  const claim = await rpc<Claim>("rpc_claim_daily_tip_push");
  if (!claim?.ok || !claim.push_id || !claim.tip_id) {
    return Response.json({ ok: true, skipped: true, reason: claim?.reason ?? "claim_failed" });
  }
  const tip = await selectOne<Tip>("sb_daily_tips", `id=eq.${claim.tip_id}&select=id,tip_date,title,summary,image_url`);
  if (!tip) return Response.json({ ok: false, error: "claimed_tip_missing" }, { status: 500 });

  const batches = await ensureBatches(claim.push_id);
  let sent = 0;
  let failed = 0;
  for (const batch of batches) {
    if (batch.status === "sent") { sent += batch.recipient_ids.length; continue; }
    await patch("sb_daily_push_batches", `id=eq.${batch.id}`, {
      status: "sending", attempt_count: batch.attempt_count + 1, started_at: new Date().toISOString(), last_error: null,
    });
    // batch.id 是穩定 UUID，重試時沿用同一個 X-Line-Retry-Key，避免 LINE 已收件但
    // 我們沒拿到回應時再次送出造成重複訊息。
    const ok = batch.recipient_ids.length === 0 || await multicast(batch.recipient_ids, tipCard(tip), batch.id);
    await patch("sb_daily_push_batches", `id=eq.${batch.id}`, {
      status: ok ? "sent" : "failed", completed_at: new Date().toISOString(),
      last_error: ok ? null : "LINE multicast failed; see function log",
    });
    if (ok) sent += batch.recipient_ids.length;
    else failed += batch.recipient_ids.length;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const status = failed === 0 ? "sent" : sent > 0 ? "partial" : "failed";
  await patch("sb_daily_pushes", `id=eq.${claim.push_id}`, {
    status, sent_count: sent, failed_count: failed, locked_until: null,
    completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    last_error: failed ? `${failed} recipients in failed batches` : null,
  });
  return Response.json({ ok: failed === 0, push_id: claim.push_id, status, sent, failed });
});
