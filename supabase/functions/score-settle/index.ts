// 月度分數結算 — 當月進步達門檻就發積點給本人與小天使
//
// 觸發方式:
//   a) analyze 完成後打一次(只結算那一位):
//      POST { "user_id": "<uuid>" }
//   b) 每月 1 號排程補算上月(全體):
//      POST { "month_key": "2026-07", "all": true }
//
// 部署:supabase functions deploy score-settle
// 這支不對外開放,靠 Supabase JWT 驗證(不要加 --no-verify-jwt)。

import { infoCard, push } from "../_shared/line.ts";
import { rpc, select, selectOne } from "../_shared/db.ts";

type SettleResult = {
  ok: boolean;
  rewarded?: boolean;
  delta?: number;
  first_score?: number;
  best_score?: number;
  points_self?: number;
  points_angel?: number;
  angel_id?: string | null;
  error?: string;
};

function monthKeyNow(): string {
  // sv-SE 會給 YYYY-MM-DD,取前 7 碼就是 YYYY-MM
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 7);
}

/** 找出這位會員綁定的 LINE 帳號(沒綁就不推播) */
async function lineIdOf(sbUserId: string): Promise<string | null> {
  const row = await selectOne<{ line_user_id: string }>(
    "line_users",
    `sb_user_id=eq.${sbUserId}&unfollowed_at=is.null&select=line_user_id`,
  );
  return row?.line_user_id ?? null;
}

async function nameOf(sbUserId: string): Promise<string> {
  const row = await selectOne<{ name: string }>("sb_users", `id=eq.${sbUserId}&select=name`);
  return row?.name ?? "你的好友";
}

/**
 * 通知本人與小天使。
 * ⚠️ push 會計費,只在真的發了獎的時候送。
 */
async function notify(userId: string, r: SettleResult) {
  const selfLine = await lineIdOf(userId);
  if (selfLine) {
    await push(selfLine, infoCard({
      title: "🎉 本月健康分數達標",
      bigValue: `+${r.delta}`,
      bigLabel: "本月進步幅度",
      rows: [
        { label: "起始 → 最佳", value: `${r.first_score} → ${r.best_score}`, accent: true },
        { label: "獲得積點", value: `${r.points_self} 點`, accent: true },
      ],
      note: "積點可以換檢測次數或參加抽獎,點下方選單的「兌換 / 抽獎」。",
      altText: "本月健康分數達標",
    }));
  }

  if (r.angel_id && (r.points_angel ?? 0) > 0) {
    const angelLine = await lineIdOf(r.angel_id);
    if (angelLine) {
      const who = await nameOf(userId);
      await push(angelLine, infoCard({
        title: "👼 你推薦的人變健康了",
        subtitle: `${who} 這個月的健康分數進步了 ${r.delta} 分。`,
        rows: [{ label: "你獲得積點", value: `${r.points_angel} 點`, accent: true }],
        note: "帶人變健康就有回饋,繼續分享你的推薦碼吧。",
        altText: "你推薦的人本月進步了",
      }));
    }
  }
}

async function settleOne(userId: string, monthKey: string, silent: boolean) {
  const r = await rpc<SettleResult>("rpc_settle_score", {
    p_user_id: userId,
    p_month_key: monthKey,
  });

  if (r?.ok && r.rewarded && !silent) {
    await notify(userId, r);
  }
  return { user_id: userId, ...(r ?? { ok: false, error: "rpc_failed" }) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  let body: { user_id?: string; month_key?: string; all?: boolean; silent?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const monthKey = body.month_key ?? monthKeyNow();
  const silent = body.silent === true; // true = 不推播(省錢的補算用)

  // 單一使用者
  if (body.user_id) {
    const result = await settleOne(body.user_id, monthKey, silent);
    return Response.json({ ok: true, month_key: monthKey, results: [result] });
  }

  if (!body.all) {
    return Response.json({ ok: false, error: "need user_id or all=true" }, { status: 400 });
  }

  // 全體補算:只找當月真的有檢測紀錄的人,避免掃全表
  const rows = await select<{ user_id: string }>(
    "sb_analysis_records",
    `select=user_id&created_at=gte.${monthKey}-01&limit=5000`,
  );
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];

  const results = [];
  for (const id of ids) {
    results.push(await settleOne(id, monthKey, silent));
  }

  return Response.json({
    ok: true,
    month_key: monthKey,
    scanned: ids.length,
    rewarded: results.filter((r) => (r as SettleResult).rewarded).length,
    results,
  });
});
