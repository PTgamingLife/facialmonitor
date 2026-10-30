/**
 * 群發圖卡的組裝 —— 唯一一份。
 *
 * 為什麼抽出來:現在有兩個入口會組同一張卡
 *   ① line-broadcast  排程 cron 與直接呼叫
 *   ② admin-api       管理中心的預覽、測試、送出
 *
 * 兩邊各寫一份的下場這個專案已經看過三次(見證順序、分享文案、圖文選單)。
 * 更糟的是這張卡會群發出去 —— 預覽跟實際送出長得不一樣,等於預覽沒用。
 */

import { infoCard, LineMessage, uriAction } from "./line.ts";

// hero    圖片當卡片頂圖。infoCard 的 hero 固定 20:13 且 cover,
//         直式圖塞進去只會看到中間一條,文字全被裁掉。
// message 圖片改成獨立的 LINE 圖片訊息接在卡片前面,保留原始比例。
export type ImageLayout = "hero" | "message";

export type CardInput = {
  title: string;
  subtitle?: string | null;
  note?: string | null;
  image_url?: string | null;
  link_url?: string | null;
  link_label?: string | null;
  image_layout?: ImageLayout | null;
  /**
   * ⚠️ 「先問問 AI」預設不加。
   *
   * 那顆按鈕會送出「我想了解『<標題>』」給健康 AI,而 AI 只認識健康與養生。
   * 標題不是健康主題時,它會老實回「這個我沒有相關資訊」—— 使用者按了官方
   * 帳號自己給的按鈕,卻被告知問錯地方。10/30 的小遊戲推播就是這樣。
   *
   * 要加回去必須明講 true,而且只在標題本身是健康主題時才該開。
   */
  ask_ai?: boolean | null;
};

export function buildFlex(row: CardInput): LineMessage {
  const label = row.link_label?.trim() || "立即報名";
  const hero = (row.image_layout ?? "hero") === "hero" ? (row.image_url ?? undefined) : undefined;
  return infoCard({
    title: row.title,
    subtitle: row.subtitle ?? undefined,
    hero,
    note: row.note ?? undefined,
    buttons: [
      ...(row.link_url
        ? [{ label, action: uriAction(label, row.link_url), primary: true }]
        : []),
      ...(row.ask_ai
        ? [{ label: "先問問 AI", action: { type: "message", label: "先問問 AI", text: `我想了解「${row.title}」` } }]
        : []),
    ],
    altText: row.title,
  });
}

/** 圖片訊息:originalContentUrl 與 previewImageUrl 都必須是 HTTPS 的 JPEG/PNG。 */
export function buildImage(url: string): LineMessage {
  return { type: "image", originalContentUrl: url, previewImageUrl: url };
}

/**
 * 一次送出的訊息陣列。圖片走 message 版位時排在卡片前面 ——
 * 先看到圖再看到字,順序反過來圖會被當成附註。
 */
export function buildMessages(row: CardInput): LineMessage[] {
  const flex = buildFlex(row);
  return (row.image_layout ?? "hero") === "message" && row.image_url
    ? [buildImage(row.image_url), flex]
    : [flex];
}
