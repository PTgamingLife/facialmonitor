import { rpc } from "../_shared/db.ts";
import { infoCard, push } from "../_shared/line.ts";

const CHECKOUT_SECRET = Deno.env.get("HEALTHBOT_CHECKOUT_SECRET") ?? "";

function secureEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!CHECKOUT_SECRET) return Response.json({ ok: false, error: "not configured" }, { status: 503 });

  const supplied = req.headers.get("x-checkout-secret") ?? "";
  if (!secureEqual(supplied, CHECKOUT_SECRET)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const orderId = typeof body?.orderId === "string" ? body.orderId : "";
  const transactionId = typeof body?.transactionId === "string" ? body.transactionId : "";
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const lineUserId = typeof body?.lineUserId === "string" ? body.lineUserId : "";
  const productCode = typeof body?.productCode === "string" ? body.productCode : "";
  const amount = Number(body?.amount);
  const credits = Number(body?.credits);

  // 這裡只做「形狀」檢查。金額與次數對不對,由 RPC 去 sb_products 查表核對 ——
  // 商品一改價,只有資料表要動;把價錢也硬寫在這裡,就會變成改了資料庫、
  // 忘了改函式,然後新價的訂單被自己的 Edge Function 擋掉。
  if (
    !/^FM[0-9A-Za-z]{10,40}$/.test(orderId)
    || !transactionId || transactionId.length > 40
    || !/^[0-9a-f-]{36}$/i.test(userId)
    || !lineUserId || lineUserId.length > 80
    || !/^[a-z0-9-]{3,40}$/.test(productCode)
    || !Number.isInteger(amount) || amount < 1 || amount > 100000
    || !Number.isInteger(credits) || credits < 1 || credits > 100
  ) {
    return Response.json({ ok: false, error: "invalid payload" }, { status: 400 });
  }

  const result = await rpc<{
    ok: boolean;
    already_fulfilled: boolean;
    credits: number;
  }>("rpc_fulfill_linepay_payment", {
    p_order_id: orderId,
    p_transaction_id: transactionId,
    p_user_id: userId,
    p_line_user_id: lineUserId,
    p_product_code: productCode,
    p_amount: amount,
    p_credits: credits,
  });

  if (!result?.ok) {
    return Response.json({ ok: false, error: "fulfillment failed" }, { status: 500 });
  }

  if (!result.already_fulfilled) {
    await push(lineUserId, infoCard({
      title: "✅ LINE Pay 付款成功",
      bigValue: `+${credits}`,
      bigLabel: "面舌診檢測次數",
      rows: [{ label: "目前剩餘次數", value: String(result.credits), accent: true }],
      note: "次數已自動入帳,現在就可以開始檢測。",
      altText: "付款成功,檢測次數已入帳",
    }));
  }

  return Response.json({
    ok: true,
    alreadyFulfilled: result.already_fulfilled,
    credits: result.credits,
  });
});
