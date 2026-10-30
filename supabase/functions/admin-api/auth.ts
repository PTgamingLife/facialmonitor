/**
 * 管理中心的門。
 *
 * 規則只有一條:**身分一律向 LINE 查證,絕不相信前端送來的 userId。**
 * 這支背後是 service role,開錯等於把整個資料庫交出去。
 *
 * 流程:頁面送 LIFF 的 ID token → 拿去 LINE 驗 → 得到 sub(LINE user ID)
 *      → 比對 HEALTHBOT_ADMIN_LINE_USER_ID。
 *
 * 需要的 secrets(都是現成的,不用新增):
 *   HEALTHBOT_LIFF_CHANNEL_ID       LINE Login channel ID(liff-auth 已在用)
 *   HEALTHBOT_ADMIN_LINE_USER_ID    擁有者的 LINE user ID(新聞轉稿已在用)
 *   HEALTHBOT_APP_ORIGIN            允許的網頁來源(liff-auth 已在用)
 */

import { isOwner, ownerConfigured } from "../_shared/owner.ts";

const LIFF_CHANNEL_ID = Deno.env.get("HEALTHBOT_LIFF_CHANNEL_ID") ?? "";
const APP_ORIGIN = (Deno.env.get("HEALTHBOT_APP_ORIGIN") ?? "").replace(/\/$/, "");

export function cors(origin: string | null): Record<string, string> {
  // 白名單比對,不回 * —— 這支做的是群發與資料庫寫入。
  const allow = APP_ORIGIN && origin === APP_ORIGIN ? origin : APP_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

export type Who = {
  line_user_id: string;
  name?: string;
  is_owner: boolean;
  owner_configured: boolean;
};

/**
 * 驗 ID token。回 null = 不可信,一律當作沒登入。
 *
 * LINE 已經驗過簽章、aud 與 exp;這裡再確認一次 aud,
 * 避免 channel 設定被改動時默默放行別的 channel 的 token。
 */
export async function verify(idToken: string): Promise<Who | null> {
  if (!idToken || !LIFF_CHANNEL_ID) return null;
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: LIFF_CHANNEL_ID }),
  });
  if (!res.ok) {
    console.error("line verify failed:", res.status, await res.text());
    return null;
  }
  const p = await res.json() as { sub?: string; aud?: string; name?: string };
  if (!p.sub || p.aud !== LIFF_CHANNEL_ID) return null;
  return {
    line_user_id: p.sub,
    name: p.name,
    is_owner: isOwner(p.sub),
    owner_configured: ownerConfigured(),
  };
}
