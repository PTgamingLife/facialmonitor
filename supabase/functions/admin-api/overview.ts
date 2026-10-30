/** 總覽:開頁時第一眼要看到的數字。全部唯讀。 */

import { rpc, select } from "../_shared/db.ts";
import { audienceCount } from "../_shared/audience.ts";

export async function overview() {
  // 三個人數用的是群發時同一套分眾算法 —— 畫面上的數字就是會送到的人數。
  const [all, bound, active] = await Promise.all([
    audienceCount("all"),
    audienceCount("bound"),
    audienceCount("active_30d"),
  ]);

  const [pending, recent, nextFree] = await Promise.all([
    select<{ id: string }>("line_broadcasts",
      "select=id&status=eq.draft&scheduled_at=not.is.null&limit=50"),
    select("line_broadcasts",
      "select=title,audience,status,sent_count,sent_at&status=eq.sent"
      + "&order=sent_at.desc&limit=5"),
    // 下一個「還沒有內容」的推播日。問的是資料庫那支 is_push_day,
    // 不在這裡自己算日期餘數 —— 推播節奏改過一次(每日 → 三日一次),
    // 當時就是因為只有一個地方算才沒出事。
    rpc<string | null>("rpc_next_free_push_day", {}),
  ]);

  return {
    audience: { all, bound, active_30d: active },
    pending_scheduled: pending.length,
    recent_sent: recent,
    next_free_push_day: nextFree,
  };
}
