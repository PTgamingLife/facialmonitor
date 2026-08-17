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

  // ?p=share 不是頁面,是「開啟 LINE 的分享視窗」這個動作
  if (wanted === 'share') { showPage('page-main'); startShareFlow(); return; }

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

   兩個限制決定了這個設計：

   1. 轉移一定會換 session（新帳號 → 舊帳號），兩個身分不可能同時在線。
      所以由新帳號在「自己還登入時」先開一張票，目標寫死在票裡；
      舊帳號只能拿票兌換，無法指定要搬去哪，別人的帳號就塞不進東西。

   2. **Google 不允許在 App 內建瀏覽器裡做 OAuth**（disallowed_useragent）。
      LINE 的內建瀏覽器正是這種 —— 實測跳去 Google 之後完全不會回來。
      所以在 LINE 裡按下按鈕時，改成把票用網址帶去「外部瀏覽器」，
      整段 Google 登入與兌換都在 Safari／Chrome 裡完成。
      票是一次性、15 分鐘到期，而且只能「把自己的資料推進目標帳號」，
      放在網址上可以接受。
   ══════════════════════════════════════════════════════════ */


const MERGE_TICKET_KEY = 'hq_merge_ticket';

/** 是不是 LINE 建立的帳號（liff-auth 用 @line.local 當合成信箱） */
function isLineSession(session) {
  return (session?.user?.email ?? '').endsWith('@line.local');
}

function appBaseUrl() {
  return location.origin + location.pathname;
}

async function startLegacyMigration() {
  const btn = document.getElementById('migrate-btn');
  const note = document.getElementById('migrate-note');
  if (btn) btn.disabled = true;
  if (note) note.textContent = '準備中…';

  const { data, error } = await supabase.rpc('rpc_issue_merge_ticket');
  if (error || !data?.ok) {
    if (btn) btn.disabled = false;
    // 把真正的錯誤講出來。之前一律顯示「請稍後再試」，結果 PostgREST 回 404
    // （schema 快取沒重載、根本找不到這支 RPC）也長成同一句話，完全查不出方向。
    if (note) note.textContent = data?.message ?? (error ? `轉移失敗：${error.message}` : '目前無法轉移，請稍後再試。');
    if (error) console.error('rpc_issue_merge_ticket failed:', error);
    return;
  }

  const url = `${appBaseUrl()}?merge=${encodeURIComponent(data.ticket)}`;

  // 在 LINE 裡：一定要開到外部瀏覽器，Google 不接受內建瀏覽器的登入
  if (_liffReady && liff.isInClient()) {
    liff.openWindow({ url, external: true });
    if (btn) btn.disabled = false;
    if (note) {
      note.textContent = '已在外部瀏覽器開啟轉移頁面。完成 Google 登入後，回到這裡重新開啟即可看到資料。';
    }
    return;
  }

  // 已經在一般瀏覽器裡，直接走
  location.href = url;
}

/** 從 LINE 跳過來的轉移分頁：收下票 → 送去 Google 登入
 *
 *  票只用網址帶「一次」（LINE 內建瀏覽器與外部瀏覽器的 localStorage 不互通），
 *  進到這裡就立刻改存 localStorage。Google 的 redirectTo 不能帶自訂 query，
 *  否則會對不上 Supabase 的 redirect 白名單而被丟回 Site URL，票就掉了。
 */
async function bootMergeTab(ticket) {
  showPage('page-login');
  const btn = document.getElementById('btn-line-login');
  if (btn) btn.style.display = 'none';

  localStorage.setItem(MERGE_TICKET_KEY, ticket);
  // 網址上的票用完就擦掉，不要留在瀏覽紀錄與分享連結裡
  history.replaceState({}, document.title, appBaseUrl());

  const { data: { session } } = await supabase.auth.getSession();
  if (session) await supabase.auth.signOut();   // 不能帶著 LINE 身分去兌換

  showLoginError('請用你舊的 Google 帳號登入，完成後會自動轉移。');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: appBaseUrl() }
  });
  if (error) showLoginError('Google 登入失敗：' + error.message);
}

/** Google 登入回來之後：兌換票券，顯示結果 */
async function finishLegacyMigration(ticket) {
  showPage('page-login');
  const btn = document.getElementById('btn-line-login');
  if (btn) btn.style.display = 'none';
  showLoginError('轉移中，請稍候…');

  const { data, error } = await supabase.rpc('rpc_redeem_merge_ticket', { p_ticket: ticket });
  localStorage.removeItem(MERGE_TICKET_KEY);
  if (error) console.error('rpc_redeem_merge_ticket failed:', error);

  const msg = error
    ? `轉移失敗：${error.message}`
    : data?.ok
      ? `✅ 已轉移 ${data.records} 筆檢測紀錄，目前 ${data.credits} 次檢測、${data.points} 點。`
        + `\n可以關掉這一頁，回到 LINE 重新開啟就會看到。`
      : (data?.message ?? '轉移失敗。');

  // 這個 Google session 只是為了證明舊帳號是本人，用完就登出
  currentUser = null;
  sessionStorage.removeItem('hq_user');
  await supabase.auth.signOut();
  showLoginError(msg);
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

  // 轉移卡片只對「LINE 帳號、而且還沒轉移過」的人顯示。
  // 登在舊 Google 帳號時給他看這張卡沒有意義 —— 按下去只會得到
  // 「這已經是同一個帳號了」，白繞一圈。
  const card = document.getElementById('migrate-card');
  if (card) {
    const canMigrate = !!existing.line_user_id && !existing.merged_into;
    card.style.display = canMigrate ? '' : 'none';
  }
}

/* ══════════════════════════════════════════════════════════
   分享推薦:叫出 LINE 的好友選擇器，一次把官方帳號與推薦碼送出去
   ══════════════════════════════════════════════════════════ */
async function startShareFlow() {
  if (!await initLiff()) { showToast('請在 LINE 裡開啟才能分享'); return; }

  const code = currentUser?.member_code;
  if (!code) { showToast('會員碼還沒載入，請稍後再試'); return; }

  // shareTargetPicker 只有在 LINE 內建瀏覽器裡才有；在外面開就退回複製文字
  const text =
    `我在用「看·健」測體質、做健康任務，滿有感的 🌿\n\n` +
    `用我的推薦碼加入，你我都有積點可以換免費檢測：\n` +
    `推薦碼：${code}\n\n` +
    (window.OA_URL ? `先加官方帳號 👉 ${window.OA_URL}\n` : '') +
    `加入後在 LINE 傳「小天使 ${code}」就完成囉。`;

  if (typeof liff === 'undefined' || !liff.isApiAvailable?.('shareTargetPicker')) {
    copyText(text);
    showToast('已複製分享文字，貼給朋友就可以了');
    return;
  }

  try {
    const res = await liff.shareTargetPicker([{ type: 'text', text }]);
    // res 為 null = 使用者按了取消，不要當成失敗吼他
    showToast(res ? '✅ 已送出，朋友收到就能用你的推薦碼' : '已取消分享');
  } catch (e) {
    console.error('shareTargetPicker failed', e);
    copyText(text);
    showToast('分享視窗開不起來，已改成複製文字');
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

  // 帶著 ?merge=<票> 進來的分頁只做一件事：轉移。
  // 它跑在外部瀏覽器裡（Google 不接受 LINE 內建瀏覽器的 OAuth），
  // 不要讓它去碰正常的登入流程。
  const mergeTicket = new URLSearchParams(location.search).get('merge');
  if (mergeTicket) { bootMergeTab(mergeTicket); return; }

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event !== 'SIGNED_IN' || !session) {
      if (event === 'SIGNED_OUT') {
        currentUser = null;
        sessionStorage.removeItem('hq_user');
      }
      return;
    }
    const pending = localStorage.getItem(MERGE_TICKET_KEY);
    if (pending && !isLineSession(session)) {
      await finishLegacyMigration(pending);
      return;
    }
    if (!currentUser) await handleSessionUser(session);
  });

  supabase.auth.getSession().then(async ({ data: { session } }) => {
    if (currentUser) return;

    // 從 Google 轉回來:手上有票、而且現在的身分是舊帳號 → 兌換
    const pending = localStorage.getItem(MERGE_TICKET_KEY);
    if (pending && session && !isLineSession(session)) {
      await finishLegacyMigration(pending);
      return;
    }

    // 在 LINE 裡的話,LINE 身分一律優先。
    //
    // 少了這段會出事:改用 LINE 登入之前若曾經在 LINE 內建瀏覽器用 Google 登入過,
    // 那組 session 還留在 localStorage 裡。下面的 getSession() 會先撿到它,
    // 於是「用 LINE 開啟」卻登進舊的 Google 帳號 —— 畫面看起來是新帳號直接帶著
    // 舊資料,很像轉移已經完成,實際上兩個帳號完全沒有關聯。
    const inLine = await initLiff() && (liff.isInClient() || liff.isLoggedIn());
    if (session && inLine && !isLineSession(session)) {
      await supabase.auth.signOut();
      session = null;
    }

    if (session) { await handleSessionUser(session); return; }

    // 沒有 session:在 LINE 裡就自動登入,在外面就顯示登入頁
    if (!await autoLoginInLiff()) showPage('page-login');
  }).catch(() => {
    if (!currentUser) showPage('page-login');
  });
});
