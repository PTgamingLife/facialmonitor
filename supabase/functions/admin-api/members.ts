/**
 * 好友名單與使用狀況。
 *
 * 做法:分別撈幾張表,在這裡併起來。不走 SQL view ——
 * 現在是 17 個好友、73 筆檢測紀錄,幾個 select 就夠,
 * 而加一支 view 要動資料庫結構。
 *
 * ⚠️ 到幾千人時這個做法會開始慢(每次都把檢測紀錄整批拉回來算)。
 *    真的到那一天再換成一支 SQL view 或 RPC,不要先做。
 *    CAP 就是那個時候會先踩到的東西。
 */

import { select } from "../_shared/db.ts";

const CAP = 500;

type LineUser = {
  line_user_id: string; sb_user_id: string | null; display_name: string | null;
  last_active_at: string | null; followed_at: string | null; unfollowed_at: string | null;
};
type SbUser = {
  id: string; name: string | null; credits: number | null; total_used: number | null;
  points: number | null; referral_count: number | null; member_code: string | null;
  tone: string | null;
};
type Record_ = { user_id: string; created_at: string; scores: { total?: number } | null };

export type Member = {
  line_user_id: string;
  name: string;
  bound: boolean;
  member_code: string | null;
  last_active_at: string | null;
  followed_at: string | null;
  credits: number;
  total_used: number;
  points: number;
  referral_count: number;
  scans: number;
  last_scan_at: string | null;
  last_score: number | null;
};

export async function members() {
  const line = await select<LineUser>("line_users",
    "select=line_user_id,sb_user_id,display_name,last_active_at,followed_at,unfollowed_at"
    + `&unfollowed_at=is.null&order=last_active_at.desc.nullslast&limit=${CAP}`);

  const ids = line.map((l) => l.sb_user_id).filter((v): v is string => !!v);
  const sb = ids.length
    ? await select<SbUser>("sb_users",
        "select=id,name,credits,total_used,points,referral_count,member_code,tone"
        + `&id=in.(${ids.join(",")})&limit=${CAP}`)
    : [];
  const byId = new Map(sb.map((u) => [u.id, u]));

  /*
   * 檢測紀錄分兩段問,不是為了效能,是為了讓失敗看得出來。
   *
   * 次數與最後一次的時間用最普通的欄位選取 —— 一定會成功。
   * 分數藏在 report->scores->total,那要用 PostgREST 的 JSON 路徑語法,
   * 這個專案以前沒用過。
   *
   * ⚠️ 兩段合成一段的話,JSON 語法若被拒,select() 會回空陣列,
   *    畫面就變成「所有人檢測 0 次」—— 那看起來像一個真實的生意事實
   *    (沒人在用),不像壞掉。分開問,次數照樣正確,只有分數會缺,
   *    而且缺的時候我們知道是缺,畫面上寫「分數讀不到」而不是「—」。
   */
  const recs = ids.length
    ? await select<{ user_id: string; created_at: string }>("sb_analysis_records",
        `select=user_id,created_at&user_id=in.(${ids.join(",")})`
        + `&order=created_at.desc&limit=5000`)
    : [];
  const stat = new Map<string, { n: number; at: string }>();
  for (const r of recs) {
    const cur = stat.get(r.user_id);
    if (cur) { cur.n++; continue; }           // 已排序,第一筆就是最後一次
    stat.set(r.user_id, { n: 1, at: r.created_at });
  }

  const scored = ids.length
    ? await select<Record_>("sb_analysis_records",
        `select=user_id,created_at,scores:report->scores&user_id=in.(${ids.join(",")})`
        + `&order=created_at.desc&limit=5000`)
    : [];
  // 次數問得到、分數問不到 = JSON 路徑那段出事了。
  const scoresBroken = recs.length > 0 && scored.length === 0;
  const scoreOf = new Map<string, number | null>();
  for (const r of scored) {
    if (scoreOf.has(r.user_id)) continue;     // 已排序,第一筆就是最後一次
    const total = r.scores?.total;
    scoreOf.set(r.user_id, typeof total === "number" ? total : null);
  }

  const rows: Member[] = line.map((l) => {
    const u = l.sb_user_id ? byId.get(l.sb_user_id) : undefined;
    const s = l.sb_user_id ? stat.get(l.sb_user_id) : undefined;
    return {
      line_user_id: l.line_user_id,
      // 綁定後填的本名優先;沒有就用 LINE 暱稱。兩個都沒有才顯示為未命名。
      name: (u?.name || l.display_name || "").trim() || "(未命名)",
      bound: !!l.sb_user_id,
      member_code: u?.member_code ?? null,
      last_active_at: l.last_active_at,
      followed_at: l.followed_at,
      credits: u?.credits ?? 0,
      total_used: u?.total_used ?? 0,
      points: u?.points ?? 0,
      referral_count: u?.referral_count ?? 0,
      scans: s?.n ?? 0,
      last_scan_at: s?.at ?? null,
      last_score: l.sb_user_id ? (scoreOf.get(l.sb_user_id) ?? null) : null,
    };
  });

  // 整體使用狀況。看個別的人之前,先看有多少人「真的用過」——
  // 好友數高、做過檢測的人少,那是兩個完全不同的問題。
  const used = rows.filter((r) => r.scans > 0).length;
  return {
    total: rows.length,
    bound: rows.filter((r) => r.bound).length,
    scanned: used,
    never_scanned: rows.length - used,
    total_scans: rows.reduce((n, r) => n + r.scans, 0),
    capped: line.length >= CAP,
    // 畫面要據此顯示「分數讀不到」,而不是讓它看起來像每個人都沒有分數。
    scores_broken: scoresBroken,
    items: rows,
  };
}
