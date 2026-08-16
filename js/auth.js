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
  if (pageId === 'page-reward')       loadReward();
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
  const adminTab = document.getElementById('nav-admin');
  if (adminTab) adminTab.style.display = isAdmin ? 'flex' : 'none';
  const adminBtn = document.getElementById('history-admin-btn');
  if (adminBtn) adminBtn.style.display = isAdmin ? 'inline-flex' : 'none';

  // 圖文選單的格子是用 ?p=page-xxx 指定要開哪一頁
  // (LIFF 只保證帶 query string 過來,不保證帶 hash)
  const wanted = new URLSearchParams(location.search).get('p')
              || location.hash.replace('#', '');
  if (wanted && document.getElementById(wanted) && wanted !== 'page-login') {
    showPage(wanted);
    return;
  }

  if (isAdmin) showPage('page-admin');
  else         showPage('page-main');
}

/* ══════════════════════════════════════════════════════════
   LINE 登入（LIFF）

   身分一律由後端向 LINE 驗證。前端拿到的 userId 只是顯示用，
   絕不會直接送給資料庫當身分 —— 那等於讓任何人改一行 JS 就變成別人。
   ══════════════════════════════════════════════════════════ */

function setLoginBusy(busy, text) {
  const btn = document.getElementById('btn-line-login');
  if (!btn) return;
  btn.disabled = busy;
  const label = btn.querySelector('.btn-line-text');
  if (label) label.textContent = text ?? (busy ? '登入中…' : '使用 LINE 登入');
}

function showLoginError(msg) {
  const box = document.getElementById('login-error');
  if (!box) return;
  box.textContent = msg;
  box.style.display = msg ? 'block' : 'none';
}

let _liffReady = false;
async function initLiff() {
  if (_liffReady) return true;
  if (!window.LIFF_ID) return false;          // 還沒設定 LIFF ID
  if (typeof liff === 'undefined') return false;
  try {
    await liff.init({ liffId: window.LIFF_ID });
    _liffReady = true;
    return true;
  } catch (e) {
    console.error('liff.init failed', e);
    return false;
  }
}

/** 拿 LIFF 的 ID token 去換一組 Supabase session */
async function exchangeLiffToken() {
  const idToken = liff.getIDToken();
  if (!idToken) throw new Error('拿不到 LINE 身分，請重新開啟一次。');

  const res = await fetch(window.LIFF_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(body.message ?? '登入失敗，請稍後再試。');

  // token_hash 是一次性的，換完就作廢
  const { error } = await supabase.auth.verifyOtp({
    token_hash: body.token_hash,
    type: 'magiclink'
  });
  if (error) throw new Error('登入失敗：' + error.message);
}

async function loginWithLine() {
  showLoginError('');
  setLoginBusy(true);
  try {
    if (!await initLiff()) throw new Error('LINE 登入尚未設定完成，請聯繫客服。');

    // 在 LINE 外面開（桌機、分享出去的連結）就走正式的 LINE Login 轉址
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: window.location.href.split('#')[0] });
      return;                                  // 頁面即將跳走
    }
    await exchangeLiffToken();                 // 成功後由 onAuthStateChange 接手
  } catch (e) {
    showLoginError(e.message);
    setLoginBusy(false);
  }
}

/** 在 LINE 裡開啟時不該還要按一次登入 */
async function autoLoginInLiff() {
  if (!await initLiff()) return false;
  if (!liff.isLoggedIn()) return false;
  setLoginBusy(true, '登入中…');
  try {
    await exchangeLiffToken();
    return true;
  } catch (e) {
    console.error('auto login failed', e);
    showLoginError(e.message);
    setLoginBusy(false);
    return false;
  }
}

/* ══════════════════════════════════════════════════════════
   舊 Google 帳號資料轉移

   流程一定會換 session（LINE → Google → LINE），所以先在「還是
   LINE 帳號」時開一張票，票裡寫死目標帳號；Google 那邊只能拿票兌換。
   這樣舊帳號無法指定要搬去哪，別人的帳號也就塞不進東西。
   ══════════════════════════════════════════════════════════ */

const MERGE_TICKET_KEY = 'hq_merge_ticket';

/** 是不是 LINE 建立的帳號（liff-auth 用 @line.local 當合成信箱） */
function isLineSession(session) {
  return (session?.user?.email ?? '').endsWith('@line.local');
}

async function startLegacyMigration() {
  const btn = document.getElementById('migrate-btn');
  const note = document.getElementById('migrate-note');
  if (btn) btn.disabled = true;
  if (note) note.textContent = '準備中…';

  const { data, error } = await supabase.rpc('rpc_issue_merge_ticket');
  if (error || !data?.ok) {
    if (btn) btn.disabled = false;
    if (note) note.textContent = data?.message ?? '目前無法轉移，請稍後再試。';
    return;
  }

  localStorage.setItem(MERGE_TICKET_KEY, data.ticket);

  const { error: oauthErr } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href.split('?')[0].split('#')[0] }
  });
  if (oauthErr) {
    localStorage.removeItem(MERGE_TICKET_KEY);
    if (btn) btn.disabled = false;
    if (note) note.textContent = 'Google 登入失敗，請稍後再試。';
  }
  // 沒錯誤 → 瀏覽器跳去 Google，回來時由 finishLegacyMigration 接手
}

/** 從 Google 轉回來時執行：兌換票券 → 登出 Google → 換回 LINE 帳號 */
async function finishLegacyMigration(ticket) {
  showToast('轉移中，請稍候…', 4000);

  const { data, error } = await supabase.rpc('rpc_redeem_merge_ticket', { p_ticket: ticket });
  localStorage.removeItem(MERGE_TICKET_KEY);

  const msg = error ? '轉移失敗，請稍後再試。'
            : data?.ok ? `✅ 已轉移 ${data.records} 筆檢測紀錄、${data.credits} 次檢測、${data.points} 點`
            : (data?.message ?? '轉移失敗。');

  // 不管成敗都要退出 Google，這個 session 只是為了證明舊帳號是本人
  currentUser = null;
  sessionStorage.removeItem('hq_user');
  await supabase.auth.signOut();

  sessionStorage.setItem('hq_migrate_result', msg);

  // 回到 LINE 帳號；在 LINE 裡是無感的，在外面則需要再按一次登入
  if (!await autoLoginInLiff()) {
    showPage('page-login');
    showLoginError(msg);
  }
}

/* ── 處理登入後的使用者（查 sb_users，沒有就建）── */
async function handleSessionUser(session) {
  const authUser = session.user;
  const name  = authUser.user_metadata?.full_name
              || authUser.user_metadata?.name
              || authUser.email?.split('@')[0]
              || '用戶';
  const email = authUser.email || '';

  let { data: existing } = await supabase
    .from('sb_users').select('*').eq('auth_id', authUser.id).single();

  if (!existing) {
    // LINE 帳號一律由 liff-auth 建好才會走到這裡；
    // 會落到這一段的只有「用 Google 登入但沒有舊帳號」的情況。
    const { data: newUser, error } = await supabase
      .from('sb_users')
      .insert({ auth_id: authUser.id, name, email, phone: email, credits: 0, total_used: 0 })
      .select().single();
    if (error) { showToast('建立帳號失敗：' + (error.message ?? '請重試')); return; }
    existing = newUser;
  }

  currentUser = {
    ...existing,
    total_scans: existing.total_used ?? 0,
    coins:       existing.coins      ?? 0,
    streak:      existing.streak     ?? 0,
    member_code: existing.member_code ?? '',
  };
  sessionStorage.setItem('hq_user', JSON.stringify(currentUser));

  const isAdmin = existing.is_admin === true
               || (existing.phone === window.ADMIN_PHONE && existing.name === window.ADMIN_NAME);
  enterApp(isAdmin);

  // 已經是 LINE 帳號、或已經合併過的，就不用再看到轉移卡片
  const card = document.getElementById('migrate-card');
  if (card && existing.merged_into) card.style.display = 'none';

  const result = sessionStorage.getItem('hq_migrate_result');
  if (result) {
    sessionStorage.removeItem('hq_migrate_result');
    showToast(result, 5000);
    if (card) {
      card.classList.add('done');
      const note = document.getElementById('migrate-note');
      if (note) note.textContent = result;
    }
  }
}

/* ── 登出 ── */
async function logout() {
  await supabase.auth.signOut();
  currentUser = null;
  sessionStorage.removeItem('hq_user');
  try { if (_liffReady && liff.isLoggedIn()) liff.logout(); } catch (_) { /* 不在 LINE 裡 */ }
  showPage('page-login');
}

/* ── 文字大小設定 ── */
function setFontSize(size) {
  document.body.classList.toggle('font-lg', size === 'lg');
  localStorage.setItem('hq_font_size', size);
  document.querySelectorAll('.fs-btn').forEach(btn => btn.classList.remove('active'));
  const active = document.getElementById('fs-btn-' + size);
  if (active) active.classList.add('active');
}

/* ── 初始化 ── */
document.addEventListener('DOMContentLoaded', () => {
  checkWebView();
  setFontSize(localStorage.getItem('hq_font_size') ?? 'md');

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event !== 'SIGNED_IN' || !session) {
      if (event === 'SIGNED_OUT') {
        currentUser = null;
        sessionStorage.removeItem('hq_user');
      }
      return;
    }

    // 轉移流程中：這個 session 是舊的 Google 帳號，不是要登入的人
    const ticket = localStorage.getItem(MERGE_TICKET_KEY);
    if (ticket && !isLineSession(session)) {
      await finishLegacyMigration(ticket);
      return;
    }
    if (!currentUser) await handleSessionUser(session);
  });

  supabase.auth.getSession().then(async ({ data: { session } }) => {
    if (currentUser) return;

    const ticket = localStorage.getItem(MERGE_TICKET_KEY);
    if (session && ticket && !isLineSession(session)) {
      await finishLegacyMigration(ticket);
      return;
    }
    if (session) { await handleSessionUser(session); return; }

    // 沒有 session:在 LINE 裡就自動登入,在外面就顯示登入頁
    if (!await autoLoginInLiff()) showPage('page-login');
  }).catch(() => {
    if (!currentUser) showPage('page-login');
  });
});
