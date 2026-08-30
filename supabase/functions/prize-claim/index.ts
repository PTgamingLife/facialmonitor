// 後台按「確認領取」:標記領取 + 推一則 LINE 通知給中獎者
//
// 為什麼不讓前端直接呼叫 RPC 就好:推播要打 LINE API,需要 channel token。
// 那把鑰匙不能出現在瀏覽器裡 —— 誰都能打開 devtools 看。
//
// 管理員身分不在這裡判斷,交給 rpc_admin_confirm_claim 裡的 is_admin_caller()。
// 這支只是帶著呼叫者自己的 JWT 去問資料庫「你准不准」,權限判斷只有一份。
//
// 先標記再推播。反過來的話,推播成功但標記失敗會變成「使用者收到通知、
// 後台卻還顯示待領取」,下次再按又推一次。寧可漏一則通知,不要重複發。

import { infoCard, push } from "../_shared/line.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, message: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return json({ ok: false, message: "請先登入。" }, 401);
  }

  let drawId = "";
  try {
    drawId = String((await req.json())?.draw_id ?? "");
  } catch {
    return json({ ok: false, message: "格式錯誤。" }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(drawId)) {
    return json({ ok: false, message: "缺少或不合法的 draw_id。" }, 400);
  }

  // 帶呼叫者的 JWT 去跑 RPC —— 管理員檢查在資料庫裡做。
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_admin_confirm_claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": ANON_KEY,
      "Authorization": auth,
    },
    body: JSON.stringify({ p_draw_id: drawId }),
  });

  const out = await res.json().catch(() => null);
  if (!res.ok || !out?.ok) {
    return json({ ok: false, message: out?.message ?? "確認失敗。" }, res.ok ? 400 : res.status);
  }

  // 沒綁 LINE 的人推不了,但領取本身已經成立 —— 回 ok 並說明,
  // 不要因為推不出去就讓後台顯示失敗、讓人重按。
  if (!out.line_user_id) {
    return json({ ok: true, notified: false, message: "已確認領取（此會員未綁定 LINE，未發送通知）" });
  }

  let notified = true;
  try {
    await push(out.line_user_id, infoCard({
      title: "🎁 獎品已確認領取",
      subtitle: `你抽中的「${out.prize_name}」已經完成領取確認。`,
      rows: [{ label: "獎品", value: out.prize_name, accent: true }],
      note: "如果你還沒實際拿到獎品，或這則通知有誤，請直接回覆這個對話。",
      altText: `獎品「${out.prize_name}」已確認領取`,
    }));
  } catch (err) {
    console.error("push failed", err);
    notified = false;
  }

  return json({
    ok: true,
    notified,
    message: notified ? "已確認領取並通知本人" : "已確認領取（通知發送失敗）",
  });
});
