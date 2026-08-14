// Supabase 存取(PostgREST + RPC)
// 直接用 fetch 而非 supabase-js:Edge Function 冷啟動比較快,
// 這個作法沿用自 mainwork/line-translate-bot。

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** GET /rest/v1/<table>?<query> */
export async function select<T = Record<string, unknown>>(
  table: string,
  query: string,
): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: headers() });
  if (!res.ok) {
    console.error("select failed:", table, res.status, await res.text());
    return [];
  }
  return await res.json();
}

export async function selectOne<T = Record<string, unknown>>(
  table: string,
  query: string,
): Promise<T | null> {
  const rows = await select<T>(table, `${query}&limit=1`);
  return rows[0] ?? null;
}

/** POST /rest/v1/<table>,merge-duplicates = upsert */
export async function upsert(
  table: string,
  row: Record<string, unknown>,
  opts: { onConflict?: string; returning?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  const prefer = [
    "resolution=merge-duplicates",
    opts.returning ? "return=representation" : "return=minimal",
  ].join(",");
  const q = opts.onConflict ? `?on_conflict=${encodeURIComponent(opts.onConflict)}` : "";

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${q}`, {
    method: "POST",
    headers: headers({ Prefer: prefer }),
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    console.error("upsert failed:", table, res.status, await res.text());
    return null;
  }
  if (!opts.returning) return null;
  const rows = await res.json();
  return rows?.[0] ?? null;
}

export async function insert(
  table: string,
  row: Record<string, unknown>,
  opts: { returning?: boolean; ignoreConflict?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  const prefer = [
    opts.returning ? "return=representation" : "return=minimal",
    ...(opts.ignoreConflict ? ["resolution=ignore-duplicates"] : []),
  ].join(",");

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: headers({ Prefer: prefer }),
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    // 唯一鍵衝突在去重情境是預期行為,不當錯誤吼
    if (res.status !== 409) {
      console.error("insert failed:", table, res.status, await res.text());
    }
    return null;
  }
  if (!opts.returning) return null;
  const rows = await res.json();
  return rows?.[0] ?? null;
}

export async function patch(
  table: string,
  query: string,
  row: Record<string, unknown>,
): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: headers({ Prefer: "return=minimal" }),
    body: JSON.stringify(row),
  });
  if (!res.ok) console.error("patch failed:", table, res.status, await res.text());
  return res.ok;
}

/** POST /rest/v1/rpc/<name> */
export async function rpc<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    console.error("rpc failed:", name, res.status, await res.text());
    return null;
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
