/**
 * 圖文選單:重建與查現況。
 *
 * 重建不在這裡重寫一份 —— 直接叫 richmenu-setup,那支才是唯一一份實作,
 * 而且它會順手把 line_rich_menus 寫好。
 * (用 Actions 腳本重建時不會寫那張表,所以表裡常常是舊的 ID。
 *  從這裡重建就不會有這個問題。)
 */

import { select } from "../_shared/db.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SETUP_KEY = Deno.env.get("HEALTHBOT_SETUP_KEY") ?? "";

/** 資料庫裡記的現況。跟 LINE 上實際那一組可能不一致 —— 那正是要看它的原因。 */
export async function current() {
  const rows = await select("line_rich_menus",
    "select=tab_key,richmenu_id,alias_id,image_file,is_default,updated_at&order=tab_key.asc");
  return { items: rows, setup_key_configured: !!SETUP_KEY };
}

/**
 * 重建。dry = true 只印出可點區塊,不碰 LINE。
 *
 * ⚠️ 真的重建會先刪掉舊選單再建新的,中間有幾秒鐘客戶看到的是空的。
 *    所以畫面上預設是 dry,要再按一次才真的做。
 */
export async function rebuild(dry: boolean) {
  if (!SETUP_KEY) {
    return {
      ok: false,
      error: "HEALTHBOT_SETUP_KEY 沒設定，所以 richmenu-setup 整支是關著的。"
        + "到 Supabase → Edge Functions → Secrets 新增一組長字串就好。",
    };
  }
  const url = `${SUPABASE_URL}/functions/v1/richmenu-setup`
    + `?key=${encodeURIComponent(SETUP_KEY)}&ref=main${dry ? "&dry=1" : ""}`;
  const res = await fetch(url);
  // 這支回的是純文字的執行紀錄,不是 JSON。整段帶回去給畫面顯示 ——
  // 出錯時那段文字就是唯一看得出原因的東西。
  const log = await res.text();
  return { ok: res.ok, dry, log };
}
