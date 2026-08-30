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

// ── 配色(照品牌指南「看·健」) ────────────────────────────
// 六個品牌色 + 兩個補色。補的兩個有明確理由:
//   pale     卡片內區塊需要一個很淡的底,品牌沒給,由健康青調淡而來
//   textMid  藍灰 #8FA3B8 放在白底上對比只有 2.5:1,當內文會看不清楚,
//            所以內文用一個帶藍調的深灰;藍灰只留給小字提示
export const C = {
  bg:       "#FFFFFF",   // 純白 — 純淨、清晰、透明
  bgAlt:    "#E6ECF1",   // 淺灰 — 中性、簡約、協調
  deep:     "#0D5C63",   // 深海青 — 專業、穩重、信任
  primary:  "#22C1C3",   // 健康青 — 活力、科技、成長
  tech:     "#4DA3E5",   // 科技藍 — 智慧、創新、可靠
  pale:     "#E6F7F8",   // 健康青淡底(補)
  textDark: "#0D5C63",
  textMid:  "#41565F",   // 內文(補)
  textSoft: "#526B75",   // 深藍灰 — 小字也維持可讀對比
  surface:  "#F1F7F5",   // 淡青底 — 區分卡片與內容區
  border:   "#D8E6E2",
  deepEnd:  "#13757A",
  alert:    "#D9534F",
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
async function post(path: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      ...extraHeaders,
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

export async function multicast(to: string[], messages: LineMessage | LineMessage[], retryKey?: string) {
  const list = Array.isArray(messages) ? messages : [messages];
  const res = await post(
    "/message/multicast",
    { to: to.slice(0, 500), messages: list.slice(0, 5) },
    retryKey ? { "X-Line-Retry-Key": retryKey } : {},
  );
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
// tone 是給「同一張卡上有多個按鈕、但重要性不同」用的深淺階梯:
//   deep   深海青底白字 — 最想讓人按的那個
//   mid    健康青底白字 — 次要(等同舊的 primary)
//   soft   健康青淡底深字 — 最後一個選項
// 不給 tone 就照舊看 primary,既有的卡片不用改。
type Tone = "deep" | "mid" | "soft";
type Btn = { label: string; action: LineMessage; primary?: boolean; tone?: Tone };

const TONE_STYLE: Record<Tone, { style: string; color: string }> = {
  deep: { style: "primary",   color: C.deep },
  mid:  { style: "primary",   color: "#16787B" },
  soft: { style: "secondary", color: C.pale },
};

export function button({ label, action, primary = false, tone }: Btn): LineMessage {
  const t = tone
    ? TONE_STYLE[tone]
    : { style: primary ? "primary" : "secondary", color: primary ? C.deep : C.pale };
  return {
    type: "button",
    style: t.style,
    height: "sm",
    color: t.color,
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
  const body: LineMessage[] = [];

  if (opts.subtitle) {
    body.push({
      type: "text", text: opts.subtitle, size: "sm",
      color: C.textMid, wrap: true,
    });
  }

  if (opts.bigValue) {
    body.push({
      type: "box", layout: "vertical", margin: "lg", spacing: "sm",
      backgroundColor: C.bg, cornerRadius: "16px", paddingAll: "20px",
      borderColor: C.border, borderWidth: "1px",
      contents: [
        { type: "text", text: opts.bigValue, size: "xxl", weight: "bold", color: C.deep, align: "center", wrap: true },
        ...(opts.bigLabel
          ? [{ type: "text", text: opts.bigLabel, size: "sm", color: C.textSoft, align: "center", wrap: true }]
          : []),
      ],
    });
  }

  if (opts.rows?.length) {
    body.push({
      type: "box", layout: "vertical", margin: "lg", spacing: "md",
      backgroundColor: C.bg, paddingAll: "16px", cornerRadius: "16px",
      borderColor: C.border, borderWidth: "1px",
      contents: opts.rows.map((r) => ({
        type: "box", layout: "horizontal", spacing: "md",
        contents: [
          { type: "text", text: r.label, size: "sm", color: C.textMid, flex: 3, wrap: true },
          {
            type: "text", text: r.value, size: "sm", flex: 2, align: "end",
            weight: "bold", color: r.accent ? "#16787B" : C.textDark, wrap: true,
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
    header: {
      type: "box", layout: "vertical", paddingAll: "20px", spacing: "sm",
      backgroundColor: C.deep,
      background: { type: "linearGradient", angle: "120deg", startColor: C.deep, endColor: C.deepEnd },
      contents: [
        { type: "text", text: "看·健  /  健康顧問", size: "xs", color: "#D8F2EE", wrap: true },
        { type: "text", text: opts.title, weight: "bold", size: "xl", color: C.bg, wrap: true },
      ],
    },
    ...(body.length ? { body: {
      type: "box", layout: "vertical", backgroundColor: C.surface,
      paddingAll: "20px", contents: body,
    } } : {}),
    styles: { header: { backgroundColor: C.deep }, body: { backgroundColor: C.surface }, footer: { backgroundColor: C.surface } },
  };

  if (opts.hero) {
    bubble.hero = { type: "image", url: opts.hero, size: "full", aspectRatio: "20:13", aspectMode: "cover" };
  }

  if (opts.buttons?.length) {
    bubble.footer = {
      type: "box", layout: "vertical", spacing: "sm",
      backgroundColor: C.surface, paddingAll: "16px",
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

/** GitHub Pages / 正式站上的公開靜態資產網址。 */
export function assetUrl(path: string): string {
  return `${APP_BASE_URL}/${path.replace(/^\/+/, "")}`;
}

