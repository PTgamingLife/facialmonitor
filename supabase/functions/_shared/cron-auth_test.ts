import { assertEquals } from "jsr:@std/assert@1.0.14";
import { authorizeCron, authorizeCronHash, secureEqual, sha256Hex } from "./cron-auth.ts";

Deno.test("secureEqual accepts exact value only", () => {
  assertEquals(secureEqual("same-secret", "same-secret"), true);
  assertEquals(secureEqual("same-secret", "other-value"), false);
  assertEquals(secureEqual("short", "longer"), false);
  assertEquals(secureEqual("", ""), false);
});

Deno.test("authorizeCronHash keeps the plaintext secret out of Edge config", async () => {
  const expectedHash = await sha256Hex("vault-only-secret");
  const ok = await authorizeCronHash(new Request("https://example.test", {
    headers: { "x-job-secret": "vault-only-secret" },
  }), "x-job-secret", expectedHash);
  assertEquals(ok, null);

  const wrong = await authorizeCronHash(new Request("https://example.test", {
    headers: { "x-job-secret": "wrong" },
  }), "x-job-secret", expectedHash);
  assertEquals(wrong?.status, 401);
});

Deno.test("authorizeCron fails closed", async () => {
  const notConfigured = authorizeCron(new Request("https://example.test"), "x-job-secret", "");
  assertEquals(notConfigured?.status, 503);

  const wrong = authorizeCron(new Request("https://example.test", {
    headers: { "x-job-secret": "wrong" },
  }), "x-job-secret", "expected");
  assertEquals(wrong?.status, 401);

  const ok = authorizeCron(new Request("https://example.test", {
    headers: { "x-job-secret": "expected" },
  }), "x-job-secret", "expected");
  assertEquals(ok, null);
});
