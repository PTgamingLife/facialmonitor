/* ── 頁面切換 ── */
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');

  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.page === pageId);
  });

  if (pageId === 'page-main')         loadMain();
  if (pageId === 'page-challenge')    { updateCreditsDisplay(); resetToStep1(); }
  if (pageId === 'page-history')      loadHistory();
  if (pageId === 'page-achievement')  loadAchievement();
  if (pageId === 'page-leaderboard')  loadLeaderboard();
  if (pageId === 'page-bottle')       loadBottle();
  if (pageId === 'page-admin')        loadAdminUsers();

  window.scrollTo(0, 0);
}

/* ── 顯示次數 ── */
function updateCreditsDisplay() {
  document.querySelectorAll('.credits-num').forEach(el => {
    el.textContent = currentUser?.credits ?? 0;
  });
}

/* ── 進入 App ── */
function enterApp(isAdmin) {
  // 導覽列後台 tab（有才顯示）
  const adminTab = document.getElementById('nav-admin');
  if (adminTab) adminTab.style.display = isAdmin ? 'flex' : 'none';
  // 診斷紀錄頁右上角後台小按鈕
  const adminBtn = document.getElementById('history-admin-btn');
  if (adminBtn) adminBtn.style.display = isAdmin ? 'inline-flex' : 'none';

  if (isAdmin) {
    showPage('page-admin');
  } else {
    showPage('page-main');
  }
}

/* ── Demo 登入（跳過 OAuth，測試用） ── */
async function demoLogin() {
  const btn = document.getElementById('btn-google-login');
  if (btn) { btn.disabled = true; btn.querySelector('.btn-google-text').textContent = '載入中…'; }

  window._demoMode = true;
  currentUser = {
    id: 'demo-user-001',
    name: '示範用戶',
    email: 'demo@example.com',
    phone: '',
    credits: 5,
    coins: 42,
    streak: 7,
    total_scans: 3,
    bottles_sent: 2,
    member_code: '8392741',
    is_admin: false
  };
  sessionStorage.setItem('hq_user', JSON.stringify(currentUser));

  setTimeout(() => {
    if (btn) { btn.disabled = false; btn.querySelector('.btn-google-text').textContent = '使用 Google 帳號登入'; }
    enterApp(false);
  }, 600);
}

/* ── Google OAuth 登入（正式版） ── */
async function loginWithGoogle() {
  const btn = document.getElementById('btn-google-login');
  if (btn) { btn.disabled = true; btn.querySelector('.btn-google-text').textContent = '連接中…'; }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.href.split('?')[0].split('#')[0]
    }
  });

  if (error) {
    showToast('Google 登入失敗，請稍後再試');
    if (btn) {
      btn.disabled = false;
      btn.querySelector('.btn-google-text').textContent = '使用 Google 帳號登入';
    }
  }
  // 無 error → 瀏覽器跳轉至 Google，後續流程由 onAuthStateChange 接管
}

/* ── 處理 OAuth 用戶（新建或讀取） ── */
async function handleOAuthUser(session) {
  const authUser = session.user;
  const name  = authUser.user_metadata?.full_name
              || authUser.user_metadata?.name
              || authUser.email?.split('@')[0]
              || '用戶';
  const email = authUser.email || '';

  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .single();

  if (existing) {
    currentUser = existing;
    sessionStorage.setItem('hq_user', JSON.stringify(currentUser));
    enterApp(existing.is_admin);
    return;
  }

  // 新用戶 — 建立記錄
  const code = generateMemberCode();
  const { data: newUser, error } = await supabase
    .from('users')
    .insert({
      id: authUser.id,
      name,
      email,
      phone: '',
      credits: 3,
      coins: 0,
      streak: 0,
      total_scans: 0,
      bottles_sent: 0,
      member_code: code,
      is_admin: false
    })
    .select()
    .single();

  if (error) {
    showToast('建立帳號失敗：' + (error.message ?? '請重試'));
    return;
  }

  currentUser = newUser;
  sessionStorage.setItem('hq_user', JSON.stringify(currentUser));
  showToast(`🌿 歡迎加入！${name}`);
  enterApp(false);
}

/* ── 登出 ── */
async function logout() {
  await supabase.auth.signOut();
  currentUser = null;
  sessionStorage.removeItem('hq_user');
  showPage('page-login');
}

/* ── 文字大小設定 ── */
function setFontSize(size) {
  document.body.classList.toggle('font-lg', size === 'lg');
  localStorage.setItem('hq_font_size', size);
  // 更新按鈕狀態
  document.querySelectorAll('.fs-btn').forEach(btn => btn.classList.remove('active'));
  const active = document.getElementById('fs-btn-' + size);
  if (active) active.classList.add('active');
}

/* ── 初始化 ── */
document.addEventListener('DOMContentLoaded', () => {
  checkWebView();

  // 還原字型大小偏好
  const savedFs = localStorage.getItem('hq_font_size') ?? 'md';
  setFontSize(savedFs);

  // OAuth 狀態監聽（處理 Google 跳轉返回）
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session && !currentUser) {
      await handleOAuthUser(session);
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      sessionStorage.removeItem('hq_user');
    }
  });

  // 檢查現有 session（頁面刷新後 session 保持）
  supabase.auth.getSession().then(async ({ data: { session } }) => {
    if (currentUser) return; // demo 模式或已登入，不覆蓋
    if (session) {
      await handleOAuthUser(session);
    } else {
      showPage('page-login');
    }
  }).catch(() => {
    if (!currentUser) showPage('page-login');
  });
});
