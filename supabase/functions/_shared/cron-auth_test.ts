import { assertEquals } from "jsr:@std/assert@1.0.14";
import { authorizeCron, secureEqual } from "./cron-auth.ts";

Deno.test("secureEqual accepts exact value only", () => {
  assertEquals(secureEqual("same-secret", "same-secret"), true);
  assertEquals(secureEqual("same-secret", "other-value"), false);
  assertEquals(secureEqual("short", "longer"), false);
  assertEquals(secureEqual("", ""), false);
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
