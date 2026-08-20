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
