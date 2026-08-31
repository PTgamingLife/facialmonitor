/* ── Supabase 設定 ── */
window.SUPABASE_URL  = 'https://wcemkmwrlvijxxwybrgs.supabase.co';
window.SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjZW1rbXdybHZpanh4d3licmdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMzA1NDgsImV4cCI6MjA5MDcwNjU0OH0.Ji557wlvrS7YgflU9ANEm9To6AXLc47EFPaMHTgGARg';
window.EDGE_FN_URL   = window.SUPABASE_URL + '/functions/v1/analyze';
window.LIFF_AUTH_URL = window.SUPABASE_URL + '/functions/v1/liff-auth';

/* ── LINE 登入 ──
   LIFF ID 來自 LINE Developers Console 的 LINE Login channel。
   ⚠️ 那個 channel 必須與 Messaging API channel 在同一個 Provider，
   否則 LIFF 拿到的 userId 與 webhook 收到的不是同一組，帳號會對不起來。 */
window.LIFF_ID = '2011132698-FNcAIg39';

/* 面舌診檢測的獨立 LIFF app(healthpage,Size = Full)。
   檢測要拍兩張照片又要看完整報告,Tall 彈窗會太擠,所以用 Full。 */
window.SCAN_LIFF_ID = '2011132698-JSOBcdBA';

/* 每日挑戰與身邊的祝福的獨立 LIFF app（兩支都是 Size = Tall 的半頁式彈窗）。
   ⚠️ 在 LINE Developers Console 建好之後把 ID 填進來，兩支都要勾 openid。
   留空的話會退回主 LIFF ID，登入還是會過，但開起來是主 App 不是這兩頁，
   所以圖文選單在填好之前不要重建。 */
window.CHALLENGE_LIFF_ID = '';   // → challenge.html
window.BLESSING_LIFF_ID  = '';   // → blessing.html

/* 官方帳號的加好友連結（公開資訊，分享訊息會帶上）
   在 LINE Official Account Manager → 增加好友人數 → 網址 取得，
   長得像 https://lin.ee/xxxxxxx */
window.OA_URL = 'https://lin.ee/uwmOjc0';

/* ── OAuth URL 修正（必須在 createClient 前執行）──
   Google OAuth 有時回傳 %23access_token（URL 編碼的 #），
   Supabase 無法解析，需先還原為正常的 # fragment  ── */
(function fixAuthUrl() {
  const href = window.location.href;
  if (href.includes('%23access_token')) {
    const tokenPart = decodeURIComponent(href.split('%23')[1] || '');
    if (tokenPart.includes('access_token')) {
      history.replaceState({}, document.title,
        window.location.pathname + '#' + tokenPart);
    }
  }
})();

/* 建立 Supabase Client */
if (!window.supabase?.from) {
  var _lib = window.supabase;
  window.supabase = _lib.createClient(window.SUPABASE_URL, window.SUPABASE_ANON);
}

/* ── 全域狀態 ── */
window.currentUser   = window.currentUser   ?? null;
window.currentReport = window.currentReport ?? null;
window.faceFile      = null;
window.tongueFile    = null;

/* ── 管理員識別 ── */
window.ADMIN_PHONE   = '0912345678';
window.ADMIN_NAME    = 'PTGM';
window.ADMIN_EMAILS  = [];

/* ── 成就定義 ──
   三條軸線:積分、推薦人數、檢測次數。
   數字刻意跟 sb_point_rules 的門檻對齊(100 點 = 1 次檢測),
   讓「解鎖成就」和「真的換得到東西」是同一件事,不是兩套獨立的數字。 */
window.ACHIEVEMENTS = [
  // 檢測次數
  { id:'scan_1',    icon:'🔬', title:'初次探索',   desc:'完成第一次面舌診',      condition: u => u.totalScans >= 1 },
  { id:'scan_5',    icon:'🩺', title:'健康老手',   desc:'累計完成 5 次檢測',     condition: u => u.totalScans >= 5 },
  { id:'scan_12',   icon:'🏅', title:'年度追蹤者', desc:'累計完成 12 次檢測',    condition: u => u.totalScans >= 12 },

  // 推薦人數(以「完成首檢」計,填了沒做不算 —— 與發點的條件一致)
  { id:'invite_1',  icon:'🤝', title:'第一個朋友', desc:'推薦 1 人完成首次檢測', condition: u => u.invitees >= 1 },
  { id:'invite_5',  icon:'👥', title:'健康傳教士', desc:'推薦 5 人完成首次檢測', condition: u => u.invitees >= 5 },
  { id:'invite_20', icon:'📣', title:'口碑製造機', desc:'推薦 20 人完成首次檢測',condition: u => u.invitees >= 20 },

  // 積分(用累積賺到的點數,不是餘額 —— 花掉了不該把成就收回去)
  { id:'angel_set', icon:'👼', title:'認定小天使', desc:'填寫你的小天使',        condition: u => u.hasAngel },
  { id:'pts_100',   icon:'💎', title:'第一桶積分', desc:'累積賺到 100 點',       condition: u => u.pointsEarned >= 100 },
  { id:'pts_500',   icon:'👑', title:'積分大戶',   desc:'累積賺到 500 點',       condition: u => u.pointsEarned >= 500 },
  { id:'redeemed',  icon:'🎟', title:'首次兌換',   desc:'用積分換到 1 次檢測',   condition: u => u.redeemed },
];
