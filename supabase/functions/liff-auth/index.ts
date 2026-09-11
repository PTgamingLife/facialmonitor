// 用 LINE 身分換一組 Supabase session
//
// 網頁在 LINE 裡開啟(LIFF)時,使用者已經是登入狀態,不該再按一次登入。
// 前端把 LIFF 給的 ID token 丟過來,這支負責:
//   1. 拿 token 去 LINE 驗(絕不能相信前端自己說的 userId)
//   2. 找到或建立這個人的 sb_users
//   3. 順手把 line_users.sb_user_id 補上,讓 bot 立刻認得他
//   4. 發一組 Supabase session 回去
//
// 部署:supabase functions deploy liff-auth --no-verify-jwt
//   (呼叫的當下使用者還沒有 Supabase session,所以不能要求 JWT;
//    這支自己的門是「LINE ID token 驗得過」。)
//
// 需要的 secrets:
//   HEALTHBOT_LIFF_CHANNEL_ID   LINE Login channel 的 Channel ID
//                               ⚠️ 必須與 Messaging API channel 在同一個 Provider,
//                               否則 LIFF 拿到的 userId 跟 webhook 收到的不是同一組。
//   HEALTHBOT_APP_ORIGIN        允許呼叫的網頁來源(CORS),例如
//                               https://ptgaminglife.github.io

import { push } from "../_shared/line.ts";
import { boundCard } from "../_shared/welcome.ts";
import { ensureAccount, syntheticEmail } from "../_shared/account.ts";

const LIFF_CHANNEL_ID = Deno.env.get("HEALTHBOT_LIFF_CHANNEL_ID") ?? "";
const APP_ORIGIN = (Deno.env.get("HEALTHBOT_APP_ORIGIN") ?? "").replace(/\/$/, "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function cors(origin: string | null): Record<string, string> {
  // 白名單比對,不要無腦回 *:這支會發 session,來源必須是我們自己的網頁
  const allow = APP_ORIGIN && origin === APP_ORIGIN ? origin : APP_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

function adminHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

/** 拿 ID token 去 LINE 驗。回傳 null = 不可信,一律當作沒登入。 */
async function verifyLineToken(idToken: string): Promise<
  { sub: string; name?: string; picture?: string } | null
> {
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: LIFF_CHANNEL_ID }),
  });
  if (!res.ok) {
    console.error("line verify failed:", res.status, await res.text());
    return null;
  }
  const p = await res.json();
  // LINE 已經驗過簽章、aud 與 exp;這裡再確認一次 aud,避免設定被改動時默默放行
  if (!p?.sub || (p.aud && p.aud !== LIFF_CHANNEL_ID)) {
    console.error("line verify payload rejected:", JSON.stringify({ aud: p?.aud }));
    return null;
  }
  return { sub: p.sub, name: p.name, picture: p.picture };
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...adminHeaders(), ...(init.headers as Record<string, string> ?? {}) },
  });
}

/** 發 session:用 admin generate_link 拿一次性 token,前端再用它換 session */
async function issueSession(email: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ type: "magiclink", email }),
  });
  if (!res.ok) {
    console.error("generate_link failed:", res.status, await res.text());
    return null;
  }
  const body = await res.json();
  return body?.hashed_token ?? body?.properties?.hashed_token ?? null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, message: "method not allowed" }, 405, origin);

  if (!LIFF_CHANNEL_ID) {
    // 沒設就 fail closed,不要退回「相信前端」那條路
    return json({ ok: false, message: "LINE 登入尚未設定完成。" }, 503, origin);
  }

  let idToken = "";
  try {
    idToken = (await req.json())?.id_token ?? "";
  } catch {
    return json({ ok: false, message: "bad request" }, 400, origin);
  }
  if (!idToken) return json({ ok: false, message: "缺少 id_token" }, 400, origin);

  const profile = await verifyLineToken(idToken);
  if (!profile) return json({ ok: false, message: "LINE 身分驗證失敗,請重新開啟。" }, 401, origin);

  const sub = profile.sub;
  const name = (profile.name ?? "").trim() || "LINE 會員";
  const email = syntheticEmail(sub);

  // 帳號可能已經在 follow 事件當下建好了(見 _shared/account.ts)。
  // 兩邊共用同一支,所以這裡拿到的一定是「有 auth 使用者」的那種帳號。
  const user = await ensureAccount(sub, name);
  if (!user) return json({ ok: false, message: "建立帳號失敗,請稍後再試。" }, 500, origin);

  // 這個帳號被合併掉的話不該再登入(理論上不會發生,LINE 帳號永遠是合併的目標)
  if (user.merged_into) {
    return json({ ok: false, message: "這個帳號已經被合併,請聯繫客服。" }, 409, origin);
  }

  // 綁定完成後在 OA 送一則歡迎訊息。使用者關掉這個網頁回到聊天室時,
  // 訊息已經在那裡等他 —— 不然他回去只會看到一片空白,不知道下一步該做什麼。
  //
  // welcomed_at 當冪等鎖:重新整理、重新登入、多開分頁都只會送一次。
  // 先寫旗標再送(而不是送完才寫):寧可漏送也不要連送兩則洗版,
  // 而且 LINE push 是計費的。
  // 「第一次開網頁」不能再用「sb_users 剛剛才建」來判斷 —— 帳號現在是
  // follow 當下就建好的,那個值對所有人都會是 false。改用 welcomed_at:
  // 搶到那一格的人就是第一次開網頁的人,跟送歡迎訊息是同一個判斷。
  let firstWeb = false;
  const lineRows = await (await rest(
    `line_users?line_user_id=eq.${encodeURIComponent(sub)}&select=welcomed_at&limit=1`,
  )).json().catch(() => []);
  if (Array.isArray(lineRows) && lineRows[0] && !lineRows[0].welcomed_at) {
    const claimed = await rest(
      `line_users?line_user_id=eq.${encodeURIComponent(sub)}&welcomed_at=is.null`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ welcomed_at: new Date().toISOString() }),
      },
    );
    const rows = await claimed.json().catch(() => []);
    // 搶到那一列的人才送 —— 同時兩個請求進來,只有一個 PATCH 得到 welcomed_at is null。
    if (Array.isArray(rows) && rows.length > 0) {
      firstWeb = true;
      try {
        await push(sub, boundCard(name));
      } catch (err) {
        console.error("welcome push failed:", err);
      }
    }
  }

  const tokenHash = await issueSession(user.email ?? email);
  if (!tokenHash) return json({ ok: false, message: "登入失敗,請稍後再試。" }, 500, origin);

  // is_new 給前端判斷要不要顯示「回到 LINE」那一步 —— 老會員每次登入
  // 都被擋一頁只會煩人。
  return json({ ok: true, token_hash: tokenHash, user_id: user.id, name, is_new: firstWeb }, 200, origin);
});
