// ── Config ──────────────────────────────────────────────
const SUPABASE_URL = 'https://wcemkmwrlvijxxwybrgs.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjZW1rbXdybHZpanh4d3licmdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMzA1NDgsImV4cCI6MjA5MDcwNjU0OH0.Ji557wlvrS7YgflU9ANEm9To6AXLc47EFPaMHTgGARg';
const EDGE_FN_URL = `${SUPABASE_URL}/functions/v1/analyze`;
const ADMIN_PHONE = '0912345678';
const ADMIN_NAME = 'PTGM';

// ── OAuth URL 修正（必須在 createClient 前執行）────────────
// 當 Google OAuth 回傳 %23access_token（URL 編碼的 #），
// Supabase createClient 無法解析，必須先修正 URL
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

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ────────────────────────────────────────────────
let sb_currentUser = null;
let sb_faceData = null;
let sb_tongueData = null;
let sb_currentReport = null;
let sb_allUsers = [];
let sb_carouselTimer = null;
let sb_carouselIdx = 0;

const CAROUSEL_MSGS = [
  '正在分析面部六區…',
  '辨識舌色與舌苔…',
  '對照體質資料庫…',
  '生成個人化建議…',
];
