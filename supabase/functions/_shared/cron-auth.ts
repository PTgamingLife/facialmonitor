export function secureEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function authorizeCron(req: Request, header: string, expected: string): Response | null {
  if (!expected) return Response.json({ ok: false, error: "not_configured" }, { status: 503 });
  if (!secureEqual(req.headers.get(header) ?? "", expected)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function authorizeCronHash(req: Request, header: string, expectedHash: string): Promise<Response | null> {
  if (!expectedHash) return Response.json({ ok: false, error: "not_configured" }, { status: 503 });
  const supplied = req.headers.get(header) ?? "";
  if (!supplied || !secureEqual(await sha256Hex(supplied), expectedHash)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * 同一個專案裡另一支 Edge Function 的呼叫。
 *
 * 排程端點的密鑰明文只存在 vault,Edge Function 讀不到(環境變數裡是 SHA-256)。
 * 所以管理中心要叫得動 tip-plan,得有另一條門 —— 用 service role key 本身。
 *
 * 這不是放寬:能拿到 service role key 的東西本來就能直接改資料庫,
 * 多一條「可以叫 tip-plan」沒有多給任何權限。
 * 反過來說,service role key 絕不可以出現在瀏覽器,所以這條路只有
 * Edge Function 走得到。
 */
export function isInternalCall(req: Request): boolean {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return !!key && secureEqual(req.headers.get("x-internal-key") ?? "", key);
}
