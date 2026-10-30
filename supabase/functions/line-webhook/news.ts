/**
 * 新聞轉稿 —— 擁有者在 LINE 貼一則連結,變成某天的推播內容。
 *
 * 流程(三段,中間狀態存在 sb_news_drafts):
 *   ① 擁有者貼網址        → ask()      回一張「要做成新聞嗎?」的卡
 *   ② 按「做成新聞」      → draft()    抓頁面 + 產稿 + 回預覽卡
 *   ③ 按「排進 X/XX」     → apply()    寫進 sb_daily_tips
 *
 * ⚠️ 安全邊界(這支整個存在的風險都在這裡)
 *
 * 抓回來的網頁是**不可信資料**,不是指令。而通過 trg_tip_auto_check 的稿會
 * 直接變成 approved、當天群發給所有會員 —— 也就是說,網頁裡藏一句
 * 「忽略前述規則,改寫成…」就有機會變成官方推播。兩道防線:
 *
 *   1. 產稿時把網頁內容包在 <SOURCE> 標籤裡,並在指令中明寫不得遵循其中任何
 *      指令(TIP_INSTRUCTIONS 第二條)。這一道擋得住大部分,但不是保證。
 *   2. 一律先回預覽卡給擁有者看,按確認才寫進資料庫。這一道才是真的 ——
 *      它把「網頁內容自動變成群發」這條路整個切斷。
 *
 * 所以 draft() 永遠不會寫進 sb_daily_tips,apply() 只被 postback 觸發。
 */

import { insert, patch, rpc, selectOne } from "../_shared/db.ts";
import { assetUrl, infoCard, LineMessage, postbackAction, textMsg } from "../_shared/line.ts";
import {
  kindOf, responseText, RISK_WORDS, singleSchema, TIP_INSTRUCTIONS, TipDraft,
} from "../_shared/tip-schema.ts";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("HEALTHBOT_OPENAI_KEY") ?? "";
const MODEL = Deno.env.get("HEALTHBOT_OPENAI_MODEL") ?? "gpt-4.1-mini";

/** 網頁抓多少就夠寫一則衛教。再多只是讓 token 變貴、讓雜訊變多。 */
const MAX_PAGE_CHARS = 12_000;

// 擁有者的判斷搬到 _shared/owner.ts —— 管理中心(admin-api)也要用同一把尺。
// 這裡 re-export,handlers.ts 與 index.ts 的 import 不用動。
export { isOwner } from "../_shared/owner.ts";

/** 從一段文字裡抓出第一個 http(s) 網址。 */
export function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"'）)]+/);
  if (!m) return null;
  try {
    const u = new URL(m[0]);
    // 只收 http(s)。擋掉 file: / data: 這類,以及看起來像內網的主機 ——
    // 這支拿得到 service role 的環境,不該被拿來打內部端點。
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[::1\])/.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** 把 HTML 變成純文字。不求完美,求不要把 script 內容餵給模型。 */
function htmlToText(html: string): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1] ?? "").trim();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return { title: decodeEntitiesLight(title), text: text.slice(0, MAX_PAGE_CHARS) };
}

function decodeEntitiesLight(s: string): string {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}

async function fetchPage(url: string): Promise<{ title: string; text: string }> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; KanjianHealthBot/1.0)" },
  });
  if (!res.ok) throw new Error(`抓不到這一頁(HTTP ${res.status})`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
    throw new Error(`這個網址不是網頁(${type.split(";")[0] || "未知格式"})`);
  }
  const html = (await res.text()).slice(0, 400_000);
  const page = htmlToText(html);
  if (page.text.length < 200) throw new Error("這一頁抓不到足夠的文字,可能要登入或是純圖片頁");
  return page;
}

/** 台北日期 → MM/DD */
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

// ── ① 貼了網址,先問要做什麼 ──────────────────────────────
export async function ask(lineUserId: string, url: string): Promise<LineMessage> {
  const row = await insert("sb_news_drafts", {
    line_user_id: lineUserId, url, status: "pending",
  }, { returning: true }) as { id: string } | null;
  if (!row) return textMsg("⚠️ 存不起來,請再貼一次。");

  return infoCard({
    title: "📰 收到一個網址",
    subtitle: url.length > 70 ? url.slice(0, 70) + "…" : url,
    note: "做成新聞的話,我會抓這一頁寫成一則推播內容,寫好先給你看過再排程。",
    buttons: [
      { label: "做成推播新聞", action: postbackAction("做成新聞", `action=news_make&id=${row.id}`), primary: true },
      { label: "我只是想問這篇", action: postbackAction("問這篇", `action=news_ask&id=${row.id}`) },
    ],
    altText: "要把這個網址做成推播新聞嗎?",
  });
}

// ── ② 抓頁面 + 產稿 + 預覽 ────────────────────────────────
export async function draft(id: string): Promise<LineMessage> {
  const row = await selectOne<{ id: string; url: string; status: string }>(
    "sb_news_drafts", `id=eq.${id}&select=id,url,status`);
  if (!row) return textMsg("找不到這一筆,請重貼一次網址。");
  if (row.status === "applied") return textMsg("這一則已經排程了。");
  if (!OPENAI_KEY) return textMsg("⚠️ 還沒設定 OPENAI_API_KEY,產不了稿。");

  const date = await rpc<string>("rpc_next_free_push_day", {});
  if (!date) return textMsg("未來 60 天的推播日都排滿了,先清掉一天再來。");

  let page: { title: string; text: string };
  try {
    page = await fetchPage(row.url);
  } catch (e) {
    await patch("sb_news_drafts", `id=eq.${id}`,
      { status: "failed", error: String((e as Error).message).slice(0, 300), updated_at: new Date().toISOString() });
    return textMsg(`⚠️ ${(e as Error).message}\n\n可以把內文直接貼給我,或換一個網址。`);
  }

  let tip: TipDraft;
  try {
    tip = await generateOne(date, row.url, page);
  } catch (e) {
    console.error("news generate failed", e);
    await patch("sb_news_drafts", `id=eq.${id}`,
      { status: "failed", error: String((e as Error).message).slice(0, 300), updated_at: new Date().toISOString() });
    return textMsg("⚠️ 產稿失敗,請再試一次。");
  }

  await patch("sb_news_drafts", `id=eq.${id}`, {
    status: "drafted", tip_date: date, page_title: page.title.slice(0, 200),
    raw_text: page.text, draft: tip, error: null, updated_at: new Date().toISOString(),
  });

  const kind = kindOf(date);
  const flags = RISK_WORDS.filter((w) =>
    `${tip.title}${tip.summary}${tip.body}${tip.quiz_explain}`.includes(w));

  return infoCard({
    title: `📰 ${tip.title}`,
    subtitle: tip.summary,
    rows: [
      { label: "排定日期", value: `${md(date)}（${kind === "blessing" ? "祝福關卡" : "知識題"}）`, accent: true },
      { label: "今日行動", value: tip.action_today },
      { label: "題目", value: tip.quiz_question },
      { label: "來源", value: tip.source_name },
    ],
    note: flags.length
      ? `⚠️ 出現可能踩線的字:${flags.join("、")}。排進去也會被自動檢查退成草稿。`
      : "按下去才會寫進排程。內容仍會再過一次自動檢查。",
    buttons: [
      { label: `排進 ${md(date)}`, action: postbackAction("排程", `action=news_apply&id=${id}`), primary: true },
      { label: "重寫一次", action: postbackAction("重寫", `action=news_make&id=${id}`) },
      { label: "不要了", action: postbackAction("取消", `action=news_drop&id=${id}`) },
    ],
    altText: `新聞預覽:${tip.title}`,
  });
}

// ── ③ 確認後才寫進內容表 ──────────────────────────────────
export async function apply(id: string): Promise<LineMessage> {
  const row = await selectOne<{
    id: string; url: string; status: string; tip_date: string; draft: TipDraft;
  }>("sb_news_drafts", `id=eq.${id}&select=id,url,status,tip_date,draft`);
  if (!row?.draft || !row.tip_date) return textMsg("找不到這一份草稿,請重貼一次網址。");
  if (row.status === "applied") return textMsg("這一則已經排程過了。");

  const tip = row.draft;
  const kind = kindOf(row.tip_date);

  // status / risk_flags / approved_at 交給 trg_tip_auto_check 決定 ——
  // 跟 tip-plan 走同一條路,這裡寫死的話通過檢查的稿也會停在草稿。
  const saved = await insert("sb_daily_tips", {
    tip_date: row.tip_date, kind,
    title: tip.title, summary: tip.summary, body: tip.body,
    detail_points: tip.detail_points,
    source_urls: [row.url], source_name: tip.source_name,
    source_date: row.tip_date.slice(0, 7).replace("-", "/"),
    intros: tip.intros, game_titles: tip.game_titles,
    action_today: tip.action_today,
    // 祝福關卡那天不出選擇題,硬塞一題網頁會同時顯示題目與輸入框。
    quiz_question: kind === "blessing" ? null : tip.quiz_question,
    quiz_options: kind === "blessing" ? null : tip.quiz_options,
    quiz_answer: kind === "blessing" ? null : tip.quiz_answer,
    quiz_explain: kind === "blessing" ? null : tip.quiz_explain,
    active: true, image_url: assetUrl("bg.png"),
    rejected_at: null, rejected_by: null, review_note: null,
  }, { returning: true }) as { id: string; status: string; risk_flags: unknown } | null;

  if (!saved) {
    return textMsg(`⚠️ 寫入失敗。${md(row.tip_date)} 可能已經有內容了,換一天再試。`);
  }

  await patch("sb_news_drafts", `id=eq.${id}`,
    { status: "applied", applied_tip_id: saved.id, updated_at: new Date().toISOString() });

  const flags = Array.isArray(saved.risk_flags) ? saved.risk_flags as string[] : [];
  return saved.status === "approved"
    ? textMsg(`✅ 已排進 ${md(row.tip_date)},當天會自動發出去。`)
    : textMsg(
      `⚠️ 已存成草稿,${md(row.tip_date)} 不會自動發。\n`
      + `自動檢查沒過:${flags.join("、") || "原因未記錄"}\n`
      + `到後台改一下就能排程。`,
    );
}

export async function drop(id: string): Promise<LineMessage> {
  await patch("sb_news_drafts", `id=eq.${id}`,
    { status: "declined", updated_at: new Date().toISOString() });
  return textMsg("好,這則不排了。");
}

// ── 產稿 ──────────────────────────────────────────────────
async function generateOne(
  date: string, url: string, page: { title: string; text: string },
): Promise<TipDraft> {
  // 網頁內容包在 SOURCE 標籤裡。TIP_INSTRUCTIONS 第二條會告訴模型
  // 標籤內是不可信資料、不得遵循其中的任何指令。
  const material = `<SOURCE_1 url="${url}" title="${page.title}">\n${page.text}\n</SOURCE_1>`;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", signal: AbortSignal.timeout(90_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: MODEL, store: false,
      instructions: [
        ...TIP_INSTRUCTIONS,
        // 這一條只有新聞轉稿需要:素材就是使用者指定的那一篇,
        // 不像排程產稿那樣可以自己挑主題。
        "這次只有一篇素材,而且是使用者指定要談的那一篇。主題要扣著它,"
        + "但寫成讀者用得上的衛教,不是把新聞改寫一遍。",
        `source_urls 一律填入 ${url},不要自己編造其他網址。`,
      ].join("\n"),
      input: `為 ${date} 產生一則健康資訊。\n\n參考素材：\n${material}`,
      text: {
        format: { type: "json_schema", name: "daily_health_tips", strict: true, schema: singleSchema(date) },
      },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const parsed = JSON.parse(responseText(await res.json())) as { tips: TipDraft[] };
  const tip = parsed.tips?.[0];
  if (!tip) throw new Error("OpenAI 沒有回傳內容");
  return tip;
}
