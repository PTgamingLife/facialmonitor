// 管理員發送中心的後端
//
// 一支 POST 端點,動作放在 body 的 action。
// 前端是 admin.html(LIFF),每次呼叫都帶 LIFF 的 ID token。
//
// 🔒 門禁:身分一律向 LINE 查證,絕不相信前端送來的 userId。
//    這支背後是 service role,而且做得到群發 —— 開錯等於把帳號交出去。
//    詳見 auth.ts。
//
// 部署:--no-verify-jwt
//   (呼叫的當下使用者沒有 Supabase session,這支自己的門是 LINE ID token。)
//
// 需要的 secrets 全是現成的,不用新增:
//   HEALTHBOT_LIFF_CHANNEL_ID / HEALTHBOT_ADMIN_LINE_USER_ID / HEALTHBOT_APP_ORIGIN

import { cors, json, verify } from "./auth.ts";
import * as bc from "./broadcast.ts";
import * as content from "./content.ts";
import * as menu from "./menu.ts";
import { overview } from "./overview.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400, origin);
  }

  const who = await verify(String(body.id_token ?? ""));
  if (!who) return json({ ok: false, error: "not_logged_in" }, 401, origin);

  const action = String(body.action ?? "");

  // whoami 是唯一不需要擁有者身分的動作。
  //
  // 它只告訴你「你自己是誰」,洩漏不了別人的東西,而它存在的理由是:
  // 還沒設定 HEALTHBOT_ADMIN_LINE_USER_ID 時,頁面要能把你的 LINE user ID
  // 顯示出來讓你複製去設定。否則第一次使用會卡在「你沒有權限」,
  // 而正確的下一步(去哪裡設、設什麼)完全看不到。
  if (action === "whoami") return json({ ok: true, who }, 200, origin);

  if (!who.is_owner) {
    return json({
      ok: false,
      error: "not_owner",
      owner_configured: who.owner_configured,
      your_line_user_id: who.line_user_id,
    }, 403, origin);
  }

  try {
    switch (action) {
      case "overview":
        return json({ ok: true, ...(await overview()) }, 200, origin);

      case "broadcast_list":
        return json({ ok: true, items: await bc.list() }, 200, origin);

      case "broadcast_delete": {
        const id = String(body.id ?? "");
        if (!id) return json({ ok: false, error: "缺少 id。" }, 400, origin);
        return json({ ...(await bc.drop(id)) }, 200, origin);
      }

      // 以下四個都吃同一份草稿,而且都先過同一道清洗 ——
      // 預覽過關、送出才不會因為欄位不同而長得不一樣。
      case "broadcast_preview":
      case "broadcast_test":
      case "broadcast_send":
      case "broadcast_schedule": {
        const parsed = bc.clean((body.draft ?? {}) as Record<string, unknown>);
        if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400, origin);
        const d = parsed.draft;

        if (action === "broadcast_preview") return json({ ok: true, ...(await bc.preview(d)) }, 200, origin);
        if (action === "broadcast_test") return json({ ...(await bc.test(d, who.line_user_id)) }, 200, origin);
        if (action === "broadcast_schedule") return json({ ...(await bc.schedule(d)) }, 200, origin);

        // 真的要送了。前端必須明確帶 confirm: true ——
        // 少打一個字就群發出去是收不回來的。
        if (body.confirm !== true) {
          return json({ ok: false, error: "送出需要 confirm: true。" }, 400, origin);
        }
        return json({ ...(await bc.send(d)) }, 200, origin);
      }

      // ── 每日內容 ──────────────────────────────────────
      case "tips_schedule":
        return json({ ok: true, ...(await content.schedule()) }, 200, origin);

      case "tips_reject":
        return json({ ...(await content.reject(String(body.day ?? ""))) }, 200, origin);

      case "tips_regenerate": {
        const dates = Array.isArray(body.dates) ? body.dates.map(String) : [];
        return json({ ...(await content.regenerate(dates)) }, 200, origin);
      }

      // ── 圖文選單 ──────────────────────────────────────
      case "menu_current":
        return json({ ok: true, ...(await menu.current()) }, 200, origin);

      case "menu_rebuild": {
        // 真的重建會先刪掉舊選單,中間幾秒鐘客戶看到的是空的。
        // 所以跟群發一樣,非 dry 必須明確帶 confirm: true。
        const dry = body.dry !== false;
        if (!dry && body.confirm !== true) {
          return json({ ok: false, error: "重建需要 confirm: true。" }, 400, origin);
        }
        return json({ ...(await menu.rebuild(dry)) }, 200, origin);
      }

      default:
        return json({ ok: false, error: "unknown_action" }, 400, origin);
    }
  } catch (err) {
    console.error("admin-api failed:", action, err);
    return json({ ok: false, error: String(err).slice(0, 300) }, 500, origin);
  }
});
