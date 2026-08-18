// LINE AI 健康顧問 Bot — 主 webhook
//
// 部署(facialmonitor 專案 wcemkmwrlvijxxwybrgs):
//   supabase link --project-ref wcemkmwrlvijxxwybrgs
//   supabase functions deploy line-webhook --no-verify-jwt
//     ↑ LINE 不會帶 Supabase JWT,一定要關掉 JWT 驗證
//
// Webhook URL:
//   https://wcemkmwrlvijxxwybrgs.supabase.co/functions/v1/line-webhook
//
// 需要的 secrets(這個專案跑多套 App,一律加 HEALTHBOT_ 前綴避免撞名):
//   HEALTHBOT_LINE_SECRET / HEALTHBOT_LINE_TOKEN / HEALTHBOT_APP_URL
//   HEALTHBOT_ANTHROPIC_KEY(可退回專案既有的 ANTHROPIC_API_KEY)

import {
  appUrl, getProfile, infoCard, LineMessage, postbackAction, reply, textMsg,
  uriAction, verifySignature,
} from "../_shared/line.ts";
import { chat, summarize } from "../_shared/claude.ts";
import { insert, patch, rpc, selectOne } from "../_shared/db.ts";
import {
  bindMember, getConversation, getOrCreateLineUser, isAiPaused, LIMITS,
  loadHistory, loadMemberContext, LineUser, messageCount, saveMessage,
} from "./member.ts";
import { handlePostback, helpCard } from "./handlers.ts";

// ── 歡迎訊息 ───────────────────────────────────────────────
function welcomeCard(name?: string): LineMessage {
  return infoCard({
    title: `${name ? name + ",歡" : "歡"}迎加入健康顧問 🌿`,
    subtitle: "我可以幫你看懂面舌診報告、安排每天的養生任務,也隨時回答健康問題。",
    rows: [
      { label: "第一步", value: "綁定會員" },
      { label: "第二步", value: "做面舌診" },
      { label: "第三步", value: "填小天使拿積點", accent: true },
    ],
    note: "有會員碼的話,直接傳「綁定 1234567」給我就好。",
    buttons: [
      { label: "綁定我的會員", action: postbackAction("綁定我的會員", "action=bind_start"), primary: true },
      { label: "先去做面舌診", action: uriAction("去做面舌診", appUrl("page-challenge")) },
    ],
    altText: "歡迎加入健康顧問",
  });
}

// ── 文字指令(先於 AI 比對) ────────────────────────────────
async function handleCommand(u: LineUser, text: string): Promise<LineMessage | LineMessage[] | null> {
  const t = text.trim();

  // 綁定 1234567
  const bind = t.match(/^綁定\s*(\d{7})$/);
  if (bind) {
    const r = await bindMember(u.line_user_id, bind[1]);
    if (!r.ok) return textMsg(`⚠️ ${r.message}`);

    // 綁定後 u 手上的 sb_user_id 還是舊的,重讀一次再產獎勵卡
    const bound: LineUser = { ...u, sb_user_id: await resolveSbUserId(u.line_user_id), bind_status: "bound" };
    const card = await handlePostback(bound, "my_reward", new URLSearchParams());
    const msgs: LineMessage[] = [
      textMsg(`✅ ${r.message}!接下來可以用下方選單查報告、每日打卡。`),
    ];
    if (card) msgs.push(...(Array.isArray(card) ? card : [card]));
    return msgs;
  }
  if (/^綁定/.test(t)) {
    return textMsg("格式是「綁定」加上 7 位會員碼,例如:綁定 1234567");
  }

  // 小天使 1234567
  const angel = t.match(/^小天使\s*(\d{7})$/);
  if (angel) {
    if (!u.sb_user_id) return await handlePostback(u, "bind_start", new URLSearchParams());
    const r = await rpc<{ ok: boolean; message: string; angel_name?: string; balance?: number }>(
      "rpc_bind_angel", { p_code: angel[1], p_user_id: u.sb_user_id, p_source: "line" });
    if (!r?.ok) return textMsg(`⚠️ ${r?.message ?? "設定失敗,請稍後再試。"}`);
    return infoCard({
      title: "👼 小天使認定完成",
      rows: [
        { label: "你的小天使", value: r.angel_name ?? "—" },
        { label: "積點餘額", value: `${r.balance ?? 0} 點`, accent: true },
      ],
      note: "完成第一次面舌診之後,你的小天使也會拿到積點。",
      altText: "小天使認定完成",
    });
  }
  if (/^小天使/.test(t)) {
    return textMsg("格式是「小天使」加上對方的 7 位推薦碼,例如:小天使 1234567");
  }

  // 兌換 1234567
  const code = t.match(/^兌換\s*(\d{7})$/);
  if (code) {
    if (!u.sb_user_id) return await handlePostback(u, "bind_start", new URLSearchParams());
    const r = await rpc<{ ok: boolean; message?: string; credits_added?: number; credits?: number }>(
      "rpc_redeem_health_code", { p_code: code[1], p_user_id: u.sb_user_id });
    if (!r?.ok) return textMsg(`⚠️ ${r?.message ?? "兌換失敗。"}`);
    return textMsg(`✅ 已增加 ${r.credits_added} 次檢測,目前共 ${r.credits} 次。`);
  }
  if (/^兌換$/.test(t)) {
    return textMsg("把兌換碼接在後面就行,例如:兌換 1234567");
  }

  if (/^(積點|點數)$/.test(t)) return await handlePostback(u, "my_reward", new URLSearchParams());
  if (/^(次數|剩餘次數)$/.test(t)) return await handlePostback(u, "credits", new URLSearchParams());
  if (/^(檢測|面舌診|面舌診檢測)$/.test(t)) return await handlePostback(u, "start_scan", new URLSearchParams());
  if (/^(打卡|每日打卡)$/.test(t)) return await handlePostback(u, "daily_checkin", new URLSearchParams());
  if (/^(分數|我的分數)$/.test(t)) return await handlePostback(u, "score_latest", new URLSearchParams());
  if (/^(推薦碼|我的推薦碼|分享)$/.test(t)) return await handlePostback(u, "share_invite", new URLSearchParams());
  if (/^(任務|今日任務)$/.test(t)) return await handlePostback(u, "task_today", new URLSearchParams());
  if (/^(說明|使用說明|help)$/i.test(t)) return helpCard();

  if (/^(真人|客服|轉專員)$/.test(t)) {
    const until = new Date(Date.now() + 30 * 60_000).toISOString();
    await patch("line_users", `line_user_id=eq.${encodeURIComponent(u.line_user_id)}`, {
      ai_paused_until: until,
    });
    return textMsg("好的,接下來 30 分鐘我先不回覆,由專員與你聯繫 🙋\n想讓我回來的話,傳「AI」給我就好。");
  }

  if (/^(ai|AI|回來)$/.test(t)) {
    await patch("line_users", `line_user_id=eq.${encodeURIComponent(u.line_user_id)}`, {
      ai_paused_until: null,
    });
    return textMsg("我回來了 🌿 有什麼健康問題都可以問我。");
  }

  return null;
}

async function resolveSbUserId(lineUserId: string): Promise<string | null> {
  const row = await selectOne<{ sb_user_id: string | null }>(
    "line_users", `line_user_id=eq.${encodeURIComponent(lineUserId)}&select=sb_user_id`);
  return row?.sb_user_id ?? null;
}

// ── AI 對話 ───────────────────────────────────────────────
async function handleAi(u: LineUser, text: string, lineMessageId: string): Promise<LineMessage | null> {
  const conv = await getConversation(u.line_user_id);

  // 同一則 message id 寫不進去 = LINE 重送,直接跳過不重複回覆
  const fresh = await saveMessage({
    conversationId: conv.id,
    lineUserId: u.line_user_id,
    role: "user",
    content: text,
    lineMessageId,
  });
  if (!fresh) {
    console.log("duplicate message, skipped:", lineMessageId);
    return null;
  }

  const [history, ctx] = await Promise.all([
    loadHistory(conv.id),
    loadMemberContext(u),
  ]);

  const answer = await chat(history, conv.summary, ctx);

  await saveMessage({
    conversationId: conv.id,
    lineUserId: u.line_user_id,
    role: "assistant",
    content: answer,
  });

  // 對話變長就壓縮成摘要,控制 token
  if (await messageCount(conv.id) > LIMITS.SUMMARIZE_AFTER) {
    const summary = await summarize(history, conv.summary);
    if (summary) await patch("line_conversations", `id=eq.${conv.id}`, { summary });
  }

  return textMsg(answer);
}

// ── 事件分派 ───────────────────────────────────────────────
async function handleEvent(event: Record<string, unknown>): Promise<void> {
  const source = event.source as { type?: string; userId?: string } | undefined;
  const lineUserId = source?.userId;
  const replyToken = event.replyToken as string | undefined;

  // 這個帳號只服務一對一聊天;群組事件忽略
  if (!lineUserId || source?.type !== "user") return;

  const type = event.type as string;

  // reply token 只能用一次、只活 30 秒,失敗時光看「Invalid reply token」
  // 分不出是「過期」還是「重送導致重複使用」。把延遲與 event id 印出來:
  //   lag 破 30000 → 過期;lag 很小但 eventId 重複 → LINE 重送。
  const isRedelivery = (event.deliveryContext as { isRedelivery?: boolean })?.isRedelivery === true;
  console.log(JSON.stringify({
    tag: "event",
    type,
    eventId: event.webhookEventId ?? null,
    redelivery: isRedelivery,
    lagMs: typeof event.timestamp === "number" ? Date.now() - event.timestamp : null,
    token8: replyToken ? replyToken.slice(0, 8) : null,
  }));

  // 重送的事件,token 一定是已經用掉的那顆,再回一次只會拿到 400。
  // 該做的副作用(記 log、更新 tab)在第一次就做完了,直接放掉。
  if (isRedelivery) return;

  if (type === "unfollow") {
    await patch("line_users", `line_user_id=eq.${encodeURIComponent(lineUserId)}`, {
      unfollowed_at: new Date().toISOString(),
    });
    return;
  }

  if (type === "follow") {
    const profile = await getProfile(lineUserId);
    const u = await getOrCreateLineUser(lineUserId, profile);
    await patch("line_users", `line_user_id=eq.${encodeURIComponent(lineUserId)}`, {
      unfollowed_at: null,
    });
    if (replyToken) await reply(replyToken, welcomeCard(u.display_name ?? profile?.displayName));
    return;
  }

  const u = await getOrCreateLineUser(lineUserId);

  if (type === "postback") {
    const raw = (event.postback as { data?: string })?.data ?? "";
    const params = new URLSearchParams(raw);
    const action = params.get("action") ?? "";
    const tab = params.get("tab");

    await insert("line_postback_logs", {
      line_user_id: lineUserId,
      action,
      tab_key: tab,
      payload: { data: raw },
    });
    if (tab) {
      await patch("line_users", `line_user_id=eq.${encodeURIComponent(lineUserId)}`, {
        current_tab: tab,
      });
    }

    const msg = await handlePostback(u, action, params);
    if (msg && replyToken) await reply(replyToken, msg);
    return;
  }

  if (type !== "message") return;

  const message = event.message as { type?: string; text?: string; id?: string };
  if (message?.type !== "text" || !replyToken) return;

  const text = (message.text ?? "").trim();
  if (!text) return;

  const cmd = await handleCommand(u, text);
  if (cmd) {
    await reply(replyToken, cmd);
    return;
  }

  // 轉真人期間 AI 不插嘴,但訊息仍要留底
  if (isAiPaused(u)) {
    const conv = await getConversation(lineUserId);
    await saveMessage({
      conversationId: conv.id,
      lineUserId,
      role: "user",
      content: text,
      lineMessageId: message.id ?? null,
    });
    return;
  }

  const answer = await handleAi(u, text, message.id ?? "");
  if (answer) await reply(replyToken, answer);
}

// ── 入口 ──────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  // 驗簽必須用原始 bytes,先讀成字串再 parse
  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";

  if (!(await verifySignature(rawBody, signature))) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: { events?: Record<string, unknown>[] };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("bad request", { status: 400 });
  }

  // 個別事件失敗不影響整體回 200
  const work = Promise.all(
    (payload.events ?? []).map((e) =>
      handleEvent(e).catch((err) => console.error("handleEvent error:", err))
    ),
  );

  // 先回 200,處理丟到背景跑。
  //
  // 這裡不能等 —— 一則 postback 要查 DB、寫 log、再打一次 LINE reply,
  // 加起來 2~4 秒,LINE 等不到回應就判定逾時,隔約 60 秒重送同一則事件。
  // 重送帶的是「已經用掉的」reply token,只會換來 400 Invalid reply token,
  // 而且每重送一次就多一筆重複的 postback log。實測 17:36 那次就是這樣連環重送三次。
  const waitUntil = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
    .EdgeRuntime?.waitUntil;
  if (waitUntil) {
    waitUntil.call((globalThis as { EdgeRuntime?: unknown }).EdgeRuntime, work);
  } else {
    await work;   // 本機或非 Supabase 環境沒有 waitUntil,退回同步等待
  }

  return new Response("ok", { status: 200 });
});
