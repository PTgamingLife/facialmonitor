// 12 格選單與文字指令的行為

import {
  appUrl, carousel, confirmCard, infoCard, LineMessage,
  postbackAction, textMsg, toBubble, uriAction,
} from "../_shared/line.ts";
import { rpc, select, selectOne } from "../_shared/db.ts";
import { CATEGORY_ICON, taskOfDay } from "../_shared/tasks.ts";
import { bindMember, challengeDay, firstScanAt, LineUser } from "./member.ts";

// 對外連結。這些「不是機密」—— 它們本來就會印在按鈕與分享訊息上給客戶看,
// 所以直接寫預設值,不用為了改一個網址跑一趟後台設 secret。
// 還是留 env 可以蓋過去:換顧問、換收款帳號時不必重新部署。
const OA_URL         = Deno.env.get("HEALTHBOT_OA_URL") ?? "https://lin.ee/uwmOjc0";
const CONSULTANT_URL = Deno.env.get("HEALTHBOT_CONSULTANT_URL") ?? "https://line.me/ti/p/ZC-w2BuPoi";
const LIFF_ID        = Deno.env.get("HEALTHBOT_LIFF_ID") ?? "2011132698-FNcAIg39";
const CREDIT_PRICE   = Number(Deno.env.get("HEALTHBOT_CREDIT_PRICE") ?? "66");

// LINE Pay 還沒給,刻意留空。空的時候「購買次數」那張卡只會顯示
// 「用積點兌換」,不會給一個按下去 404 的付款按鈕。
const LINEPAY_URL    = Deno.env.get("HEALTHBOT_LINEPAY_URL") ?? "";

function liffUrl(page: string): string {
  return LIFF_ID ? `https://liff.line.me/${LIFF_ID}?p=${page}` : appUrl(page);
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

/** 分享出去的那段文字:官方帳號連結 + 自己的推薦碼,朋友照著做就綁得起來 */
function inviteText(code: string): string {
  return `我在用「看·健」測體質、做健康任務,滿有感的 🌿\n\n`
    + `加入官方帳號:${OA_URL}\n`
    + `我的推薦碼:${code}\n\n`
    + `加好友後傳「小天使 ${code}」給它,你我都有積點可以換檢測次數。`;
}

const NEED_BIND = infoCard({
  title: "先綁定會員才看得到喔",
  subtitle: "在 App 首頁找到你的 7 位會員碼,直接傳「綁定 1234567」給我就完成了。",
  buttons: [{ label: "開啟 App 查會員碼", action: uriAction("開啟 App", appUrl("page-main")), primary: true }],
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

/** 分享推薦:彈出 LINE 的分享視窗,一次把官方帳號與自己的推薦碼送出去 */
async function shareInvite(u: LineUser): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;

  const s = await rpc<{ member_code: string; invitee_stats: { confirmed: number; total: number } }>(
    "rpc_my_reward_summary", { p_user_id: u.sb_user_id });
  const code = s?.member_code ?? "—";

  return infoCard({
    title: "📣 分享給朋友",
    subtitle: "按下面的按鈕會跳出 LINE 的分享視窗,選好友就能一次把官方帳號和你的推薦碼送出去。",
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

/** 最新健康分數 + 與上一次的差額(只有一次檢測就只報最新的) */
async function latestScore(u: LineUser): Promise<LineMessage> {
  if (!u.sb_user_id) return NEED_BIND;

  const r = await rpc<{
    ok: boolean; has_record: boolean; latest: number; latest_at: string;
    has_previous: boolean; previous: number | null; delta: number | null;
  }>("rpc_latest_score", { p_user_id: u.sb_user_id });

  if (!r?.ok || !r.has_record) {
    return infoCard({
      title: "還沒有檢測紀錄",
      subtitle: "做完第一次面舌診之後,這裡就會顯示你的健康分數。",
      buttons: [{ label: "去做面舌診", action: uriAction("去做面舌診", liffUrl("page-challenge")), primary: true }],
      altText: "還沒有檢測紀錄",
    });
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

  return infoCard({
    title: "📈 我的健康分數",
    bigValue: String(r.latest),
    bigLabel: "最新分數",
    rows,
    note: r.has_previous
      ? "分數是跟你自己的上一次比,不是跟別人比。"
      : "再測一次就能看出變化幅度。",
    buttons: [{ label: "再測一次", action: uriAction("再測一次", liffUrl("page-challenge")), primary: true }],
    altText: "我的健康分數",
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

/** 購買檢測次數 */
function buyCredits(): LineMessage {
  return infoCard({
    title: "🛒 購買檢測次數",
    bigValue: `NT$ ${CREDIT_PRICE}`,
    bigLabel: "1 次面舌診檢測",
    subtitle: LINEPAY_URL
      ? "用 LINE Pay 付款後,次數會由專人為你加上。"
      : "付款連結還在設定中,稍後再試。",
    note: "也可以用積點免費兌換 —— 點下方選單的「兌換 / 抽獎」。",
    buttons: [
      ...(LINEPAY_URL
        ? [{ label: `LINE Pay 付款 ${CREDIT_PRICE} 元`, action: uriAction("LINE Pay 付款", LINEPAY_URL), primary: true }]
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
      ...(s.angel ? [] : [{ label: "填寫我的小天使", action: postbackAction("填寫小天使", "action=set_angel") }]),
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
    case "share_invite":
      return await shareInvite(u);
    case "score_latest":
      return await latestScore(u);
    case "daily_checkin":
      return await dailyCheckin(u);
    case "ask_consultant":
      return askConsultant();
    case "buy_credits":
      return buyCredits();

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
        title: "🔗 綁定會員",
        subtitle: "打開 App 首頁,右上角那組 7 位數字就是你的會員碼。\n"
          + "直接傳「綁定 1234567」給我就完成。",
        buttons: [{ label: "開啟 App 查會員碼", action: uriAction("開啟 App", liffUrl("page-main")), primary: true }],
        altText: "綁定會員",
      });

    case "my_reward":
      return await myReward(u);
    case "my_invitees":
      return await myInvitees(u);

    case "set_angel":
      return infoCard({
        title: "✍️ 填寫我的小天使",
        subtitle: "把介紹你來的人的 7 位推薦碼傳給我,格式:小天使 1234567\n"
          + "填寫後你會拿到積點,對方也會。綁定後不能更改,請確認再送出。",
        altText: "填寫小天使",
      });

    case "share_code": {
      if (!u.sb_user_id) return NEED_BIND;
      const s = await rpc<{ member_code: string }>(
        "rpc_my_reward_summary", { p_user_id: u.sb_user_id });
      return textMsg(
        `我在用「看·健」測體質、做健康任務,滿有感的 🌿\n\n`
        + `用我的推薦碼加入,你我都有積點可以換檢測次數:\n`
        + `推薦碼：${s?.member_code ?? "—"}\n\n`
        + `加入後在 LINE 傳「小天使 ${s?.member_code ?? ""}」就完成囉。`,
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
      { label: "小天使 1234567", value: "填寫推薦人" },
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
