// Supabase Edge Function: analyze (v4)
// 部署路徑: supabase/functions/analyze/index.ts
//
// v4 改動:
//   1. prompt 與計分拆檔(prompt.ts / score.ts),index 只負責 I/O。
//   2. 眼診納入總分,面部六區與舌診五項改成不等權(見 score.ts)。
//   3. scores.total 改由後端算,AI 只給分項 —— 存進 DB 的分數不再隨 AI 心情漂。

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ANALYZE_PROMPT } from "./prompt.ts";
import { computeScores } from "./score.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { faceBase64, faceType, tongueBase64, tongueType, userId, userName, userPhone } =
      await req.json();

    if (!faceBase64 || !tongueBase64) {
      return json({ error: "缺少圖片資料" }, 400);
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return json({ error: "API Key 未設定" }, 500);
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: faceType || "image/jpeg", data: faceBase64 },
            },
            {
              type: "image",
              source: { type: "base64", media_type: tongueType || "image/jpeg", data: tongueBase64 },
            },
            { type: "text", text: ANALYZE_PROMPT },
          ],
        }],
      }),
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      return json({ error: data?.error?.message || "Anthropic API 錯誤" }, 502);
    }

    const rawText = (data.content || []).map((b: { text?: string }) => b.text || "").join("");

    let report: Record<string, unknown>;
    try {
      const clean = rawText.replace(/```json|```/g, "").trim();
      report = JSON.parse(clean);
    } catch {
      return json({ error: "報告解析失敗", raw: rawText.slice(0, 500) }, 500);
    }

    // 總分一律後端算。三診全缺代表這份報告根本不能用,不要寫進紀錄。
    const scores = computeScores(report);
    if (!scores) {
      return json({ error: "報告缺少評分資料", raw: rawText.slice(0, 500) }, 500);
    }
    report.scores = scores;

    // 在 Server 端存入分析紀錄,避免 Client 大 payload 問題
    let saved = false;
    if (userId && userName) {
      try {
        const supabaseAdmin = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        );
        const { error: insertError } = await supabaseAdmin
          .from("sb_analysis_records")
          .insert({
            user_id: userId,
            user_name: userName,
            user_phone: userPhone || "",
            report: report,
          });
        if (!insertError) saved = true;
      } catch (_e) {
        // 非致命錯誤:分析結果仍回傳給 Client
      }
    }

    return json({ success: true, report, saved });
  } catch (err) {
    return json({ error: (err as Error).message || "請稍後再試" }, 500);
  }
});
