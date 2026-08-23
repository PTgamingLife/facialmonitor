// 12 格選單與文字指令的行為

import {
  appUrl, assetUrl, carousel, confirmCard, infoCard, LineMessage,
  postbackAction, textMsg, toBubble, uriAction,
} from "../_shared/line.ts";
import { rpc, select, selectOne } from "../_shared/db.ts";
import { CATEGORY_ICON, taskOfDay } from "../_shared/tasks.ts";
import { bindMember, challengeDay, firstScanAt, LineUser } from "./member.ts";

// 對外連結。這些「不是機密」—— 它們本來就會印在按鈕與分享訊息上給客戶看,
// 所以直接寫預設值,不用為了改一個網址跑一趟後台設 secret。
// 還是留 env 可以蓋過去:換顧問、換收款帳號時不必重新部署。
const CONSULTANT_URL = Deno.env.get("HEALTHBOT_CONSULTANT_URL") ?? "https://line.me/ti/p/ZC-w2BuPoi";
const LIFF_ID        = Deno.env.get("HEALTHBOT_LIFF_ID") ?? "2011132698-FNcAIg39";
// 年費健康管理方案:1,680 元，每月 1 次、全年 12 次。這裡只是用來「顯示」——
// 真正收多少、給幾次是以資料庫 sb_products 為準,RPC 會再核對一次。
const PLAN_PRICE     = 1680;
const PLAN_CREDITS   = 12;
const PLAN_PRODUCT   = "facial-scan-annual";
const LINEPAY_URL     = Deno.env.get("HEALTHBOT_LINEPAY_URL")
  ?? "https://pay-api.apricostudio.shop/facialmonitor/start";
const CHECKOUT_SECRET = Deno.env.get("HEALTHBOT_CHECKOUT_SECRET") ?? "";
const encoder = new TextEncoder();

const TESTIMONIAL_IMAGES = [
  "img/testimonials/testimonial-01.jpg",
  "img/testimonials/testimonial-02.jpg",
  "img/testimonials/testimonial-03.jpg",
  "img/testimonials/testimonial-04.jpg",
  "img/testimonials/testimonial-05.jpg",
];

/** 見證照使用獨立 bubble，接在健康分數卡後即可在 LINE 裡左右滑動。 */
function testimonialBubbles(): LineMessage[] {
  return TESTIMONIAL_IMAGES.map((path, index) => ({
    type: "bubble",
    hero: {
      type: "image",
      url: assetUrl(path),
      size: "full",
      aspectRatio: "1:1",
      aspectMode: "fit",
      backgroundColor: "#FFFFFF",
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "14px",
      contents: [
        { type: "text", text: "真實見證", weight: "bold", size: "md", color: "#0D5C63" },
        {
          type: "text",
          text: `${index + 1} / ${TESTIMONIAL_IMAGES.length}　左右滑動查看更多`,
          size: "xs",
          color: "#8FA3B8",
          margin: "sm",
        },
      ],
    },
  }));
}

function base64Url(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** 產生只屬於這位已綁定會員、20 分鐘內有效的 LINE Pay 連結。 */
async function checkoutUrl(u: LineUser): Promise<string | null> {
  if (!u.sb_user_id || !CHECKOUT_SECRET || !LINEPAY_URL) return null;
  const fingerprint = await crypto.subtle.digest("SHA-256", encoder.encode(CHECKOUT_SECRET));
  console.log("checkout secret fingerprint:", base64Url(new Uint8Array(fingerprint)).slice(0, 12));
  const expires = Math.floor(Date.now() / 1000) + 20 * 60;
  const payload = `${u.sb_user_id}\n${u.line_user_id}\n${expires}\n${PLAN_PRODUCT}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(CHECKOUT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const url = new URL(LINEPAY_URL);
  url.searchParams.set("userId", u.sb_user_id);
  url.searchParams.set("lineUserId", u.line_user_id);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("productCode", PLAN_PRODUCT);
  url.searchParams.set("signature", base64Url(new Uint8Array(mac)));
  return url.toString();
}

function liffUrl(page: string): string {
  return LIFF_ID ? `https://liff.line.me/${LIFF_ID}?p=${page}` : appUrl(page);
}

function referralUrl(code: string): string {
  return LIFF_ID
    ? `https://liff.line.me/${LIFF_ID}?p=page-main&ref=${encodeURIComponent(code)}`
    : `${appUrl("page-main")}&ref=${encodeURIComponent(code)}`;
}

/**
 * LINE 內建的分享 URL scheme:按下去直接跳「選擇傳送對象」,選好友就送出。
 *
 * 不走 LIFF 的 shareTargetPicker —— 那個要先在 Developers 後台開權限,
 * 而且得先載一個網頁才彈得出選單,中間會閃一下白畫面。這條 scheme 是
 * LINE App 原生的,不必開權限、不必經過我們的網頁,按下去就是好友清單。
 */
function shareUrl(text: string): string {
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}

/** 分享出去的文字：專屬 LIFF 網址會在登入後自動綁定推薦人。 */
function inviteText(code: string): string {
  return `我在用「看·健」測體質、做健康任務,滿有感的 🌿\n\n`
    + `點我的專屬網址加入,登入後會自動綁定推薦人,並獲得 1 次免費檢測:\n`
    + `${referralUrl(code)}\n\n`
    + `推薦碼:${code}(備用)`;
}

const NEED_BIND = infoCard({
  title: "開啟 App 即可自動綁定",
  subtitle: "用 LINE 登入後，系統會安全確認你的身分並自動完成綁定，不必輸入會員碼。",
  buttons: [{ label: "開啟 App 並自動綁定", action: uriAction("開啟 App", liffUrl("page-main")), primary: true }],
  altText: "請先綁定會員",
});

// ── 分頁 A:健康 ───────────────────────────────────────────
async function scoreTrend(u: LineUser): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;

  const monthKey = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 7);
  const snap = await selectOne<{
    first_score: number; best_score: number; delta: number; rewarded: boolean;
  }>("sb_score_snapshots",
    `user_id=eq.${u.sb_user_id}&month_key=eq.${monthKey}`
      + `&select=first_score,best_score,delta,rewarded`);

  const rates = await rpc<{ rates: { threshold: number } }>(
    "rpc_my_reward_summary", { p_user_id: u.sb_user_id });
  const threshold = rates?.rates?.threshold ?? 10;

  if (!snap) {
    return infoCard({
      title: "本月還沒有可比較的分數",
      subtitle: `這個月做兩次面舌診,分數進步 ${threshold} 分以上,你和你的小天使都能拿積點。`,
      buttons: [{ label: "去做面舌診", action: uriAction("去做面舌診", appUrl("page-challenge")), primary: true }],
      altText: "本月分數",
    });
  }

  const gap = threshold - (snap.delta ?? 0);
  return infoCard({
    title: "📈 本月健康分數",
    bigValue: `${snap.delta > 0 ? "+" : ""}${snap.delta}`,
    bigLabel: "本月進步幅度",
    rows: [
      { label: "本月起始分數", value: String(snap.first_score) },
      { label: "本月最佳分數", value: String(snap.best_score), accent: true },
    ],
    note: snap.rewarded
      ? `已達標,進步獎積點已經入帳 🎉`
      : gap > 0
        ? `再進步 ${gap} 分就達標,你和小天使都能拿積點。`
        : `已達標,結算後就會入帳。`,
    buttons: [{ label: "再測一次", action: uriAction("再測一次", appUrl("page-challenge")), primary: true }],
    altText: "本月健康分數",
  });
}

async function credits(u: LineUser): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;

  const s = await rpc<{ credits: number; points: number; rates: { redeem_credit: number } }>(
    "rpc_my_reward_summary", { p_user_id: u.sb_user_id });
  const cost = s?.rates?.redeem_credit ?? 100;

  return infoCard({
    title: "🎟 剩餘看見健康次數",
    bigValue: String(s?.credits ?? 0),
    bigLabel: "剩餘次數",
    rows: [{ label: "積點餘額", value: `${s?.points ?? 0} 點` }],
    note: `${cost} 點可以換 1 次檢測。`,
    buttons: [
      { label: "用積點兌換", action: postbackAction("用積點兌換", "action=redeem_confirm&n=1"), primary: true },
      { label: "開始檢測", action: uriAction("開始檢測", liffUrl("page-challenge")) },
    ],
    altText: "剩餘看見健康次數",
  });
}

async function taskToday(u: LineUser): Promise<LineMessage> {
  if (u.sb_user_id) {
    const c = await selectOne<{ health_focus:string; starts_on:string; plan:Record<string,unknown>[] }>(
      "sb_health_challenges", `user_id=eq.${u.sb_user_id}&status=eq.active&select=health_focus,starts_on,plan`);
    if (c) {
      const today = new Date().toLocaleDateString("sv-SE", { timeZone:"Asia/Taipei" });
      const day = Math.floor((Date.parse(today)-Date.parse(c.starts_on))/86400000)+1;
      if (day < 1) return infoCard({title:"✅ 14 天挑戰申請完成",subtitle:`挑戰將於 ${c.starts_on} 開始，每天 08:20 提醒。`,altText:"14 天挑戰已排定"});
      const t = c.plan[Math.min(day,14)-1] ?? {};
      return infoCard({title:`🌿 Day ${Math.min(day,14)}｜${String(t.title??"今日任務")}`,subtitle:String(t.task??"完成今天的小任務。"),rows:[{label:"健康重點",value:c.health_focus},{label:"為什麼",value:String(t.why??"建立健康習慣")}],altText:"今日個人健康挑戰"});
    }
  }
  let day = 1;
  if (u.sb_user_id) {
    const first = await firstScanAt(u.sb_user_id);
    if (first) day = challengeDay(first);
  }

  const t = taskOfDay(day);
  const icon = CATEGORY_ICON[t.category] ?? "🌿";

  return infoCard({
    title: `${icon} Day ${t.day}｜${t.title}`,
    subtitle: t.desc,
    rows: [{ label: "類別", value: t.category }, { label: "完成可得", value: `${t.xp} XP`, accent: true }],
    buttons: [
      { label: "去 App 打卡", action: uriAction("去 App 打卡", appUrl("page-main")), primary: true },
      { label: "問 AI 這樣做對嗎", action: postbackAction("問 AI", `action=ask_task&day=${t.day}`) },
    ],
    altText: `今日任務 Day ${t.day}`,
  });
}

/**
 * 面舌診檢測的入口。
 *
 * 次數是 0 的時候不要把人丟去 App —— 到了那邊也是被擋下來,
 * 使用者只會覺得「這什麼爛東西」然後關掉。在這裡就先講清楚
 * 怎麼拿到次數,而且三條路都給一個按得下去的按鈕。
 */
async function startScan(u: LineUser): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;

  const s = await rpc<{
    credits: number; points: number; member_code: string;
    rates: { redeem_credit: number };
  }>("rpc_my_reward_summary", { p_user_id: u.sb_user_id });

  const credits = s?.credits ?? 0;
  const points  = s?.points ?? 0;
  const cost    = s?.rates?.redeem_credit ?? 100;

  if (credits > 0) {
    return infoCard({
      title: "🔍 面舌診檢測",
      subtitle: "拍一張正臉、一張舌頭,大約一分鐘就有結果。",
      bigValue: String(credits),
      bigLabel: "剩餘檢測次數",
      note: "光線充足、素顏、舌頭自然伸出,結果會準很多。",
      buttons: [
        { label: "開始檢測", action: uriAction("開始檢測", liffUrl("page-challenge")), primary: true },
      ],
      altText: "面舌診檢測",
    });
  }

  // 次數用完 —— 三條補次數的路,免費的排前面、要付錢的排最後。
  // 按鈕用 deep / mid / soft 三階深淺,一眼看得出建議的先後。
  const enough = points >= cost;
  return infoCard({
    title: "檢測次數用完了",
    subtitle: "別擔心,有三個方法可以拿到次數:",
    bigValue: `${points}`,
    bigLabel: "目前積點",
    rows: [
      { label: "① 推薦或被推薦", value: "雙方都拿積點", accent: true },
      { label: "② 每日打卡", value: "一天 +3 點" },
      { label: "③ 年費方案", value: `NT$ ${PLAN_PRICE} / ${PLAN_CREDITS} 次` },
    ],
    note: enough
      ? `你的積點已經夠換 1 次了(${cost} 點),直接按中間那顆。`
      : `${cost} 點可以換 1 次,還差 ${cost - points} 點。`,
    buttons: [
      { label: "推薦或被推薦", action: postbackAction("推薦或被推薦", "action=referral_menu"), tone: "deep" },
      // 積點已經夠的時候還叫人去打卡是浪費一顆按鈕,直接給兌換
      enough
        ? { label: "用積點兌換 1 次", action: postbackAction("用積點兌換", "action=redeem_confirm&n=1"), tone: "mid" }
        : { label: "每日打卡賺積點", action: postbackAction("每日打卡", "action=daily_checkin"), tone: "mid" },
      { label: `年費 ${PLAN_CREDITS} 次（${PLAN_PRICE} 元）`, action: postbackAction("購買次數", "action=buy_credits"), tone: "soft" },
    ],
    altText: "檢測次數用完了",
  });
}

/** 推薦分享與個人健康挑戰入口 */
async function referralMenu(u: LineUser): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;

  return infoCard({
    title: "🌿 推薦與健康挑戰",
    subtitle: "分享專屬網址給朋友，或依最近一次健康檢測申請個人化 14 天挑戰。",
    rows: [
      { label: "健康挑戰", value: "一次排定 14 天內容", accent: true },
      { label: "分享給朋友", value: "朋友首檢你就得點" },
    ],
    buttons: [
      { label: "申請 14 天健康挑戰", action: postbackAction("申請挑戰", "action=challenge_apply"), tone: "deep" },
      { label: "分享給朋友", action: postbackAction("分享給朋友", "action=share_invite"), tone: "mid" },
    ],
    altText: "推薦與 14 天健康挑戰",
  });
}

/** 分享推薦:彈出 LINE 的分享視窗,一次把官方帳號與自己的推薦碼送出去 */
async function shareInvite(u: LineUser): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;

  const s = await rpc<{ member_code: string; invitee_stats: { confirmed: number; total: number } }>(
    "rpc_my_reward_summary", { p_user_id: u.sb_user_id });
  const code = s?.member_code ?? "—";

  return infoCard({
    title: "📣 分享給朋友",
    subtitle: "按下面的按鈕選好友，對方點專屬網址並登入後，就會自動把你綁定為小天使。",
    bigValue: code,
    bigLabel: "我的推薦碼",
    rows: [
      { label: "已推薦人數", value: `${s?.invitee_stats?.confirmed ?? 0} 人完成首檢`, accent: true },
    ],
    note: "朋友做完第一次檢測你就得積點;他當月進步 10 分,你再得一次。",
    buttons: [
      { label: "選好友分享", action: uriAction("選好友分享", shareUrl(inviteText(code))), primary: true },
      { label: "看我推薦的人", action: postbackAction("看我推薦的人", "action=my_invitees") },
    ],
    altText: "分享給朋友",
  });
}

/** 每日打卡:一天一次,+3 點,順便跳出當天的健康資訊 */
async function dailyCheckin(u: LineUser): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;

  const r = await rpc<{
    ok: boolean; message?: string; first_time: boolean; points_added: number;
    balance: number; streak: number;
    tip: { title: string; body: string; image_url: string | null; date: string } | null;
  }>("rpc_daily_checkin", { p_user_id: u.sb_user_id });

  if (!r?.ok) return textMsg(`⚠️ ${r?.message ?? "打卡失敗,請稍後再試。"}`);

  const rows = [
    { label: "連續打卡", value: `${r.streak} 天`, accent: r.streak > 1 },
    { label: "積點餘額", value: `${r.balance} 點`, accent: true },
  ];
  if (r.first_time) rows.unshift({ label: "今日打卡", value: `+${r.points_added} 點`, accent: true });

  return infoCard({
    title: r.first_time ? "✅ 今日打卡完成" : "今天已經打過卡了",
    subtitle: r.tip ? r.tip.body : "今天的健康資訊還在準備中,明天再來看看。",
    hero: r.tip?.image_url || undefined,
    rows,
    note: r.tip ? `📌 ${r.tip.title}` : undefined,
    buttons: [
      { label: "去做面舌診", action: uriAction("去做面舌診", liffUrl("page-challenge")), primary: true },
    ],
    altText: r.first_time ? "打卡完成" : "今天已打卡",
  });
}

type TipReadResult = {
  ok: boolean;
  error?: string;
  message?: string;
  bound?: boolean;
  needs_disclaimer?: boolean;
  disclaimer_version?: string;
  disclaimer_body?: string;
  tip_id?: string;
  first_time?: boolean;
  points_added?: number;
  balance?: number;
  is_today?: boolean;
  tip?: {
    id: string; date: string; title: string; body: string;
    detail_points: string[]; image_url: string | null; source_urls: string[];
  };
};

function tipReadCard(r: TipReadResult): LineMessage {
  if (!r.ok || !r.tip) return textMsg(`⚠️ ${r.message ?? "這則健康資訊目前無法閱讀。"}`);
  const rows = (r.tip.detail_points ?? []).slice(0, 3).map((point, i) => ({
    label: `${i + 1}`, value: point, accent: i === 0,
  }));
  if ((r.points_added ?? 0) > 0) {
    rows.push({ label: "今日閱讀", value: `+${r.points_added} 點`, accent: true });
    rows.push({ label: "積點餘額", value: `${r.balance ?? 0} 點`, accent: true });
  }
  const oldNote = r.is_today === false
    ? `這是 ${r.tip.date} 的健康資訊，積點只給當天閱讀喔 🌿`
    : r.first_time === false && r.bound
      ? "今天已經閱讀並領過積點囉。"
      : !r.bound ? r.message : undefined;
  const sourceButtons = (r.tip.source_urls ?? []).flatMap((value, index) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return [];
      return [{ label: `官方來源${index + 1}`, action: uriAction(`官方來源${index + 1}`, url.href) }];
    } catch { return []; }
  }).slice(0, 2);
  return infoCard({
    title: `🌿 ${r.tip.title}`,
    subtitle: r.tip.body,
    hero: r.tip.image_url || undefined,
    rows,
    note: oldNote,
    buttons: sourceButtons,
    altText: r.tip.title,
  });
}

async function previewTip(tipId: string): Promise<LineMessage> {
  if (!/^[0-9a-f-]{36}$/i.test(tipId)) return textMsg("⚠️ 這則健康資訊連結已失效。");
  const tip = await selectOne<{
    id: string; tip_date: string; title: string; body: string; detail_points: string[];
    image_url: string | null; source_urls: string[];
  }>("sb_daily_tips",
    `id=eq.${tipId}&active=eq.true&status=eq.approved&approved_at=not.is.null&select=id,tip_date,title,body,detail_points,image_url,source_urls`);
  if (!tip) return textMsg("⚠️ 這則健康資訊目前無法閱讀。");
  return tipReadCard({
    ok: true, bound: false, is_today: false, points_added: 0,
    message: "這是測試預覽，不提供閱讀積點。",
    tip: { ...tip, date: tip.tip_date },
  });
}

async function readTip(u: LineUser, tipId: string): Promise<LineMessage> {
  if (!/^[0-9a-f-]{36}$/i.test(tipId)) return textMsg("⚠️ 這則健康資訊連結已失效。");
  const r = await rpc<TipReadResult>("rpc_read_tip", {
    p_line_user_id: u.line_user_id, p_tip_id: tipId,
  });
  if (r?.needs_disclaimer && r.disclaimer_version && r.disclaimer_body) {
    return infoCard({
      title: "閱讀前請先確認",
      subtitle: r.disclaimer_body,
      buttons: [{
        label: "同意並繼續",
        action: postbackAction("同意並繼續",
          `action=tip_disclaimer_agree&tip=${tipId}&version=${encodeURIComponent(r.disclaimer_version)}`),
        primary: true,
      }],
      altText: "健康資訊免責聲明",
    });
  }
  return tipReadCard(r ?? { ok: false, message: "讀取失敗，請稍後再試。" });
}

async function agreeTipDisclaimer(u: LineUser, tipId: string, version: string): Promise<LineMessage> {
  if (!/^[0-9a-f-]{36}$/i.test(tipId) || !version) return textMsg("⚠️ 這則健康資訊連結已失效。");
  const r = await rpc<TipReadResult>("rpc_agree_tip_disclaimer", {
    p_line_user_id: u.line_user_id, p_version: version, p_tip_id: tipId,
  });
  return tipReadCard(r ?? { ok: false, message: "確認失敗，請稍後再試。" });
}

/** 最新健康分數 + 與上一次的差額(只有一次檢測就只報最新的) */
async function latestScore(u: LineUser): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;

  const r = await rpc<{
    ok: boolean; has_record: boolean; latest: number; latest_at: string;
    has_previous: boolean; previous: number | null; delta: number | null;
  }>("rpc_latest_score", { p_user_id: u.sb_user_id });

  if (!r?.ok || !r.has_record) {
    const emptyScoreCard = infoCard({
      title: "還沒有檢測紀錄",
      subtitle: "做完第一次面舌診之後,這裡就會顯示你的健康分數。",
      buttons: [{ label: "去做面舌診", action: uriAction("去做面舌診", liffUrl("page-challenge")), primary: true }],
      altText: "還沒有檢測紀錄",
    });

    return carousel(
      [toBubble(emptyScoreCard), ...testimonialBubbles()],
      "我的健康分數與真實見證（可左右滑動）",
    );
  }

  const day = (iso: string) => iso.slice(0, 10);
  // 明寫型別:第一筆沒有 accent,讓 TS 自己推會推成沒有 accent 的形狀,
  // 後面 push 帶 accent 的就編不過。
  const rows: { label: string; value: string; accent?: boolean }[] = [
    { label: "檢測日期", value: day(r.latest_at) },
  ];

  if (r.has_previous && r.delta != null) {
    const d = Number(r.delta);
    rows.push({ label: "上一次分數", value: String(r.previous) });
    rows.push({
      label: d >= 0 ? "進步" : "退步",
      value: `${d > 0 ? "+" : ""}${d} 分`,
      accent: d > 0,          // 只有進步才用強調色,退步不要假裝是好消息
    });
  }

  const scoreCard = infoCard({
    title: "📈 我的健康分數",
    bigValue: String(r.latest),
    bigLabel: "最新分數",
    rows,
    note: r.has_previous
      ? "分數是跟你自己的上一次比,不是跟別人比。"
      : "再測一次就能看出變化幅度。",
    buttons: [
      { label: "看詳細報告", action: uriAction("看詳細報告", liffUrl("page-history")), tone: "deep" },
      { label: "再測一次", action: uriAction("再測一次", liffUrl("page-challenge")), tone: "mid" },
    ],
    altText: "我的健康分數",
  });

  return carousel(
    [toBubble(scoreCard), ...testimonialBubbles()],
    "我的健康分數與真實見證（可左右滑動）",
  );
}

/**
 * 我的積分:餘額 + 怎麼賺。
 *
 * 賺點的方法直接讀 sb_point_rules,不寫死在程式裡 ——
 * 之後在後台調整點數,卡片會自己跟著變,不用重新部署。
 */
async function myPoints(u: LineUser): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;

  const s = await rpc<{ points: number; rates: { redeem_credit: number } }>(
    "rpc_my_reward_summary", { p_user_id: u.sb_user_id });
  const points = s?.points ?? 0;
  const cost   = s?.rates?.redeem_credit ?? 100;

  // 只列「賺得到點」的規則;兌換與抽獎是花點的,門檻那筆不是獎勵
  const EARN = ["invite_confirmed", "score_up_angel", "score_up_referee", "bind_angel", "daily_checkin"];
  const rules = await select<{ rule_key: string; points: number; label: string }>(
    "sb_point_rules",
    `rule_key=in.(${EARN.join(",")})&select=rule_key,points,label&order=points.desc`,
  );

  const rows = rules.map((r) => ({
    label: r.label,
    value: `+${r.points} 點`,
    accent: r.points >= 30,
  }));

  return infoCard({
    title: "💎 我的積分",
    subtitle: "積分可以換檢測次數,也可以抽獎。",
    bigValue: String(points),
    bigLabel: "目前積點",
    rows,
    note: points >= cost
      ? `已經夠換 1 次檢測了(${cost} 點),按下面就能換。`
      : `${cost} 點可以換 1 次檢測,還差 ${cost - points} 點。`,
    buttons: [
      points >= cost
        ? { label: "用積點兌換 1 次", action: postbackAction("用積點兌換", "action=redeem_confirm&n=1"), tone: "deep" }
        : { label: "每日打卡 +3 點", action: postbackAction("每日打卡", "action=daily_checkin"), tone: "deep" },
      { label: "推薦或被推薦", action: postbackAction("推薦或被推薦", "action=referral_menu"), tone: "mid" },
      { label: "兌換 / 抽獎", action: postbackAction("兌換 抽獎", "action=reward_shop"), tone: "soft" },
    ],
    altText: "我的積分",
  });
}

/** 詢問北醫健康管理顧問 */
function askConsultant(): LineMessage {
  return infoCard({
    title: "👩‍⚕️ 詢問健康管理顧問",
    subtitle: CONSULTANT_URL
      ? "北醫背景的健康管理顧問,可以聊體質調理、報告怎麼看、要不要進一步檢查。"
      : "顧問的聯絡方式還在設定中,稍後再試。",
    note: CONSULTANT_URL ? "顧問回覆需要一點時間,急症請直接就醫或撥 119。" : undefined,
    buttons: CONSULTANT_URL
      ? [{ label: "加顧問 LINE", action: uriAction("加顧問 LINE", CONSULTANT_URL), primary: true }]
      : [],
    altText: "詢問健康管理顧問",
  });
}

/**
 * 開放期優惠的一行說明。促銷視窗與每月次數都放在資料庫,
 * 這裡只負責唸出來 —— 營運要延長或喊停,改資料表就好,不用重新部署。
 * 查不到或已過期就回 null,卡片上那一列會整列不出現。
 */
async function freeCreditNote(): Promise<string | null> {
  const promo = await selectOne<{
    first_month: string; last_month: string;
    credits_per_month: number; active: boolean;
  }>("sb_promo_free_credit", "id=is.true&select=first_month,last_month,credits_per_month,active");
  if (!promo?.active) return null;

  const month = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 7);
  if (month < promo.first_month.slice(0, 7) || month > promo.last_month.slice(0, 7)) return null;

  return `每月免費 +${promo.credits_per_month} 次（至 ${promo.last_month.slice(0, 7)}）`;
}

/** 購買檢測次數 */
async function buyCredits(u: LineUser): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;
  const paymentUrl = await checkoutUrl(u);
  const promo = await freeCreditNote();
  return infoCard({
    title: "🛒 年費方案",
    bigValue: `NT$ ${PLAN_PRICE}`,
    bigLabel: `每月 1 次檢測｜全年 ${PLAN_CREDITS} 次`,
    subtitle: paymentUrl
      ? `LINE Pay 付款完成後，系統會自動增加 ${PLAN_CREDITS} 次檢測額度。`
      : "付款服務尚未完成安全設定,請稍後再試。",
    rows: [
      { label: "平均單次", value: `約 NT$ ${Math.round(PLAN_PRICE / PLAN_CREDITS)}`, accent: true },
      { label: "專業服務", value: "健康管理師建議與報告" },
      ...(promo ? [{ label: "開放期優惠", value: promo }] : []),
    ],
    note: "每月安排一次檢測，持續追蹤健康變化；也可以用積點兌換額外檢測。",
    buttons: [
      ...(paymentUrl
        ? [{ label: `LINE Pay 付款 ${PLAN_PRICE} 元`, action: uriAction("LINE Pay 付款", paymentUrl), primary: true }]
        : []),
      { label: "用積點兌換", action: postbackAction("用積點兌換", "action=redeem_confirm&n=1") },
    ],
    altText: "購買檢測次數",
  });
}

// ── 分頁 B:推薦與積點 ─────────────────────────────────────
async function myReward(u: LineUser): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;

  const s = await rpc<{
    member_code: string; points: number;
    angel: { name: string } | null;
    invitee_stats: { total: number; confirmed: number };
    recent_ledger: { delta: number; note: string; reason: string }[];
  }>("rpc_my_reward_summary", { p_user_id: u.sb_user_id });

  if (!s) return textMsg("⚠️ 資料讀取失敗,請稍後再試。");

  const rows = [
    { label: "我的推薦碼", value: s.member_code ?? "—", accent: true },
    { label: "我的小天使", value: s.angel?.name ?? "還沒填" },
    { label: "已推薦人數", value: `${s.invitee_stats?.confirmed ?? 0} / ${s.invitee_stats?.total ?? 0} 人` },
  ];

  for (const l of (s.recent_ledger ?? []).slice(0, 3)) {
    rows.push({
      label: l.note ?? l.reason,
      value: `${l.delta > 0 ? "+" : ""}${l.delta} 點`,
      accent: l.delta > 0,
    });
  }

  return infoCard({
    title: "👼 我的小天使 / 推薦碼",
    bigValue: `${s.points ?? 0}`,
    bigLabel: "積點餘額",
    rows,
    note: "把推薦碼給朋友,他完成第一次檢測你就得點;他當月進步 10 分,你再得一次。",
    buttons: [
      { label: "分享我的推薦碼", action: postbackAction("分享推薦碼", "action=share_invite"), primary: true },
      { label: "申請 14 天健康挑戰", action: postbackAction("申請挑戰", "action=challenge_apply") },
    ],
    altText: "我的小天使與推薦碼",
  });
}

async function myInvitees(u: LineUser): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;

  const s = await rpc<{
    invitees: { name: string; status: string; delta: number | null }[];
  }>("rpc_my_reward_summary", { p_user_id: u.sb_user_id });

  const list = s?.invitees ?? [];
  if (list.length === 0) {
    return infoCard({
      title: "👥 還沒有人填你當小天使",
      subtitle: "把你的 7 位推薦碼傳給朋友,他在 App 或這裡輸入「小天使 你的碼」就算數。",
      buttons: [{ label: "分享給朋友", action: postbackAction("分享給朋友", "action=share_invite"), primary: true }],
      altText: "我推薦的人",
    });
  }

  return infoCard({
    title: `👥 我推薦的人（${list.length}）`,
    rows: list.slice(0, 10).map((i) => ({
      label: i.name ?? "會員",
      value: i.status === "confirmed"
        ? (i.delta != null ? `已檢測 ${i.delta > 0 ? "+" : ""}${i.delta} 分` : "已完成首檢")
        : "尚未首檢",
      accent: i.status === "confirmed",
    })),
    note: "尚未首檢的朋友完成第一次面舌診,你就會拿到積點。",
    altText: "我推薦的人",
  });
}

async function rewardShop(u: LineUser): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;

  const s = await rpc<{ points: number; rates: { redeem_credit: number; lottery_draw: number } }>(
    "rpc_my_reward_summary", { p_user_id: u.sb_user_id });
  const balance = s?.points ?? 0;
  const costRedeem = s?.rates?.redeem_credit ?? 100;
  const costDraw = s?.rates?.lottery_draw ?? 30;

  const prizes = await select<{ name: string; description: string; image_url: string; stock: number }>(
    "sb_lottery_prizes", `active=eq.true&stock=gt.0&select=name,description,image_url,stock&order=sort.asc`);

  const bubbles: LineMessage[] = [
    toBubble(infoCard({
      title: "🔄 積點兌換檢測次數",
      bigValue: `${costRedeem}`,
      bigLabel: "點 = 1 次檢測",
      rows: [{ label: "目前積點", value: `${balance} 點`, accent: balance >= costRedeem }],
      buttons: [{
        label: "立即兌換 1 次",
        action: postbackAction("立即兌換", "action=redeem_confirm&n=1"),
        primary: true,
      }],
      altText: "積點兌換",
    })),
  ];

  for (const p of prizes) {
    bubbles.push(toBubble(infoCard({
      title: `🎁 ${p.name}`,
      subtitle: p.description ?? undefined,
      hero: p.image_url || undefined,
      rows: [{ label: "剩餘數量", value: `${p.stock} 份` }],
      note: `每抽 ${costDraw} 點,獎品依機率隨機抽出。`,
      buttons: [{ label: `馬上抽（${costDraw} 點）`, action: postbackAction("馬上抽", "action=draw_confirm"), primary: true }],
      altText: p.name,
    })));
  }

  if (prizes.length === 0) {
    bubbles.push(toBubble(infoCard({
      title: "🎁 獎品補貨中",
      subtitle: "目前沒有可抽的獎品,積點先存著,下一波活動就能用。",
      altText: "獎品補貨中",
    })));
  }

  return carousel(bubbles, "兌換與抽獎");
}

// ── 扣點動作(都要先二次確認) ──────────────────────────────
async function doRedeem(u: LineUser, n: number): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;
  const r = await rpc<{ ok: boolean; message?: string; credits?: number; balance?: number }>(
    "rpc_redeem_credits", { p_count: n, p_user_id: u.sb_user_id });

  if (!r?.ok) return textMsg(`⚠️ ${r?.message ?? "兌換失敗,請稍後再試。"}`);
  return infoCard({
    title: "✅ 兌換成功",
    rows: [
      { label: "檢測次數", value: `${r.credits} 次`, accent: true },
      { label: "剩餘積點", value: `${r.balance} 點` },
    ],
    buttons: [{ label: "現在就去檢測", action: uriAction("去檢測", liffUrl("page-challenge")), primary: true }],
    altText: "兌換成功",
  });
}

async function doDraw(u: LineUser): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;
  const r = await rpc<{
    ok: boolean; message?: string; prize_name?: string; prize_image?: string; balance?: number;
  }>("rpc_draw_lottery", { p_user_id: u.sb_user_id });

  if (!r?.ok) return textMsg(`⚠️ ${r?.message ?? "抽獎失敗,請稍後再試。"}`);
  return infoCard({
    title: `🎉 抽中 ${r.prize_name}`,
    hero: r.prize_image || undefined,
    rows: [{ label: "剩餘積點", value: `${r.balance} 點` }],
    note: "我們會盡快與你聯繫兌獎方式。",
    altText: `抽中 ${r.prize_name}`,
  });
}

// ── postback 總入口 ───────────────────────────────────────
export async function handlePostback(
  u: LineUser, action: string, params: URLSearchParams,
): Promise<LineMessage | LineMessage[] | null> {
  switch (action) {
    case "noop":
      return null;

    // 新的六格
    case "start_scan":
      return await startScan(u);
    case "referral_menu":
      return await referralMenu(u);
    case "share_invite":
      return await shareInvite(u);
    case "score_latest":
      return await latestScore(u);
    case "my_points":
      return await myPoints(u);
    case "daily_checkin":
      return await dailyCheckin(u);
    case "tip_detail":
      return await readTip(u, params.get("tip") ?? "");
    case "tip_preview_detail":
      return await previewTip(params.get("tip") ?? "");
    case "tip_disclaimer_agree":
      return await agreeTipDisclaimer(u, params.get("tip") ?? "", params.get("version") ?? "");
    case "ask_consultant":
      return askConsultant();
    case "buy_credits":
      return await buyCredits(u);

    // 舊 action 保留:已經送出去的卡片上還帶著這些 data,
    // 拿掉的話那些按鈕會變成按了沒反應。
    case "score_trend":
      return await scoreTrend(u);
    case "credits":
      return await credits(u);
    case "task_today":
      return await taskToday(u);

    case "bind_start":
      return infoCard({
        title: "🔗 自動綁定會員",
        subtitle: "開啟 App 並用 LINE 登入，系統就會自動把目前的 LINE 帳號與會員資料綁定。",
        buttons: [{ label: "開啟 App 並自動綁定", action: uriAction("開啟 App", liffUrl("page-main")), primary: true }],
        altText: "綁定會員",
      });

    case "my_reward":
      return await myReward(u);
    case "my_invitees":
      return await myInvitees(u);

    case "set_angel":
    case "challenge_apply": {
      if (!u.sb_user_id) return NEED_BIND;
      const r = await rpc<{ok:boolean;already_active?:boolean;error?:string;focus?:string;starts_on?:string}>(
        "rpc_apply_health_challenge", {p_user_id:u.sb_user_id});
      if (r?.error === "no_report") return infoCard({title:"先完成一次健康檢測",subtitle:"需要最近一次健康報告，才能安排適合你的 14 天挑戰。",buttons:[{label:"去做面舌診",action:uriAction("去檢測",liffUrl("page-challenge")),primary:true}],altText:"請先完成健康檢測"});
      if (r?.already_active) return await taskToday(u);
      return infoCard({title:"✅ 14 天健康挑戰申請完成",subtitle:`健康重點：${r?.focus??"日常體質調養"}\n從 ${r?.starts_on??"明天"} 開始，每天 08:20 提醒。`,note:"14 天內容已一次排定並寫入後台，不會每天重新計算。",altText:"14 天挑戰申請完成"});
    }

    case "share_code": {
      if (!u.sb_user_id) return NEED_BIND;
      const s = await rpc<{ member_code: string }>(
        "rpc_my_reward_summary", { p_user_id: u.sb_user_id });
      return textMsg(
        `我在用「看·健」測體質、做健康任務,滿有感的 🌿\n\n`
        + `點我的專屬網址加入,登入後會自動綁定推薦人,並獲得 1 次免費檢測:\n`
        + `${referralUrl(s?.member_code ?? "")}\n\n`
        + `推薦碼：${s?.member_code ?? "—"}(備用)`,
      );
    }

    case "reward_shop":
      return await rewardShop(u);

    case "redeem_confirm": {
      const n = Math.max(1, Math.min(10, Number(params.get("n") ?? 1)));
      const s = await rpc<{ rates: { redeem_credit: number } }>(
        "rpc_my_reward_summary", { p_user_id: u.sb_user_id });
      const cost = (s?.rates?.redeem_credit ?? 100) * n;
      return confirmCard({
        title: "確認兌換",
        body: `要用 ${cost} 點兌換 ${n} 次檢測嗎?兌換後積點不退回。`,
        confirmLabel: "確認兌換",
        confirmData: `action=redeem_do&n=${n}`,
      });
    }
    case "redeem_do":
      return await doRedeem(u, Math.max(1, Math.min(10, Number(params.get("n") ?? 1))));

    case "draw_confirm": {
      const s = await rpc<{ rates: { lottery_draw: number } }>(
        "rpc_my_reward_summary", { p_user_id: u.sb_user_id });
      return confirmCard({
        title: "確認抽獎",
        body: `抽一次要 ${s?.rates?.lottery_draw ?? 30} 點,獎品隨機。要抽嗎?`,
        confirmLabel: "馬上抽",
        confirmData: "action=draw_do",
      });
    }
    case "draw_do":
      return await doDraw(u);

    case "help":
      return helpCard();

    default:
      return null;
  }
}

export function helpCard(): LineMessage {
  return infoCard({
    title: "❓ 這個帳號可以做什麼",
    rows: [
      { label: "綁定 1234567", value: "綁定會員" },
      { label: "申請挑戰", value: "安排 14 天健康挑戰" },
      { label: "兌換 1234567", value: "用兌換碼加次數" },
      { label: "積點 / 次數 / 推薦碼", value: "查自己的資料" },
      { label: "真人", value: "轉真人客服" },
      { label: "其他任何訊息", value: "AI 健康問答" },
    ],
    note: "下方選單分兩頁:左邊是健康功能,右邊是推薦與積點。",
    altText: "使用說明",
  });
}

export { bindMember, NEED_BIND };
