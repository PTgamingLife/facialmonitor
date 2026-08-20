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
