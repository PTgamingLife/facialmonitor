/**
 * 「誰是擁有者」—— 唯一一份。
 *
 * 判斷的依據是 LINE user ID,而且只接受從 LINE 驗過的來源:
 * webhook 收到的事件,或 LINE 驗過的 LIFF ID token。
 * 絕不接受前端自己宣稱的 ID —— 那等於把後台的門把交給任何人。
 */

const ADMIN_LINE_ID = Deno.env.get("HEALTHBOT_ADMIN_LINE_USER_ID") ?? "";

export function isOwner(lineUserId: string): boolean {
  return !!ADMIN_LINE_ID && lineUserId === ADMIN_LINE_ID;
}

/** 擁有者的 LINE user ID。沒設定時是空字串 —— 那表示後台整個關著。 */
export function ownerId(): string {
  return ADMIN_LINE_ID;
}

/** 有沒有設定過。沒設定時管理中心要給出「怎麼設定」而不是「你沒有權限」。 */
export function ownerConfigured(): boolean {
  return !!ADMIN_LINE_ID;
}
