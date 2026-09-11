// 一個 LINE 身分 → 一組 Supabase 帳號
//
// 兩個地方都要做這件事:
//   1. liff-auth —— 使用者開網頁,驗過 ID token 之後
//   2. line-webhook —— 使用者加好友的當下(follow 事件)
//
// v2 之後帳號在「加好友當下」就開好,不再等到第一次開網頁。
// webhook 收到的 userId 來自驗過簽章的 LINE 請求,可信度跟 ID token 一樣,
// 沒有理由再讓使用者「去綁一次」。
//
// 但兩邊各寫一份就會出事:webhook 先建了一個沒有 auth_id 的 sb_users,
// liff-auth 之後用 line_user_id 找得到它、於是跳過建立 auth 使用者,
// 最後拿一個不存在的帳號去發 session —— 登入直接壞掉。
// 所以只留這一份,兩邊都呼叫它。

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export type LineAccount = {
  id: string;
  email: string;
  merged_into: string | null;
  isNew: boolean;
};

function adminHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...adminHeaders(), ...(init.headers as Record<string, string> ?? {}) },
  });
}

/** LINE 不一定給得到真信箱,合成一組。同一個 sub 永遠得到同一組。 */
export function syntheticEmail(sub: string): string {
  return `line.${sub.toLowerCase()}@line.local`;
}

async function findByLineId(sub: string) {
  const res = await rest(
    `sb_users?line_user_id=eq.${encodeURIComponent(sub)}` +
    `&select=id,auth_id,email,merged_into&limit=1`,
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0] ?? null;
}

/** 建一個 Supabase auth 使用者。 */
async function createAuthUser(email: string, name: string, sub: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      email,
      email_confirm: true,
      user_metadata: { full_name: name, line_user_id: sub, provider: "line" },
    }),
  });
  if (res.ok) return (await res.json())?.id ?? null;

  // 422 = 這個信箱已經有帳號(重試,或先前建到一半),撈回來用
  const body = await res.text();
  if (res.status === 422) {
    const look = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
      { headers: adminHeaders() },
    );
    if (look.ok) {
      const users = (await look.json())?.users ?? [];
      const hit = users.find((u: { email?: string }) => u.email === email);
      if (hit?.id) return hit.id;
    }
  }
  console.error("createAuthUser failed:", res.status, body);
  return null;
}

/**
 * 找到或建立這個 LINE 身分的帳號,並把 line_users.sb_user_id 補上。
 *
 * 回傳 null = 建立失敗。呼叫端自己決定要不要擋:
 * liff-auth 必須擋(沒帳號就沒 session);webhook 不擋(歡迎訊息還是要送出去,
 * 使用者下次開網頁時 liff-auth 會補建)。
 */
export async function ensureAccount(
  sub: string,
  displayName?: string | null,
): Promise<LineAccount | null> {
  const name = (displayName ?? "").trim() || "LINE 會員";
  const email = syntheticEmail(sub);

  let user = await findByLineId(sub);
  const isNew = !user;

  if (!user) {
    const authId = await createAuthUser(email, name, sub);
    if (!authId) return null;

    const res = await rest("sb_users", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      // phone 不能填空字串:sb_users.phone 是 UNIQUE,空字串只有第一個人塞得進去,
      // 第二個用 LINE 註冊的客戶就會撞鍵。用合成信箱當佔位值,每個人都不一樣。
      body: JSON.stringify({
        auth_id: authId, name, phone: email, email,
        line_user_id: sub, credits: 0, total_used: 0,
      }),
    });
    if (!res.ok) {
      console.error("create sb_users failed:", res.status, await res.text());
      return null;
    }
    user = (await res.json())?.[0] ?? null;
    if (!user) return null;
  }

  // 讓 bot 立刻認得他。少了這步,選單點下去還是會說「請先綁定」。
  await rest(`line_users?line_user_id=eq.${encodeURIComponent(sub)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ sb_user_id: user.id, bind_status: "bound" }),
  });

  return { id: user.id, email: user.email ?? email, merged_into: user.merged_into, isNew };
}
