import { authorizeCronHash, isInternalCall } from "../_shared/cron-auth.ts";
import { APP_BASE_URL, assetUrl, infoCard, push, uriAction } from "../_shared/line.ts";
import { insert, patch, rpc, select } from "../_shared/db.ts";
// 欄位形狀、輸出 schema、寫稿指令都在 _shared/tip-schema.ts ——
// line-webhook 的新聞轉稿也用同一份,兩邊各寫一份遲早會分叉。
import {
  BATCH_INSTRUCTIONS, batchSchema, kindOf, responseText, RISK_WORDS, TIP_INSTRUCTIONS, TipDraft,
} from "../_shared/tip-schema.ts";

const PLAN_SECRET_HASH = Deno.env.get("HEALTHBOT_TIP_PLAN_SECRET_SHA256") ?? "";
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("HEALTHBOT_OPENAI_KEY") ?? "";
const MODEL = Deno.env.get("HEALTHBOT_OPENAI_MODEL") ?? "gpt-4.1-mini";
const ADMIN_LINE_ID = Deno.env.get("HEALTHBOT_ADMIN_LINE_USER_ID") ?? "";
const SOURCE_URLS = (Deno.env.get("HEALTHBOT_TIP_SOURCE_URLS") ?? [
  "https://www.hpa.gov.tw/Pages/List.aspx?nodeid=113",
  "https://www.mohw.gov.tw/lp-16-1.html",
].join(",")).split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);

const ALLOWED_SOURCE_HOSTS = new Set(SOURCE_URLS.map((u) => {
  try { return new URL(u).hostname; } catch { return ""; }
}).filter(Boolean));



function taipeiDate(offsetDays = 0): Date {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  now.setHours(12, 0, 0, 0);
  now.setDate(now.getDate() + offsetDays);
  return now;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nextMonday(): Date {
  const d = taipeiDate();
  const add = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + add);
  return d;
}

function stripHtml(s: string): string {
  return s.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 8_000);
}

async function fetchSource(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "HealthBotTipPlanner/1.0" } });
    if (!res.ok) return `[來源讀取失敗 ${res.status}] ${url}`;
    const html = await res.text();
    const sourceHost = new URL(url).hostname;
    const articleUrls = [...html.matchAll(/href=["']([^"'#]+)["']/gi)]
      .map((match) => {
        try { return new URL(match[1], url); } catch { return null; }
      })
      .filter((candidate): candidate is URL => Boolean(
        candidate && candidate.hostname === sourceHost &&
        (/\/Pages\/Detail/i.test(candidate.pathname) || /\/cp-\d+-\d+-\d+\.html$/i.test(candidate.pathname))
      ))
      .map((candidate) => candidate.href)
      .filter((candidate, index, all) => all.indexOf(candidate) === index)
      .slice(0, 3);
    const articles = await Promise.all(articleUrls.map(async (articleUrl) => {
      try {
        const article = await fetch(articleUrl, {
          signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "HealthBotTipPlanner/1.0" },
        });
        if (!article.ok) return "";
        return `URL: ${articleUrl}\n${stripHtml(await article.text())}`;
      } catch { return ""; }
    }));
    return [`URL: ${url}\n${stripHtml(html)}`, ...articles.filter(Boolean)].join("\n\n");
  } catch (err) {
    console.warn("tip source failed", url, err);
    return `[來源讀取失敗] ${url}`;
  }
}


async function generate(dates: string[], sources: string[], taken: string[]): Promise<TipDraft[]> {
  const material = sources.map((s, i) => `<SOURCE_${i + 1}>\n${s}\n</SOURCE_${i + 1}>`).join("\n\n");
  const avoid = taken.length
    ? `\n\n這兩週已經排定的主題(不可重複,也不可換句話說同一件事):\n${taken.map((t) => `- ${t}`).join("\n")}`
    : "";
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", signal: AbortSignal.timeout(90_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: MODEL, store: false,
      instructions: [
        ...TIP_INSTRUCTIONS,
        ...BATCH_INSTRUCTIONS,
      ].join("\n"),
      input: `為以下日期各產生一則健康資訊：${dates.join(", ")}${avoid}\n\n參考素材：\n${material}`,
      text: { format: { type: "json_schema", name: "daily_health_tips", strict: true, schema: batchSchema(dates) } },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const parsed = JSON.parse(responseText(await res.json())) as { tips: TipDraft[] };
  const byDate = new Map(parsed.tips.map((t) => [t.date, t]));
  if (byDate.size !== dates.length || dates.some((d) => !byDate.has(d))) throw new Error("OpenAI dates incomplete");
  return dates.map((d) => byDate.get(d)!);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  // 兩條門:pg_cron 帶密鑰,管理中心(admin-api)帶 service role key。
  // 後者不是放寬 —— 見 _shared/cron-auth.ts 的 isInternalCall。
  if (!isInternalCall(req)) {
    const denied = await authorizeCronHash(req, "x-tip-plan-secret", PLAN_SECRET_HASH);
    if (denied) return denied;
  }
  if (!OPENAI_KEY) return Response.json({ ok: false, error: "openai_not_configured" }, { status: 503 });

  /*
   * 手動重產:body 帶 { "dates": ["2026-10-22", ...] } 就只處理那幾天。
   *
   * 為什麼需要這條路:排程的視窗是「下週一起算 14 天」,所以本週還沒發的
   * 日子永遠落在視窗外 —— 改了寫稿規則之後,已經排好的那幾天不可能跟上,
   * 只會照舊用舊格式發出去。原本連「指定重產某一天」的辦法都沒有。
   *
   * 與排程的兩點差異:
   *   · 跳過「兩週只跑一次」的防重複閘(那是給 cron 用的)
   *   · 已核准的那幾天也會被覆蓋 —— 指定日期就是明講要重寫。
   *     content_version 會 +1,但舊文字不會留下來。
   *
   * 身分仍然走同一個 x-tip-plan-secret,沒有放寬。
   */
  // authorizeCronHash 只讀 header,沒有碰過 body,所以這裡讀得到。
  let manualDates: string[] = [];
  const body = await req.json().catch(() => ({})) as { dates?: unknown };
  if (body?.dates !== undefined) {
    const raw = Array.isArray(body.dates) ? body.dates : [];
    manualDates = raw
      .filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
      .slice(0, 14);
    // 有帶 dates 卻一個都解析不出來 = 打錯了。直接報錯,不要安靜地
    // 退回排程模式 —— 那會變成「跑了但什麼都沒重產」,而且看不出原因。
    if (!manualDates.length) {
      return Response.json(
        { ok: false, error: "bad_dates", message: "dates 要是 YYYY-MM-DD 的字串陣列" },
        { status: 400 },
      );
    }
  }

  // 要產哪幾天,問資料庫的 is_push_day —— 這裡自己算一次奇偶,
  // 遲早會跟推播端對不起來,而且錯了只會表現成「那天沒收到」。
  // 視窗仍是 14 個日曆天(排程兩週跑一次),只是裡面剩下 7 個發送日。
  const dates = manualDates.length
    ? manualDates
    : (await rpc<string[]>("rpc_push_days", {
      p_start: isoDate(nextMonday()), p_days: 14,
    }) ?? []);
  if (!dates.length) {
    return Response.json({ ok: false, error: "no_push_days" }, { status: 500 });
  }

  // 指定日期時不檢查發送日:要重產的那天本來就已經排了內容,
  // 它當然是發送日。多檢查一次只會在換過週期之後擋住自己。
  if (!manualDates.length) {
    const recentCutoff = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString();
    const recentRuns = await select<{ id: string }>(
      "sb_tip_plan_runs",
      `select=id&status=eq.completed&started_at=gte.${encodeURIComponent(recentCutoff)}&order=started_at.desc&limit=1`,
    );
    if (recentRuns.length) {
      return Response.json({ ok: true, created: 0, message: "biweekly plan already completed" });
    }
  }
  const existing = await select<{
    id: string; tip_date: string; status: string; content_version: number; title: string;
  }>(
    "sb_daily_tips",
    `select=id,tip_date,status,content_version,title&tip_date=gte.${dates[0]}&tip_date=lte.${dates.at(-1)}&limit=100`,
  );
  const byExistingDate = new Map(existing.map((row) => [row.tip_date, row]));
  // 指定日期 = 明講要重寫,已核准的也算在內;
  // 排程則只補空的與被退稿的,不會動到已排好的內容。
  const have = manualDates.length
    ? new Set<string>()
    : new Set(existing.filter((row) => row.status !== "rejected").map((row) => row.tip_date));
  const missing = dates.filter((d) => !have.has(d));
  if (!missing.length) return Response.json({ ok: true, created: 0, message: "future push days already covered" });

  const run = await insert("sb_tip_plan_runs", {
    period_start: dates[0], period_end: dates.at(-1), requested_dates: missing.length, status: "running",
  }, { returning: true });
  const runId = String(run?.id ?? "");

  try {
    const sources = await Promise.all(SOURCE_URLS.map(fetchSource));
    // 重生被退回的日期時，其餘日子已經有內容了。不告訴模型的話，
    // 它會端出跟已核准那幾則雷同的東西，等於再被退一次。
    const taken = existing
      .filter((row) => row.status !== "rejected")
      // 手動重產時要避開的是「其他天」的主題,不包含正在重寫的這幾天 ——
      // 把自己列進去等於叫模型避開自己,它會硬換一個不相干的主題。
      .filter((row) => !missing.includes(row.tip_date))
      .map((row) => `${row.tip_date} ${row.title ?? ""}`.trim());
    const tips = await generate(missing, sources, taken);
    let warnings = 0;
    let created = 0;
    for (const tip of tips) {
      const text = `${tip.title}\n${tip.summary}\n${tip.body}\n${tip.detail_points.join("\n")}`;
      const flags = RISK_WORDS.filter((w) => text.includes(w));
      const safeSources = tip.source_urls.filter((u) => {
        try { return ALLOWED_SOURCE_HOSTS.has(new URL(u).hostname); } catch { return false; }
      });
      if (!safeSources.length) flags.push("來源網址不在白名單");
      // 這裡算的 flags 只用來統計、寫進 run 紀錄;
      // 真正擋不擋得住是資料庫那支 tip_auto_check 說了算。
      if (flags.length) warnings++;
      const kind = kindOf(tip.date);
      const values = {
        tip_date: tip.date, kind,
        title: tip.title, summary: tip.summary, body: tip.body,
        detail_points: tip.detail_points, source_urls: safeSources,
        source_name: tip.source_name, source_date: tip.date.slice(0, 7).replace("-", "/"),
        intros: tip.intros, game_titles: tip.game_titles,
        action_today: tip.action_today,
        // 祝福關卡那天不出選擇題:挑戰是「寫一句祝福」。
        // 硬塞一題進去,網頁會同時顯示題目與輸入框。
        quiz_question: kind === "blessing" ? null : tip.quiz_question,
        quiz_options:  kind === "blessing" ? null : tip.quiz_options,
        quiz_answer:   kind === "blessing" ? null : tip.quiz_answer,
        quiz_explain:  kind === "blessing" ? null : tip.quiz_explain,
        active: true,
        generated_batch_id: runId || null, image_url: assetUrl("bg.png"),
        // status / risk_flags / approved_at 由 trg_tip_auto_check 決定 ——
        // 這裡寫死 draft 的話,通過檢查的稿也會停在草稿。
        rejected_at: null, rejected_by: null, review_note: null,
      };
      // tip_date 有唯一鍵,那天已經有內容就只能 patch ——
      // insert 會撞鍵。排程只會碰到 rejected,手動重產則可能碰到任何狀態。
      const prev = byExistingDate.get(tip.date);
      const overwrite = prev && (manualDates.length > 0 || prev.status === "rejected");
      const saved = overwrite
        ? await patch("sb_daily_tips", `id=eq.${prev.id}`, {
          ...values, content_version: (prev.content_version || 1) + 1,
        })
        : await insert("sb_daily_tips", values, { returning: true });
      if (!saved) throw new Error(`failed to save tip ${tip.date}`);
      created++;
    }
    if (runId) await patch("sb_tip_plan_runs", `id=eq.${runId}`, {
      status: "completed", created_count: created, warning_count: warnings, completed_at: new Date().toISOString(),
    });

    let notified = false;
    if (ADMIN_LINE_ID) {
      // v2 沒有待審佇列了。這則只是回報結果:通過自動檢查的已經直接排程,
      // 被擋下來的才需要人進去看。
      const blocked = await select<{ tip_date: string }>(
        "sb_daily_tips",
        `select=tip_date&status=eq.draft&tip_date=gte.${dates[0]}&tip_date=lte.${dates.at(-1)}&limit=20`,
      );
      notified = await push(ADMIN_LINE_ID, infoCard({
        title: `📝 本期排了 ${created} 則每日挑戰`,
        rows: [
          { label: "日期", value: `${dates[0]} ～ ${dates.at(-1)}` },
          { label: "已排定", value: `${created - blocked.length} 則` },
          { label: "被檢查擋下", value: `${blocked.length} 則`, accent: blocked.length > 0 },
        ],
        note: blocked.length
          ? `擋下的日期:${blocked.map((b) => b.tip_date).join("、")}。這幾天目前沒有內容。`
          : "全部通過自動檢查,不需要你做任何事。",
        buttons: blocked.length
          ? [{ label: "去看被擋下的", action: uriAction("去看", `${APP_BASE_URL}/index.html?p=page-admin&adminTab=tips`), primary: true }]
          : [],
        altText: `本期排了 ${created} 則每日挑戰`,
      }));
    }
    if (runId) await patch("sb_tip_plan_runs", `id=eq.${runId}`, { notification_status: notified ? "sent" : "failed" });
    return Response.json({ ok: true, run_id: runId, created, warnings, notified });
  } catch (err) {
    console.error("tip-plan failed", err);
    if (runId) await patch("sb_tip_plan_runs", `id=eq.${runId}`, {
      status: "failed", error: String(err).slice(0, 1000), completed_at: new Date().toISOString(),
    });
    return Response.json({ ok: false, error: "planning_failed" }, { status: 500 });
  }
});
