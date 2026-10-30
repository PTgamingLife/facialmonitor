/**
 * 每日內容的審稿。
 *
 * 推播日怎麼算,問的是資料庫那支 is_push_day —— 不在這裡自己算日期餘數。
 * 節奏改過一次(每日 → 三日一次),當時就是因為只有一個地方算才沒出事。
 * 一次問 20 天是 20 個 RPC,但都是平行的,而且這一頁開一次只問一次。
 */

import { patch, rpc, select } from "../_shared/db.ts";

const TAIPEI = "Asia/Taipei";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

type Tip = {
  tip_date: string; kind: string; status: string; title: string;
  summary: string | null; quiz_question: string | null; action_today: string | null;
  content_version: number;
};

function todayTaipei(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: TAIPEI });
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 從今天起算 horizon 天內的推播日,最多取 limit 個。 */
async function pushDays(limit: number, horizon = 75): Promise<string[]> {
  const start = todayTaipei();
  const days = Array.from({ length: horizon }, (_, i) => addDays(start, i));
  const flags = await Promise.all(days.map((d) => rpc<boolean>("is_push_day", { p_day: d })));
  return days.filter((_, i) => flags[i] === true).slice(0, limit);
}

/** 推播日表 + 每天的內容狀態。沒有內容的那幾天才是重點。 */
export async function schedule(limit = 16) {
  const days = await pushDays(limit);
  if (!days.length) return { days: [] };

  const tips = await select<Tip>("sb_daily_tips",
    `select=tip_date,kind,status,title,summary,quiz_question,action_today,content_version`
    + `&active=eq.true&tip_date=gte.${days[0]}&tip_date=lte.${days.at(-1)}&limit=200`);
  const byDate = new Map(tips.map((t) => [t.tip_date, t]));

  return {
    today: todayTaipei(),
    days: days.map((d) => ({ day: d, tip: byDate.get(d) ?? null })),
  };
}

/**
 * 退稿。不刪 —— 改成 rejected。
 *
 * tip-plan 的重產會把 rejected 當成「這一天要重寫」,
 * 而刪掉會讓那天看起來像從來沒排過,看不出是被退的。
 */
export async function reject(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: "日期看不懂。" };
  const ok = await patch("sb_daily_tips",
    `tip_date=eq.${day}&active=eq.true`,
    { status: "rejected" });
  return ok ? { ok: true } : { ok: false, error: "退稿失敗。" };
}

/**
 * 指定日期重產。走 tip-plan,不在這裡複製一份寫稿邏輯。
 *
 * ⚠️ tip-plan 的「要避開的主題」是從重產日期的頭尾之間撈的,
 *    範圍外的日子它看不到。只重產一天時它幾乎是瞎的 ——
 *    畫面上要講這件事,不然使用者會以為重產一次就會不一樣。
 */
export async function regenerate(dates: string[]) {
  const clean = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 14);
  if (!clean.length) return { ok: false, error: "沒有看得懂的日期。" };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/tip-plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // 同一個專案裡的內部呼叫。見 _shared/cron-auth.ts 的 isInternalCall。
      "x-internal-key": SERVICE_KEY,
    },
    body: JSON.stringify({ dates: clean }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.ok) {
    return { ok: false, error: String(body?.error ?? body?.message ?? `tip-plan ${res.status}`) };
  }
  return { ok: true, created: body.created ?? 0, warnings: body.warnings ?? 0 };
}
