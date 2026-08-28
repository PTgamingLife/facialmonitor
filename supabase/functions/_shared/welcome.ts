// 歡迎訊息 —— 加好友時(line-webhook)與綁定完成時(liff-auth)共用同一份
//
// 兩邊各寫一份的話,改了文案只改一邊,新朋友會依照「先加好友」還是
// 「先點分享網址」走到不同的歡迎訊息。這個專案已經被這類漂移咬過很多次。

import { appUrl, infoCard, LineMessage, uriAction } from "./line.ts";

const LIFF_ID = Deno.env.get("HEALTHBOT_LIFF_ID") ?? "2011132698-FNcAIg39";

export function liffUrl(page: string): string {
  return LIFF_ID ? `https://liff.line.me/${LIFF_ID}?p=${page}` : appUrl(page);
}

function mediaBase(): string {
  return `${Deno.env.get("SUPABASE_URL") ?? ""}/storage/v1/object/public/line-public-media/welcome`;
}

export function welcomeCard(name?: string): LineMessage {
  return infoCard({
    title: `${name ? name + "，歡迎你" : "歡迎你"}｜限時免費體驗 🌿`,
    hero: `${mediaBase()}/kanjian-ai-health-intro-preview.jpg`,
    subtitle: "用一張臉部與舌頭照片，快速了解目前的健康狀態，並獲得適合自己的 14 天健康方向。",
    rows: [
      { label: "限時優惠", value: "2027 年 1 月 31 日前免費體驗", accent: true },
      { label: "優惠結束後", value: "年費 NT$1,680" },
      { label: "檢測服務", value: "每月 1 次，全年 12 次" },
      { label: "專業服務", value: "健康管理師建議與報告" },
    ],
    note: "從這裡開啟 App 並用 LINE 登入，系統會自動綁定，不必輸入會員碼。活動內容依系統顯示的可用額度為準。",
    buttons: [
      { label: "立即免費體驗", action: uriAction("免費體驗", liffUrl("page-main")), primary: true },
      { label: "查看面舌診檢測", action: uriAction("查看檢測", liffUrl("page-challenge")) },
    ],
    altText: "2027 年 2 月前限時免費體驗，之後年費 1,680 元，含每月檢測與健康管理師建議報告",
  });
}

export function welcomeVideo(): LineMessage {
  return {
    type: "video",
    originalContentUrl: `${mediaBase()}/kanjian-ai-health-intro.mp4`,
    previewImageUrl: `${mediaBase()}/kanjian-ai-health-intro-preview.jpg`,
  };
}

/** 綁定完成後送的那張。跟加好友那張不同 —— 這時候他已經是會員了。 */
export function boundCard(name?: string): LineMessage {
  return infoCard({
    title: `${name ? name + "，綁定完成了 ✅" : "綁定完成了 ✅"}`,
    subtitle: "接下來可以直接用下方選單:做面舌診、看健康分數、每天答一題賺積點。",
    rows: [
      { label: "第一次檢測", value: "完成就送一次抽獎", accent: true },
      { label: "開放期優惠", value: "每月自動送 1 次檢測" },
    ],
    note: "本服務提供中醫養生與體質參考，不是醫療診斷，也不能取代醫師。",
    buttons: [
      { label: "開始第一次檢測", action: uriAction("開始檢測", liffUrl("page-challenge")), primary: true },
    ],
    altText: "綁定完成，可以開始使用了",
  });
}
