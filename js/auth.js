// ── Init ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  // authReady：初始化完成前不執行 SIGNED_OUT 跳轉，
  // 避免 Supabase 啟動瞬間的暫態事件把用戶踢回登入頁
  let authReady = false;

  // ① onAuthStateChange：監聽所有 auth 事件（含 INITIAL_SESSION）
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
      if (session && !sb_currentUser) {
        await loadUserByAuth(session.user);
      }
    } else if (event === 'SIGNED_OUT') {
      // 只在初始化完成後才跳回登入頁，避免啟動瞬間誤觸
      if (authReady) {
        sb_currentUser = null;
        showPage('page-login');
      }
    }
  });

  // ② 主動取得目前 session（含 OAuth 回調後的 token）
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session && !sb_currentUser) {
      await loadUserByAuth(session.user);
    }
  } catch (e) {
    console.error('[Auth] getSession error:', e);
  }

  authReady = true;

  // ③ 若仍未登入，顯示登入頁
  if (!sb_currentUser) {
    showPage('page-login');
  }

  // ④ 清除 URL token 參數（Supabase 已解析完畢）
  if (window.location.hash && window.location.hash.includes('access_token')) {
    history.replaceState({}, document.title, window.location.pathname);
  }
});

async function loadUserByAuth(authUser) {
  // 先查 sb_users
  let { data } = await sb.from('sb_users')
    .select('id, name, phone, email, credits, total_used, auth_id')
    .eq('auth_id', authUser.id)
    .single();

  // 找不到 → Google 首次登入，自動建立
  if (!data) {
    const name = authUser.user_metadata?.full_name ||
                 authUser.user_metadata?.name ||
                 authUser.email?.split('@')[0] || 'User';
    const email = authUser.email || '';
    const { data: newUser } = await sb.from('sb_users').insert({
      auth_id: authUser.id,
      name: name,
      phone: email,
      email: email,
      credits: 0,
      total_used: 0
    }).select().single();
    data = newUser;
  }

  if (data) {
    sb_currentUser = data;
    checkAndRoute();
  } else {
    showPage('page-login');
  }
}

// ── Page Navigation ──────────────────────────────────────
function showPage(pageId) {
  // 隱藏所有頁面
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });
  const pg = document.getElementById(pageId);
  pg.style.display = '';
  pg.classList.add('active');
  pg.classList.remove('page-enter');
  void pg.offsetWidth;
  pg.classList.add('page-enter');

  if (pageId === 'page-main' && sb_currentUser) {
    document.getElementById('credit-num').textContent = sb_currentUser.credits || 0;
    // 回到首頁時重置到 Step 1
    setTimeout(() => resetToStep1(), 50);
  }
}

function checkAndRoute() {
  if (!sb_currentUser) { showPage('page-login'); return; }
  // Admin: 符合手機號碼+姓名，或信箱是管理員信箱
  const isAdmin = (sb_currentUser.phone === ADMIN_PHONE && sb_currentUser.name === ADMIN_NAME)
                || sb_currentUser.email === 'poting75321@gmail.com';
  if (isAdmin) {
    showPage('page-admin');
    loadAdminUsers();
    ensureMemberCode(); // 確保管理員會員碼生成
    // 顯示後台返回按鈕
    document.querySelectorAll('.admin-back-btn').forEach(el => el.style.display = 'flex');
  } else {
    showPage('page-main');
    document.getElementById('credit-num').textContent = sb_currentUser.credits || 0;
    document.querySelectorAll('.admin-back-btn').forEach(el => el.style.display = 'none');
    ensureMemberCode();
    resetToStep1();
  }
}

// ── 條款勾選控制 ─────────────────────────────────────────
function toggleGoogleBtn() {
  const checked = document.getElementById('terms-agree')?.checked;
  const btn = document.getElementById('btn-google-login');
  if (btn) btn.disabled = !checked;
}

// ── Google OAuth Login ───────────────────────────────────
async function handleGoogleLogin() {
  // 防呆：未勾選條款
  if (!document.getElementById('terms-agree')?.checked) {
    const errEl = document.getElementById('login-error');
    if (errEl) {
      errEl.style.color = 'var(--alert-color)';
      errEl.textContent = '請先閱讀並同意服務條款';
      errEl.style.display = 'block';
    }
    return;
  }
  try {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'https://ptgaminglife.github.io/facialmonitor/',
      }
    });
    if (error) throw error;
  } catch (e) {
    console.error('[GoogleLogin]', e);
    const errEl = document.getElementById('login-error');
    if (errEl) {
      errEl.style.color = 'var(--alert-color)';
      errEl.textContent = '登入失敗：' + (e.message || '請稍後再試');
      errEl.style.display = 'block';
    }
  }
}



// ── Tab Switch（保留但不再使用）──────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', (i===0&&tab==='login')||(i===1&&tab==='register'));
  });
  document.getElementById('form-login').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('form-register').style.display = tab === 'register' ? 'block' : 'none';
}

// ── Register (Supabase Auth) ─────────────────────────────
async function handleRegister() {
  const phone = document.getElementById('inp-phone-reg').value.trim();
  const name = document.getElementById('inp-name-reg').value.trim();
  const email = document.getElementById('inp-email-reg').value.trim();
  const pwd = document.getElementById('inp-password-reg').value;
  const pwdConfirm = document.getElementById('inp-password-confirm').value;
  const errEl = document.getElementById('register-error');
  const okEl = document.getElementById('register-success');
  errEl.style.display = 'none'; okEl.style.display = 'none';

  if (!phone) return showErr(errEl, '請輸入手機號碼');
  if (!name) return showErr(errEl, '請輸入姓名');
  if (!email || !email.includes('@')) return showErr(errEl, '請輸入有效信箱');
  if (pwd.length < 6) return showErr(errEl, '密碼至少6位');
  if (pwd !== pwdConfirm) return showErr(errEl, '兩次密碼不一致');

  const btn = document.getElementById('btn-register');
  btn.disabled = true; btn.textContent = '註冊中…';

  try {
    const { data: authData, error: authErr } = await sb.auth.signUp({
      email,
      password: pwd,
      options: { data: { name, phone } }
    });
    if (authErr) throw authErr;

    // Insert user profile
    await sb.from('sb_users').insert({
      auth_id: authData.user.id,
      name, phone, email, credits: 0, total_used: 0
    });

    okEl.textContent = '✅ 註冊成功！請檢查信箱完成驗證後登入';
    okEl.style.display = 'block';
  } catch (e) {
    showErr(errEl, '註冊失敗：' + (e.message || '請稍後再試'));
  } finally {
    btn.disabled = false; btn.textContent = '立即註冊 →';
  }
}

// ── Login (Supabase Auth) ────────────────────────────────
async function handleLogin() {
  const phone = document.getElementById('inp-phone-login').value.trim();
  const pwd = document.getElementById('inp-password-login').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';

  if (!phone) return showErr(errEl, '請輸入手機號碼');
  if (!pwd) return showErr(errEl, '請輸入密碼');

  const btn = document.getElementById('btn-login');
  btn.disabled = true; btn.textContent = '驗證中…';

  try {
    // Find user by phone to get email
    const { data: userData, error: ue } = await sb.from('sb_users')
      .select('email, id, name, phone, credits, total_used, auth_id')
      .eq('phone', phone).single();

    if (ue || !userData) throw new Error('查無此手機號碼，請先註冊');

    const { data: authData, error: authErr } = await sb.auth.signInWithPassword({
      email: userData.email,
      password: pwd
    });
    if (authErr) throw authErr;

    sb_currentUser = {
      id: userData.id,
      name: userData.name,
      phone: userData.phone,
      email: userData.email,
      credits: userData.credits || 0,
      total_used: userData.total_used || 0,
      auth_id: userData.auth_id
    };
    checkAndRoute();
  } catch (e) {
    showErr(errEl, '登入失敗：' + (e.message || '帳號或密碼錯誤'));
  } finally {
    btn.disabled = false; btn.textContent = '進入診斷 →';
  }
}

async function logout() {
  await sb.auth.signOut();
  sb_currentUser = null;
  sb_faceData = null; sb_tongueData = null;
  showPage('page-login');
}

// ── Google OAuth Login ───────────────────────────────────
// duplicate removed



// ── Forgot Password ──────────────────────────────────────
function openForgot() { document.getElementById('forgot-modal').classList.add('active'); }
function closeForgot() { document.getElementById('forgot-modal').classList.remove('active'); }

async function submitForgot() {
  const email = document.getElementById('forgot-email-inp').value.trim();
  const res = document.getElementById('forgot-result');
  if (!email || !email.includes('@')) { res.style.color='var(--alert-color)'; res.textContent='請輸入有效信箱'; return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href
  });
  if (error) { res.style.color='var(--alert-color)'; res.textContent='寄送失敗：'+error.message; }
  else { res.style.color='var(--ok-color)'; res.textContent='✅ 重設連結已寄出，請檢查信箱'; }
}

// ── Code Modal ───────────────────────────────────────────
function openCodeModal() {
  document.getElementById('code-modal').classList.add('active');
  // Reset referral button state
  const btn = document.getElementById('btn-referral');
  if (btn && sb_currentUser?.referral_used) {
    btn.disabled = true; btn.textContent = '已使用';
  }
}
function closeCodeModal() {
  document.getElementById('code-modal').classList.remove('active');
  const inp = document.getElementById('referral-code-inp');
  if (inp) inp.value = '';
  const res = document.getElementById('referral-result');
  if (res) res.textContent = '';
}

// submitCode removed - replaced by referral system
// Admin health codes still managed in admin panel
