/* ── Supabase 設定 ── */
window.SUPABASE_URL  = 'https://wcemkmwrlvijxxwybrgs.supabase.co';
window.SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjZW1rbXdybHZpanh4d3licmdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMzA1NDgsImV4cCI6MjA5MDcwNjU0OH0.Ji557wlvrS7YgflU9ANEm9To6AXLc47EFPaMHTgGARg';
window.EDGE_FN_URL   = window.SUPABASE_URL + '/functions/v1/analyze';

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

/* ── 成就定義 ── */
window.ACHIEVEMENTS = [
  { id:'first_scan',   icon:'🔬', title:'初次探索',     desc:'完成第一次面舌診掃描',   condition: u => u.totalScans >= 1 },
  { id:'streak_3',     icon:'🔥', title:'三日連打',     desc:'連續 3 天完成任務',       condition: u => u.streak >= 3 },
  { id:'streak_7',     icon:'⚡', title:'週慣之星',     desc:'連續 7 天完成任務',       condition: u => u.streak >= 7 },
  { id:'coins_50',     icon:'🪙', title:'半罐儲蓄者',   desc:'存入 50 枚健康幣',        condition: u => u.coins >= 50 },
  { id:'coins_100',    icon:'🐷', title:'豬公滿額',     desc:'存入 100 枚健康幣',       condition: u => u.coins >= 100 },
  { id:'task_all',     icon:'✅', title:'全勤挑戰者',   desc:'完成所有 14 天任務',      condition: u => u.completedDays >= 14 },
  { id:'scan_5',       icon:'🏆', title:'健康老手',     desc:'累計完成 5 次掃描',       condition: u => u.totalScans >= 5 },
  { id:'bottle_send',  icon:'🌊', title:'漂流傳遞者',   desc:'發送第一封漂流瓶',        condition: u => u.bottlesSent >= 1 },
];
