import { authorizeCronHash } from "../_shared/cron-auth.ts";
import { appUrl, infoCard, multicast, postbackAction, push, uriAction } from "../_shared/line.ts";
import { patch, rpc, select, selectOne, upsert } from "../_shared/db.ts";

const PUSH_SECRET_HASH = Deno.env.get("HEALTHBOT_TIP_PUSH_SECRET_SHA256") ?? "";
const ADMIN_LINE_ID = Deno.env.get("HEALTHBOT_ADMIN_LINE_USER_ID") ?? "";
const LIFF_ID = Deno.env.get("HEALTHBOT_LIFF_ID") ?? "2011132698-FNcAIg39";
// 每日挑戰的半頁式 LIFF(challenge.html)。卡片上的按鈕直接開它,
// 不再走 postback 出題 —— 題目與內容都在網頁裡。
const CHALLENGE_LIFF_URL = Deno.env.get("HEALTHBOT_CHALLENGE_LIFF_URL")
  ?? `https://liff.line.me/${LIFF_ID}`;
const TONES = ["zhou", "kang", "xs"] as const;
type Tone = typeof TONES[number];

function liffUrl(page: string): string {
  return LIFF_ID ? `https://liff.line.me/${LIFF_ID}?p=${page}` : appUrl(page);
}

type Tip = {
  id: string; tip_date: string; title: string; summary: string | null;
  image_url: string | null; kind: string;
  intros: Record<string, string>; game_titles: Record<string, string>;
};
type Claim = { ok: boolean; reason?: string; push_id?: string; tip_id?: string; push_date?: string };
type Batch = { id: string; batch_no: number; recipient_ids: string[]; status: string; attempt_count: number; tone: string | null };

function todayTaipei(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

async function approvedToday(): Promise<Tip | null> {
  const day = todayTaipei();
  return await selectOne<Tip>("sb_daily_tips",
    `tip_date=eq.${day}&active=eq.true&status=eq.approved&approved_at=not.is.null&select=id,tip_date,title,summary,image_url,kind,intros,game_titles`);
}

type Follower = { line_user_id: string; sb_users: { tone: string | null } | null };

async function allFollowerRows(): Promise<Follower[]> {
  const rows: Follower[] = [];
  let cursor = "";
  for (;;) {
    // 語氣存在 sb_users,靠 line_users.sb_user_id 的 FK 一起撈回來,
    // 不要為了三種語氣掃三次表。
    let q = "select=line_user_id,sb_users(tone)&unfollowed_at=is.null"
          + "&order=line_user_id.asc&limit=1000";
    if (cursor) q += `&line_user_id=gt.${encodeURIComponent(cursor)}`;
    const page = await select<Follower>("line_users", q);
    rows.push(...page);
    if (page.length < 1000) break;
    cursor = page.at(-1)!.line_user_id;
  }
  return rows;
}

async function allFollowers(): Promise<string[]> {
  return (await allFollowerRows()).map((r) => r.line_user_id);
}

/** 依語氣分組。沒設定、設錯、沒綁帳號一律歸到周小輪。 */
async function followersByTone(): Promise<Record<Tone, string[]>> {
  const groups: Record<Tone, string[]> = { zhou: [], kang: [], xs: [] };
  for (const r of await allFollowerRows()) {
    const t = r.sb_users?.tone as Tone | undefined;
    groups[t && TONES.includes(t) ? t : "zhou"].push(r.line_user_id);
  }
  return groups;
}

/**
 * 早上那張卡。
 *
 * 標題 = 今日主題 + 這個語氣的遊戲標題;開場白 = 這個語氣的那一版。
 * 三版都是週日產稿時一起寫進資料庫的,這裡只挑,不呼叫 AI ——
 * 推播是 500 人一批的定時作業,現場生成等於把 LLM 的延遲押在發送時間上。
 */
function tipCard(tip: Tip, tone: Tone = "zhou") {
  const gameTitle = tip.game_titles?.[tone] ?? tip.game_titles?.zhou ?? "今日挑戰";
  const intro = tip.intros?.[tone] ?? tip.intros?.zhou
    ?? "今天花一分鐘,照顧自己的健康。";
  const isBlessing = tip.kind === "blessing";
  return infoCard({
    title: `${isBlessing ? "💚" : "🌿"} ${tip.title}｜${gameTitle}`,
    subtitle: intro,
    hero: tip.image_url ?? undefined,
    note: isBlessing
      ? "寫一句祝福就算完成,可獲得 3 點。"
      : "先看今天的主題,滑到下面答一題。答對可獲得 3 點。",
    buttons: [{
      label: isBlessing ? "去寫一句祝福" : "開始今日挑戰",
      action: uriAction("開始今日挑戰", CHALLENGE_LIFF_URL),
      primary: true,
    }],
    altText: `${tip.title}｜${gameTitle}`,
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
        { label: "第一步", value: "開啟 App，自動綁定" },
        { label: "第二步", value: "做面舌診" },
        { label: "第三步", value: "申請 14 天健康挑戰", accent: true },
      ],
      note: "這是現有會員的開場影片測試訊息。",
      buttons: [
        { label: "開啟 App 並自動綁定", action: uriAction("開啟 App", liffUrl("page-main")), primary: true },
        { label: "先去做面舌診", action: uriAction("去做面舌診", liffUrl("page-challenge")) },
      ],
      altText: "歡迎加入健康顧問",
    }),
  ];
}

/**
 * 分批。語氣不同卡片就不同,所以先依語氣分組,各自切 500 人一批。
 * 語氣寫進 batch,重試時才會用同一張卡 —— 不然重送會換一個人說話。
 */
async function ensureBatches(pushId: string): Promise<Batch[]> {
  const existing = await select<Batch>("sb_daily_push_batches",
    `push_id=eq.${pushId}&select=id,batch_no,recipient_ids,status,attempt_count,tone&order=batch_no.asc&limit=10000`);
  if (existing.length) return existing;

  const groups = await followersByTone();
  const batches: Batch[] = [];
  let no = 0;
  let total = 0;
  for (const tone of TONES) {
    const ids = groups[tone];
    total += ids.length;
    for (let i = 0; i < ids.length; i += 500) {
      const recipientIds = ids.slice(i, i + 500);
      no += 1;
      const row = await upsert("sb_daily_push_batches", {
        push_id: pushId, batch_no: no, tone,
        recipient_count: recipientIds.length, recipient_ids: recipientIds, status: "pending",
      }, { onConflict: "push_id,batch_no", returning: true }) as Batch | null;
      if (row) batches.push(row);
    }
  }
  await patch("sb_daily_pushes", `id=eq.${pushId}`, { recipient_count: total, updated_at: new Date().toISOString() });
  return batches;
}

type Stock = {
  ok: boolean; days_left: number; today_ready: boolean; should_alert: boolean;
  blocked: { date: string; title: string; flags: string[] }[];
};

/**
 * 每天 07:30 的預檢。
 *
 * v2 拿掉人工審核之後,管理者不再每天登入巡邏,靠這則提醒進來:
 * 存量 ≤ 4 天就推一次,4/3/2/1 天各提醒一次(愈少愈急,不會提醒一次就安靜)。
 */
async function preflight(): Promise<Response> {
  const stock = await rpc<Stock>("rpc_tip_stock");
  const days = stock?.days_left ?? 0;
  const blocked = stock?.blocked ?? [];
  let notified = false;

  if (ADMIN_LINE_ID && (stock?.should_alert || !stock?.today_ready)) {
    const rows = [
      { label: "還有幾天有稿", value: `${days} 天`, accent: days <= 2 },
      { label: "今天", value: stock?.today_ready ? "已排定" : "缺稿", accent: !stock?.today_ready },
    ];
    // 被自動檢查擋下來的那幾天要講出來,不然沒人知道存量為什麼在掉
    for (const b of blocked.slice(0, 3)) {
      rows.push({ label: b.date, value: `擋下:${(b.flags ?? []).join("、") || "未通過檢查"}`, accent: false });
    }
    notified = await push(ADMIN_LINE_ID, infoCard({
      title: stock?.today_ready ? "📉 每日挑戰存量偏低" : "⚠️ 今天沒有排定的挑戰",
      subtitle: stock?.today_ready
        ? "稿快用完了,補一批進去。"
        : `${todayTaipei()} 沒有可發的內容,08:00 會跳過,不會拿草稿或舊文補位。`,
      rows,
      note: "存量 4 天以內每天都會提醒一次。",
      altText: "每日挑戰存量提醒",
    }));
  }

  return Response.json({
    ok: true, approved: !!stock?.today_ready, days_left: days,
    blocked: blocked.length, notified,
  });
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
      `id=eq.${body.tip_id}&active=eq.true&status=eq.approved&approved_at=not.is.null&select=id,tip_date,title,summary,image_url,kind,intros,game_titles`);
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
  const tip = await selectOne<Tip>("sb_daily_tips", `id=eq.${claim.tip_id}&select=id,tip_date,title,summary,image_url,kind,intros,game_titles`);
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
    const tone = (TONES as readonly string[]).includes(batch.tone ?? "")
      ? batch.tone as Tone : "zhou";
    const ok = batch.recipient_ids.length === 0
      || await multicast(batch.recipient_ids, tipCard(tip, tone), batch.id);
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
