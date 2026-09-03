// 12 格選單與文字指令的行為

import {
  appUrl, assetUrl, carousel, confirmCard, infoCard, LineMessage,
  postbackAction, textMsg, toBubble, uriAction,
} from "../_shared/line.ts";
import { rpc, select, selectOne } from "../_shared/db.ts";
import { LineUser } from "./member.ts";
import { scanUrl } from "../_shared/welcome.ts";

// 對外連結。這些「不是機密」—— 它們本來就會印在按鈕與分享訊息上給客戶看,
// 所以直接寫預設值,不用為了改一個網址跑一趟後台設 secret。
// 還是留 env 可以蓋過去:換顧問、換收款帳號時不必重新部署。
const CONSULTANT_URL = Deno.env.get("HEALTHBOT_CONSULTANT_URL") ?? "https://line.me/ti/p/ZC-w2BuPoi";
const LIFF_ID        = Deno.env.get("HEALTHBOT_LIFF_ID") ?? "2011132698-FNcAIg39";
// 中獎後聯絡兌獎的窗口。先跟顧問同一個人,但獨立成一個變數 ——
// 之後要把「兌獎」跟「健康諮詢」拆給不同人時,改 env 就好,不必改程式。
const ANGEL_URL      = Deno.env.get("HEALTHBOT_ANGEL_URL") ?? CONSULTANT_URL;
// 轉盤用獨立的 LIFF app(pagegame,Size = Tall)—— 彈窗開啟,不會離開聊天室。
// 主 App 那個是 Full,點下去會蓋掉整個畫面,玩個抽獎不該有那種份量。
const GAME_LIFF_URL  = Deno.env.get("HEALTHBOT_GAME_LIFF_URL")
  ?? "https://liff.line.me/2011132698-6J9iB9YG";
// 每日挑戰與身邊的祝福各自一支 Tall LIFF(challenge.html / blessing.html)。
// 沒設就退回主 App —— 使用者至少進得去,不會點到一個死連結。
const CHALLENGE_LIFF_URL = Deno.env.get("HEALTHBOT_CHALLENGE_LIFF_URL")
  ?? `https://liff.line.me/${LIFF_ID}`;
const BLESSING_LIFF_URL  = Deno.env.get("HEALTHBOT_BLESSING_LIFF_URL")
  ?? `https://liff.line.me/${LIFF_ID}`;
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
  "img/testimonials/testimonial-04.jpg",
  "img/testimonials/testimonial-03.jpg",
  "img/testimonials/testimonial-02.jpg",
  "img/testimonials/testimonial-01.jpg",
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
  // 開頭那句是鉤子:先讓對方想到自己,再講產品。
  // 這段文字與網頁版 shareRefCode() 必須一致 —— 同一則訊息從兩個地方送出去,
  // 各寫各的就會變成兩套說法(先前就漂移過)。
  return `如果我可以更快知道自己的身體狀況⋯⋯\n\n`
    + `我在用「看·健」測體質、做健康任務,滿有感的 🌿\n\n`
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
      buttons: [{ label: "去做面舌診", action: uriAction("去做面舌診", scanUrl()), primary: true }],
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
    buttons: [{ label: "再測一次", action: uriAction("再測一次", scanUrl()), primary: true }],
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
      { label: "用積點兌換", action: postbackAction("用積點兌換", "action=redeem_confirm&n=1"), tone: "deep" },
      // 購買次數從圖文選單拿掉了,但「次數不夠」最自然的下一步就是買 ——
      // 入口收在這裡,想買的人找得到,不想買的人也不會被推銷。
      { label: "購買次數", action: postbackAction("購買次數", "action=buy_credits"), tone: "mid" },
      { label: "開始檢測", action: uriAction("開始檢測", scanUrl()), tone: "soft" },
    ],
    altText: "剩餘看見健康次數",
  });
}

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
        { label: "開始檢測", action: uriAction("開始檢測", scanUrl()), primary: true },
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
/**
 * 每日挑戰 —— 只負責把人送進半頁式網頁。
 *
 * 題目、解析、計分全部在 challenge.html 裡。這裡不再出題:
 * 內容跟遊戲都在網頁上,bot 再做一套只會變成兩份會漂移的邏輯。
 */
function dailyChallenge(): LineMessage {
  return infoCard({
    title: "🌿 今日挑戰",
    subtitle: "先看今天的主題,滑到下面答一題,一分鐘就好。",
    buttons: [
      { label: "開始今日挑戰", action: uriAction("開始今日挑戰", CHALLENGE_LIFF_URL), primary: true },
    ],
    altText: "今日挑戰",
  });
}

/** 身邊的祝福 —— 同樣只是入口。 */
function blessings(): LineMessage {
  return infoCard({
    title: "💚 身邊的祝福",
    subtitle: "看看大家寫給彼此的話。祝福別人健康,自己也會更健康。",
    buttons: [
      { label: "看看祝福牆", action: uriAction("看看祝福牆", BLESSING_LIFF_URL), primary: true },
    ],
    altText: "身邊的祝福",
  });
}

/** 語氣人格 —— 只影響開場白與引導語,題目與解析三種一律相同。 */
function toneMenu(): LineMessage {
  return infoCard({
    title: "🎙 換一個說話的人",
    subtitle: "發送日早上那句開場白由誰來說。題目與解析不會因此改變。",
    rows: [
      { label: "周小輪", value: "話少,有畫面感(預設)" },
      { label: "康小泳", value: "溫柔細膩,先接住感受" },
      { label: "小XS",  value: "直率明快,愛吐槽" },
    ],
    buttons: [
      { label: "周小輪", action: postbackAction("周小輪", "action=set_tone&t=zhou"), tone: "deep" },
      { label: "康小泳", action: postbackAction("康小泳", "action=set_tone&t=kang"), tone: "mid" },
      { label: "小XS",  action: postbackAction("小XS",  "action=set_tone&t=xs"),   tone: "soft" },
    ],
    altText: "選擇語氣",
  });
}

async function setTone(u: LineUser, tone: string): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;
  const names: Record<string, string> = { zhou: "周小輪", kang: "康小泳", xs: "小XS" };
  if (!names[tone]) return textMsg("沒有這個語氣。");
  const r = await rpc<{ ok: boolean }>("rpc_set_tone", { p_tone: tone });
  if (!r?.ok) return textMsg("設定失敗,請稍後再試。");
  return textMsg(`好,下一次挑戰的早上換 ${names[tone]} 跟你說話 🌿`);
}

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
      buttons: [{ label: "去做面舌診", action: uriAction("去做面舌診", scanUrl()), primary: true }],
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
      { label: "再測一次", action: uriAction("再測一次", scanUrl()), tone: "mid" },
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
  // 兩條路刻意並列:真人有專業與責任但要等,AI 秒回但不做判斷。
  // 讓使用者自己選,比替他決定好 —— 急著問跟需要專業判斷是兩種需求。
  return infoCard({
    title: "👩‍⚕️ 想問誰?",
    subtitle: "真人顧問回覆需要一點時間;健康 AI 可以馬上聊。",
    rows: [
      { label: "北醫健康管理師", value: "專業判斷、報告解讀" },
      { label: "健康 AI", value: "隨時回覆、體質與日常調理" },
    ],
    note: "兩者都不做醫療診斷。急症請直接就醫或撥 119。",
    buttons: [
      ...(CONSULTANT_URL
        ? [{
          label: "問北醫健康管理師",
          action: uriAction("問北醫健康管理師", CONSULTANT_URL),
          tone: "deep" as const,
        }]
        : []),
      {
        label: "問健康 AI",
        // message action:送出去就會走進 AI 對話,不必再開一頁。
        action: { type: "message", label: "問健康 AI", text: "我想問健康問題" },
        tone: "mid" as const,
      },
    ],
    altText: "想問誰",
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

type MyPrize = {
  id: string; name: string; image: string | null;
  status: string; drawn_at: string;
};

/**
 * 兌換/抽獎的第一張:自己抽中的獎品。
 *
 * 沒中過就回 null —— 一張寫著「你還沒有獎品」的卡片只是把兌換往右推一格。
 * 「再接再厲」不算,rpc_my_prizes 已經濾掉(sb_lottery_prizes.is_win)。
 */
function myPrizeBubble(prizes: MyPrize[]): LineMessage | null {
  if (!prizes.length) return null;

  const pending = prizes.filter((p) => p.status !== "claimed");
  const shown = prizes.slice(0, 4);
  const rows = shown.map((p) => ({
    label: p.name,
    value: p.status === "claimed" ? "已領取" : "待領取",
    accent: p.status !== "claimed",
  }));
  if (prizes.length > shown.length) {
    rows.push({ label: "其他", value: `還有 ${prizes.length - shown.length} 份`, accent: false });
  }

  // 待領取的優先當主圖 —— 這張卡是要提醒人去領,不是回顧領過什麼。
  const hero = (pending[0] ?? prizes[0]).image || undefined;

  return toBubble(infoCard({
    title: pending.length ? `🎉 你有 ${pending.length} 份獎品待領取` : "🎁 你抽中過的獎品",
    hero,
    rows,
    note: pending.length
      ? "獎品會一直留著,聯絡大天使確認兌獎方式就好。"
      : "都領完了。想再抽的話往右滑。",
    buttons: pending.length
      ? [{ label: "聯絡大天使兌獎", action: uriAction("聯絡大天使", ANGEL_URL), tone: "deep" as const }]
      : [{ label: "看全部獎品", action: uriAction("看全部獎品", GAME_LIFF_URL), tone: "mid" as const }],
    altText: pending.length ? `你有 ${pending.length} 份獎品待領取` : "你抽中過的獎品",
  }));
}

async function rewardShop(u: LineUser): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;

  const s = await rpc<{ points: number; rates: { redeem_credit: number; lottery_draw: number } }>(
    "rpc_my_reward_summary", { p_user_id: u.sb_user_id });
  const balance = s?.points ?? 0;
  const costRedeem = s?.rates?.redeem_credit ?? 100;
  const costDraw = s?.rates?.lottery_draw ?? 30;

  // 刻意不取 stock:庫存只用來決定「還抽不抽得到」,不對使用者顯示。
  // 把剩餘數量印在卡片上,等於讓人看著數字倒數,反而催出「快沒了才抽」的行為。
  const prizes = await select<{ name: string; description: string; image_url: string }>(
    "sb_lottery_prizes", `active=eq.true&stock=gt.0&select=name,description,image_url&order=sort.asc`);

  // 有沒有免費券會改變整張卡的文案。不查的話卡片會寫「抽一次要 100 點」,
  // 但實際上扣 0 點 —— 使用者看到的跟真正發生的不一樣,那是最糟的一種 bug。
  const mine = await rpc<{ ok: boolean; pending: number; prizes: MyPrize[] }>(
    "rpc_my_prizes", { p_user_id: u.sb_user_id });

  const lot = await rpc<{ free_tickets: number }>(
    "rpc_my_lottery_status", { p_user_id: u.sb_user_id });
  const freeTickets = lot?.free_tickets ?? 0;
  const priceNote = freeTickets > 0
    ? `你有 ${freeTickets} 次免費抽獎機會,這次不扣點。`
    : `每抽 ${costDraw} 點,獎品依機率隨機抽出。`;
  const drawLabel = freeTickets > 0 ? "免費抽一次" : `馬上抽（${costDraw} 點）`;

  // 中獎的人一打開就先看到自己的獎品,不必往右滑找。
  const prizeBubble = myPrizeBubble(mine?.prizes ?? []);

  const bubbles: LineMessage[] = [
    ...(prizeBubble ? [prizeBubble] : []),
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
      note: priceNote,
      buttons: [
        // 轉盤動畫是網頁的東西,LINE 的 Flex Message 放不了動畫。
        // 想看轉盤就得跳到 App;留在 LINE 直接抽也可以,只是沒有動畫。
        { label: "🎡 到轉盤抽", action: uriAction("到轉盤抽", GAME_LIFF_URL), tone: "deep" },
        { label: drawLabel, action: postbackAction("馬上抽", "action=draw_confirm"), tone: "mid" },
      ],
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
    buttons: [{ label: "現在就去檢測", action: uriAction("去檢測", scanUrl()), primary: true }],
    altText: "兌換成功",
  });
}

async function doDraw(u: LineUser): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;
  const r = await rpc<{
    ok: boolean; message?: string; prize_name?: string; prize_image?: string;
    balance?: number; used_free_ticket?: boolean; free_tickets?: number; won?: boolean;
  }>("rpc_draw_lottery", { p_user_id: u.sb_user_id });

  if (!r?.ok) return textMsg(`⚠️ ${r?.message ?? "抽獎失敗,請稍後再試。"}`);

  // 中沒中由後端說了算(sb_lottery_prizes.is_win)。
  // 這裡比對名字的話,獎項改個名就會對著沒中的人說「我們會與你聯繫兌獎」。
  const won = r.won ?? false;
  const rows = [
    ...(r.used_free_ticket ? [{ label: "本次花費", value: "免費券", accent: true }] : []),
    { label: "剩餘積點", value: `${r.balance} 點` },
    ...((r.free_tickets ?? 0) > 0
      ? [{ label: "剩餘免費抽獎", value: `${r.free_tickets} 次`, accent: true }]
      : []),
  ];

  return infoCard({
    title: won ? `🎉 抽中 ${r.prize_name}` : "😅 再接再厲",
    subtitle: won ? undefined : "這次沒中,下次再來試試。",
    hero: won ? (r.prize_image || undefined) : undefined,
    rows,
    note: won ? "按下方按鈕聯絡大天使,確認兌獎方式。" : undefined,
    buttons: won
      ? [{ label: "聯絡大天使兌獎", action: uriAction("聯絡大天使", ANGEL_URL), tone: "deep" as const }]
      : [{ label: "再抽一次", action: postbackAction("再抽一次", "action=draw_confirm"), tone: "mid" as const }],
    altText: won ? `抽中 ${r.prize_name}` : "再接再厲",
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
    // 每日挑戰的四個舊 action:內容與作答都搬進半頁式網頁了,
    // 一律導向同一個入口。已經發出去的舊卡片還帶著這些 data,不能拿掉。
    case "daily_checkin":
    case "daily_challenge":
    case "challenge_answer":
    case "tip_detail":
    case "tip_preview_detail":
    case "tip_disclaimer_agree":
      return dailyChallenge();

    case "blessings":
      return blessings();
    case "tone_menu":
      return toneMenu();
    case "set_tone":
      return await setTone(u, params.get("t") ?? "");

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
    // task_today 與 challenge_apply 是 14 天挑戰的,功能已移除。
    // 舊卡片上的按鈕改成導向今日挑戰,而不是按了沒反應。
    case "task_today":
    case "challenge_apply":
      return dailyChallenge();

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

    // 推薦人現在只走專屬網址自動綁定,不再手動輸入推薦碼
    case "set_angel":
      return await shareInvite(u);

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
      const lot = await rpc<{ free_tickets: number; cost: number }>(
        "rpc_my_lottery_status", { p_user_id: u.sb_user_id });
      const free = lot?.free_tickets ?? 0;
      return confirmCard({
        title: "確認抽獎",
        body: free > 0
          ? `這次用掉 1 張免費抽獎券,不扣積點。你還有 ${free} 張。獎品隨機,要抽嗎?`
          : `抽一次要 ${lot?.cost ?? 100} 點,獎品隨機。要抽嗎?`,
        confirmLabel: free > 0 ? "免費抽" : "馬上抽",
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
      { label: "挑戰", value: "打開今天的健康挑戰" },
      { label: "祝福", value: "看看身邊的祝福" },
      { label: "語氣", value: "換一個說話的人" },
      { label: "兌換 1234567", value: "用兌換碼加次數" },
      { label: "積點 / 次數 / 分數 / 推薦碼", value: "查自己的資料" },
      { label: "真人", value: "轉真人客服" },
      { label: "其他任何訊息", value: "AI 健康問答" },
    ],
    note: "下方選單分兩頁:左邊是健康功能,右邊是連結與積點。",
    altText: "使用說明",
  });
}

export { NEED_BIND };

