// LINE Messaging API 共用模組
// 驗簽與 reply 的作法移植自 mainwork/line-translate-bot(已在正式環境驗過)。

// 這個 Supabase 專案同時跑好幾套 App(smr_ / curve_ / wfa_ / analyze),
// 通用名稱如 LINE_CHANNEL_SECRET 已經被其他系統佔用,所以一律加 HEALTHBOT_ 前綴。
//
// 刻意不做「新名稱找不到就退回舊名稱」的 fallback:
// 舊名稱指向的是別套系統的憑證,萬一退回去,這個 bot 會拿別人的 token
// 去回覆訊息 —— 用錯 LINE 帳號發話比直接失敗糟糕得多。
// 沒設好就讓它 fail closed(驗簽一律失敗回 401)。
export const LINE_CHANNEL_SECRET = Deno.env.get("HEALTHBOT_LINE_SECRET") ?? "";
export const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("HEALTHBOT_LINE_TOKEN") ?? "";
export const APP_BASE_URL = (Deno.env.get("HEALTHBOT_APP_URL") ?? "").replace(/\/$/, "");

const API = "https://api.line.me/v2/bot";
const encoder = new TextEncoder();

// ── 配色(取自 App 背景底圖 bg.png) ──────────────────────────
export const C = {
  bg: "#F7F2EA",
  bgAlt: "#EDE5D6",
  arch: "#C9A876",
  gold: "#C49A5A",
  goldPale: "#F0E4CC",
  green: "#4A6B3F",
  textDark: "#2E2418",
  textMid: "#6B5840",
  textSoft: "#A8916F",
  alert: "#C46A5A",
};

// ── 簽章驗證(HMAC-SHA256 → base64) ────────────────────────
export async function verifySignature(rawBody: string, signature: string): Promise<boolean> {
  if (!LINE_CHANNEL_SECRET || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(LINE_CHANNEL_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  // 長度不同直接 false,避免比對時拋錯
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

// ── 送訊息 ────────────────────────────────────────────────
async function post(path: string, body: unknown): Promise<Response> {
  return await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

export type LineMessage = Record<string, unknown>;

export function textMsg(text: string): LineMessage {
  return { type: "text", text: text.slice(0, 5000) }; // LINE 單則上限 5000 字
}

export async function reply(replyToken: string, messages: LineMessage | LineMessage[]) {
  const list = Array.isArray(messages) ? messages : [messages];
  const res = await post("/message/reply", {
    replyToken,
    messages: list.slice(0, 5), // 一次最多 5 則
  });
  if (!res.ok) console.error("reply failed:", res.status, await res.text());
}

// push 與 multicast 會計費,只在群發與結算通知用。
export async function push(to: string, messages: LineMessage | LineMessage[]) {
  const list = Array.isArray(messages) ? messages : [messages];
  const res = await post("/message/push", { to, messages: list.slice(0, 5) });
  if (!res.ok) console.error("push failed:", res.status, await res.text());
  return res.ok;
}

export async function multicast(to: string[], messages: LineMessage | LineMessage[]) {
  const list = Array.isArray(messages) ? messages : [messages];
  const res = await post("/message/multicast", { to: to.slice(0, 500), messages: list.slice(0, 5) });
  if (!res.ok) console.error("multicast failed:", res.status, await res.text());
  return res.ok;
}

export async function broadcast(messages: LineMessage | LineMessage[]) {
  const list = Array.isArray(messages) ? messages : [messages];
  const res = await post("/message/broadcast", { messages: list.slice(0, 5) });
  if (!res.ok) console.error("broadcast failed:", res.status, await res.text());
  return res.ok;
}

export async function getProfile(userId: string): Promise<
  { displayName?: string; pictureUrl?: string } | null
> {
  try {
    const res = await fetch(`${API}/profile/${userId}`, {
      headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Flex 元件 ─────────────────────────────────────────────
type Btn = { label: string; action: LineMessage; primary?: boolean };

export function button({ label, action, primary = false }: Btn): LineMessage {
  return {
    type: "button",
    style: primary ? "primary" : "secondary",
    height: "sm",
    color: primary ? C.gold : C.goldPale,
    action: { ...action, label: label.slice(0, 20) },
  };
}

export function uriAction(label: string, uri: string) {
  return { type: "uri", label, uri };
}

export function postbackAction(label: string, data: string, displayText?: string) {
  return { type: "postback", label, data, displayText };
}

/** 標準資訊卡:標題 + 若干行「左標籤 / 右數值」+ 按鈕 */
export function infoCard(opts: {
  title: string;
  subtitle?: string;
  rows?: { label: string; value: string; accent?: boolean }[];
  hero?: string;
  bigValue?: string;
  bigLabel?: string;
  note?: string;
  buttons?: Btn[];
  altText?: string;
}): LineMessage {
  const body: LineMessage[] = [
    { type: "text", text: opts.title, weight: "bold", size: "lg", color: C.textDark, wrap: true },
  ];

  if (opts.subtitle) {
    body.push({
      type: "text", text: opts.subtitle, size: "sm",
      color: C.textMid, wrap: true, margin: "sm",
    });
  }

  if (opts.bigValue) {
    body.push({
      type: "box", layout: "vertical", margin: "lg", spacing: "none",
      backgroundColor: C.goldPale, cornerRadius: "md", paddingAll: "12px",
      contents: [
        { type: "text", text: opts.bigValue, size: "xxl", weight: "bold", color: C.gold, align: "center" },
        ...(opts.bigLabel
          ? [{ type: "text", text: opts.bigLabel, size: "xs", color: C.textSoft, align: "center" }]
          : []),
      ],
    });
  }

  if (opts.rows?.length) {
    body.push({
      type: "box", layout: "vertical", margin: "lg", spacing: "sm",
      contents: opts.rows.map((r) => ({
        type: "box", layout: "horizontal",
        contents: [
          { type: "text", text: r.label, size: "sm", color: C.textMid, flex: 3, wrap: true },
          {
            type: "text", text: r.value, size: "sm", flex: 2, align: "end",
            weight: "bold", color: r.accent ? C.green : C.textDark, wrap: true,
          },
        ],
      })),
    });
  }

  if (opts.note) {
    body.push({
      type: "text", text: opts.note, size: "xs",
      color: C.textSoft, wrap: true, margin: "md",
    });
  }

  const bubble: Record<string, unknown> = {
    type: "bubble",
    body: { type: "box", layout: "vertical", backgroundColor: C.bg, paddingAll: "18px", contents: body },
    styles: { body: { backgroundColor: C.bg }, footer: { backgroundColor: C.bg } },
  };

  if (opts.hero) {
    bubble.hero = { type: "image", url: opts.hero, size: "full", aspectRatio: "20:13", aspectMode: "cover" };
  }

  if (opts.buttons?.length) {
    bubble.footer = {
      type: "box", layout: "vertical", spacing: "sm",
      backgroundColor: C.bg, paddingAll: "14px",
      contents: opts.buttons.map(button),
    };
  }

  return { type: "flex", altText: (opts.altText ?? opts.title).slice(0, 400), contents: bubble };
}

export function carousel(bubbles: LineMessage[], altText: string): LineMessage {
  return {
    type: "flex",
    altText: altText.slice(0, 400),
    contents: { type: "carousel", contents: bubbles.slice(0, 12) },
  };
}

/** 從 infoCard 取出 bubble,好塞進 carousel */
export function toBubble(flex: LineMessage): LineMessage {
  return (flex as { contents: LineMessage }).contents;
}

/** 扣點類動作一律二次確認,避免誤觸 */
export function confirmCard(opts: {
  title: string; body: string; confirmLabel: string; confirmData: string;
}): LineMessage {
  return infoCard({
    title: opts.title,
    subtitle: opts.body,
    buttons: [
      { label: opts.confirmLabel, action: postbackAction(opts.confirmLabel, opts.confirmData), primary: true },
      { label: "先不要", action: postbackAction("先不要", "action=noop") },
    ],
    altText: opts.title,
  });
}

export function appUrl(hash: string): string {
  return `${APP_BASE_URL}/index.html#${hash}`;
}
