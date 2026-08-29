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

/* ── 14 天任務資料 ── */
window.TASK_PLAN = [
  {
    day:1, category:'食補', xp:10,
    title:'晨起一杯溫薑水',
    desc:'空腹喝 200ml 溫薑水（薑片 2-3 片）。\n中醫：脾胃為後天之本，薑能溫中散寒；\n營養學：促進消化液與膽汁分泌，活化腸胃。'
  },
  {
    day:2, category:'飲食', xp:20,
    title:'五色蔬果彩虹盤',
    desc:'今日攝取青、赤、黃、白、黑五色蔬果各一份。\n中醫五行：五色對應五臟（肝心脾肺腎）；\n營養學：植化素多樣化，全方位抗氧化護體。'
  },
  {
    day:3, category:'運動', xp:15,
    title:'飯後百步走 15 分鐘',
    desc:'每餐後輕鬆散步 15 分鐘（勿劇烈）。\n中醫諺語：飯後百步走，活到九十九；助脾胃運化；\n營養學：改善胰島素敏感性，穩定飯後血糖。'
  },
  {
    day:4, category:'睡眠', xp:20,
    title:'戌時護心：9 點前放下手機',
    desc:'晚 9 點前停止 3C，做伸展或靜坐。\n中醫子午流注：戌時（19-21時）心包經當令，宜靜養安神；\n營養學：減少藍光抑制褪黑素，改善睡眠品質。'
  },
  {
    day:5, category:'食補', xp:15,
    title:'以天然醋調味（代替醬油）',
    desc:'烹調或涼拌加一大匙天然醋（蘋果醋、烏醋）。\n中醫：酸味入肝，醋能疏肝理氣、健脾開胃；\n營養學：降低 GI 值、助礦物質吸收、減鈉護血壓。'
  },
  {
    day:6, category:'呼吸', xp:20,
    title:'卯時腹式深呼吸 10 分鐘',
    desc:'清晨 5-7 時做腹式呼吸：吸 4 秒、屏 2 秒、呼 6 秒。\n中醫子午流注：卯時大腸經旺，吐故納新最佳時機；\n營養學：活化副交感神經，降低皮質醇、促進腸蠕動。'
  },
  {
    day:7, category:'食補', xp:25,
    title:'黑色補腎食材入菜',
    desc:'今日加入黑芝麻、黑豆、黑木耳或黑米之一。\n中醫五行：黑色入腎，補腎精、益腎氣；\n營養學：花青素抗氧化、鈣質護骨、黑木耳多醣調免疫。'
  },
  {
    day:8, category:'飲食', xp:20,
    title:'七分飽＋每口嚼 20 下',
    desc:'感到飽足七分即停筷，每口充分咀嚼再吞嚥。\n中醫：脾喜燥惡濕，過食傷脾胃氣；\n營養學：慢食激活飽足素 leptin，減少熱量攝入 20%。'
  },
  {
    day:9, category:'穴位', xp:25,
    title:'三穴養生按摩',
    desc:'各按壓揉 3 分鐘：\n• 足三里（膝下三寸）— 補氣血、助消化\n• 合谷（虎口）— 調氣機、緩解頭痛\n• 太衝（腳背拇趾間）— 疏肝解鬱、降壓'
  },
  {
    day:10, category:'食補', xp:20,
    title:'睡前桂圓紅棗茶',
    desc:'睡前 1 小時：桂圓 5-6 粒 + 紅棗 3-4 顆燉溫水飲用。\n中醫：桂圓補心血安神，紅棗補中益氣；\n營養學：含色胺酸、鎂等助眠營養素，天然助眠不含咖啡因。'
  },
  {
    day:11, category:'睡眠', xp:25,
    title:'午時小憩 15 分鐘',
    desc:'正午 11-13 時，閉眼靜躺或淺眠 15 分鐘。\n中醫子午流注：午時心經當令，午睡護心陽、養精蓄銳；\n研究：規律午睡降低心血管風險達 30%，提升下午認知效能。'
  },
  {
    day:12, category:'飲食', xp:20,
    title:'好油護腦：Omega-3 優質油脂',
    desc:'今日以橄欖油、苦茶油或亞麻仁油烹調或涼拌一餐。\n中醫：腦為髓之海，腎主骨生髓，好油滋養髓海；\n營養學：Omega-3 抑制發炎因子、保護神經突觸、護心護腦。'
  },
  {
    day:13, category:'飲食', xp:25,
    title:'腸道益菌：發酵食品一份',
    desc:'食用泡菜、無糖優格、納豆或味噌一份。\n中醫：大腸主傳導，腸道健康關係全身氣機通暢；\n營養學：益生菌調節腸腦軸、強化黏膜屏障、提升免疫力。'
  },
  {
    day:14, category:'總結', xp:50,
    title:'14 天養生總回顧',
    desc:'靜心記錄這 14 天的身心改變：\n• 睡眠品質是否提升？\n• 消化、體力有何不同？\n• 最有感的是哪一項任務？\n中醫重視「觀其所變」——自我覺察是持續養生的根本。'
  },
];

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
