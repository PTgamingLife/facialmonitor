/**
 * 群發分眾 —— 唯一一份。
 *
 * 管理中心會在送出前顯示「預計送達幾人」,那個數字必須跟真正送出時用的
 * 名單同一套算法算出來,否則畫面上寫 17、實際送 12,而且沒人會發現。
 */

import { select } from "./db.ts";

export type Audience = "all" | "bound" | "active_30d";

export const AUDIENCE_LABEL: Record<Audience, string> = {
  all: "全部好友",
  bound: "已綁定會員",
  active_30d: "近 30 天活躍",
};

export function isAudience(v: unknown): v is Audience {
  return v === "all" || v === "bound" || v === "active_30d";
}

function query(audience: Audience): string {
  let q = "select=line_user_id&unfollowed_at=is.null";
  if (audience === "bound") {
    q += "&sb_user_id=not.is.null";
  } else if (audience === "active_30d") {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    q += `&last_active_at=gte.${since}`;
  }
  return `${q}&limit=10000`;
}

/** 依分眾條件取名單;audience=all 走 broadcast API,不需要名單。 */
export async function audienceList(audience: Audience): Promise<string[]> {
  if (audience === "all") return [];
  const rows = await select<{ line_user_id: string }>("line_users", query(audience));
  return rows.map((r) => r.line_user_id);
}

/** 預計送達人數。all 也要算得出來,畫面上要顯示。 */
export async function audienceCount(audience: Audience): Promise<number> {
  const rows = await select<{ line_user_id: string }>("line_users", query(audience));
  return rows.length;
}
