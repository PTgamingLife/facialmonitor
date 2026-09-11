/* ═══════════════════════════════════════════════
   features.js — 首頁、任務、豬公、成就、排行榜
   ═══════════════════════════════════════════════ */

/* ── 首頁載入 ── */
async function loadMain() {
  if (!currentUser) return;
  await refreshUserData();
  const summary = await loadRewardSummary();
  renderPointsJar(summary);
  renderPointTasks(summary);
  document.getElementById('main-member-code').textContent = currentUser.member_code ?? '-------';
}

/* 積分相關的資料一次拿齊，首頁的存錢筒與任務清單共用，不重複打 API */
async function loadRewardSummary() {
  if (window._demoMode) return null;
  try {
    const { data } = await dbQuery(supabase.rpc('rpc_my_reward_summary'), 4000);
    return data ?? null;
  } catch { return null; }
}

/* 帶超時的 Supabase query；Demo 模式直接跳過 */
function dbQuery(promise, ms = 2000) {
  if (window._demoMode) return Promise.resolve({ data: null, error: null });
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('db_timeout')), ms))]);
}

async function refreshUserData() {
  if (window._demoMode) return;
  try {
    const { data } = await dbQuery(
      supabase.from('sb_users').select('*').eq('id', currentUser.id).single()
    );
    if (data) {
      Object.assign(currentUser, data, {
        total_scans: data.total_used ?? currentUser.total_scans ?? 0,
        coins:       data.coins      ?? currentUser.coins       ?? 0,
        streak:      data.streak     ?? currentUser.streak      ?? 0,
      });
      sessionStorage.setItem('hq_user', JSON.stringify(currentUser));
    }
  } catch { /* 離線：保留現有 currentUser */ }
}

/* ── 積分存錢筒 ──
   門檻讀 sb_point_rules 的 redeem_credit（後台改數字，這裡跟著動）。
   class 名稱沿用 piggy-*，改名要連 CSS 一起動，收益不大。 */
function renderPointsJar(summary, newPointAdded = false) {
  const points = summary?.points ?? currentUser.points ?? 0;
  const cost   = summary?.rates?.redeem_credit ?? 100;

  const badge = document.getElementById('piggy-count-badge');
  if (badge) badge.textContent = `${points} 點`;

  // 進度條顯示「離下一次免費檢測還有多遠」，滿了就從頭再算
  const within = cost > 0 ? (points % cost) : 0;
  const pct = cost > 0 ? Math.round(within / cost * 100) : 0;
  const bar = document.getElementById('piggy-bar-fill');
  if (bar) setTimeout(() => { bar.style.width = (points >= cost && within === 0 ? 100 : pct) + '%'; }, 100);

  const labels = document.getElementById('jar-labels');
  if (labels) labels.innerHTML = `<span>0</span><span>${cost}</span>`;

  const sub = document.getElementById('jar-sub');
  if (sub) sub.textContent = `${cost} 點可以換 1 次免費檢測`;

  const hint = document.getElementById('jar-hint');
  if (hint) {
    const exchangeable = cost > 0 ? Math.floor(points / cost) : 0;
    hint.textContent = exchangeable >= 1
      ? `🎉 現在可以換 ${exchangeable} 次檢測`
      : `還差 ${cost - points} 點`;
  }

  if (newPointAdded) spawnCoinAnimation();
}

/* 積分飛入存錢筒的動畫（完成後自動移除） */
function spawnCoinAnimation() {
  const box = document.querySelector('.piggy-box');
  if (!box) return;

  const coin = document.createElement('div');
  coin.className = 'coin-fly';
  coin.textContent = '💎';
  box.appendChild(coin);

  coin.addEventListener('animationend', () => coin.remove(), { once: true });
}

/* ── 首頁：賺積分任務 ──
   點數與規則全部讀 sb_point_rules，後台改數字這裡就跟著動，不用改程式。 */
async function renderPointTasks(summary) {
  const container = document.getElementById('task-list');
  if (!container || !currentUser) return;

  if (window._demoMode) { container.innerHTML = '<div class="empty-state">示範模式不顯示積分任務</div>'; return; }

  let rules = {};
  try {
    const { data } = await dbQuery(
      supabase.from('sb_point_rules').select('rule_key,points,label'), 4000);
    for (const r of data ?? []) rules[r.rule_key] = r;
  } catch { }

  // 本月分數進步幅度（只有自己看得到，RLS 管好了）
  let delta = null;
  try {
    const monthKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 7);
    const { data } = await dbQuery(
      supabase.from('sb_score_snapshots').select('delta')
        .eq('user_id', currentUser.id).eq('month_key', monthKey).maybeSingle(), 4000);
    if (data) delta = data.delta;
  } catch { }

  const pts       = (k, fallback) => rules[k]?.points ?? fallback;
  const threshold = pts('score_up_threshold', 10);
  const hasAngel  = !!summary?.angel;
  const confirmed = summary?.invitee_stats?.confirmed ?? 0;
  const total     = summary?.invitee_stats?.total ?? 0;
  const reached   = delta != null && Number(delta) >= threshold;

  const tasks = [
    {
      // 每日挑戰在 LINE 裡完成(每天早上一張卡 → 半頁式網頁),
      // 網頁這邊只列出來讓人知道有這回事,不重做一份。
      key: 'daily_challenge', icon: '🌿', title: '每天完成一次健康挑戰',
      points: pts('daily_checkin', 3), unit: '／天',
      desc: '每天早上 LINE 會發一題，一週做滿 5 天就算完成',
      done: false, once: false,
    },
    {
      key: 'invite_confirmed', icon: '🤝', title: '推薦朋友完成第一次檢測',
      points: pts('invite_confirmed', 30), unit: '／人',
      desc: total > 0
        ? `已推薦 ${total} 人，其中 ${confirmed} 人完成首檢`
        : '把推薦碼給朋友，他做完第一次面舌診你就得點',
      done: confirmed > 0, page: 'page-reward',
    },
    {
      key: 'score_up_referee', icon: '📈', title: `本月分數進步 ${threshold} 分以上`,
      points: pts('score_up_referee', 20),
      desc: delta == null
        ? '這個月做兩次面舌診才比較得出進步幅度'
        : `本月目前 ${Number(delta) > 0 ? '+' : ''}${delta} 分`,
      done: reached, page: 'page-challenge',
    },
    {
      key: 'score_up_angel', icon: '🌟', title: `我推薦的人進步 ${threshold} 分以上`,
      points: pts('score_up_angel', 50), unit: '／人',
      desc: '他們進步，你也拿積點',
      done: false, page: 'page-reward',
    },
  ];

  container.innerHTML = tasks.map(t => `
    <div class="task-row ${t.done ? 'task-done' : ''}" onclick="showPage('${t.page}')">
      <span class="task-day-icon">${t.done ? '✓' : t.icon}</span>
      <div class="task-body">
        <div class="task-title">${t.title}</div>
        <div class="hist-desc">${t.desc}</div>
        ${t.done && t.once ? '<div class="task-badge-today">已完成</div>' : ''}
      </div>
      <div class="task-xp">+${t.points}${t.unit ?? ''} 點</div>
    </div>`).join('');
}

/* 14 天挑戰已於 v2 移除。每日挑戰改成 LINE 每天早上發一張卡、
   在半頁式 LIFF(challenge.html)裡完成,網頁這邊不再有任務清單。
   首頁下方的 #task-list 現在只給 renderPointTasks()「賺積分任務」用。 */

function openCodeModal() {
  document.getElementById('code-modal').classList.add('show');
  document.getElementById('code-input-field').value = '';
  document.getElementById('code-modal-result').textContent = '';
  document.getElementById('code-modal-result').className = 'modal-result';
}

function closeCodeModal() {
  document.getElementById('code-modal').classList.remove('show');
}

async function submitCode() {
  const code = document.getElementById('code-input-field').value.trim();
  const res  = document.getElementById('code-modal-result');

  if (!/^\d{7}$/.test(code)) {
    res.textContent = '請輸入 7 位數字'; res.className = 'modal-result err'; return;
  }
  res.textContent = '驗證中…'; res.className = 'modal-result';

  try {
    // 先當兌換碼試（sb_health_codes）。加次數只能由 RPC 執行，
    // 前端已無權直接改 sb_users.credits。
    const { data: redeem } = await supabase.rpc('rpc_redeem_health_code', { p_code: code });

    if (redeem?.ok) {
      currentUser.credits = redeem.credits;
      sessionStorage.setItem('hq_user', JSON.stringify(currentUser));
      updateCreditsDisplay();
      res.textContent = `✓ 成功！已增加 ${redeem.credits_added} 次檢測次數`;
      res.className = 'modal-result ok';
      return;
    }

    // 不是兌換碼，就當成別人的推薦碼（認定小天使）
    const { data: angel } = await supabase.rpc('rpc_bind_angel', { p_code: code, p_source: 'web' });

    if (angel?.ok) {
      currentUser.points = angel.balance;
      sessionStorage.setItem('hq_user', JSON.stringify(currentUser));
      res.textContent = `✓ 已認定「${angel.angel_name}」為你的小天使，獲得 ${angel.points_awarded} 點`;
      res.className = 'modal-result ok';
      if (typeof loadReward === 'function') loadReward();
      return;
    }

    res.textContent = angel?.message ?? redeem?.message ?? '密碼無效';
    res.className = 'modal-result err';
  } catch { res.textContent = '驗證失敗，請稍後再試'; res.className = 'modal-result err'; }
}

/* ── 付費 Modal ── */
function openPaymentModal() {
  closeCodeModal();
  document.getElementById('payment-modal').classList.add('show');
  showPaymentStep1();
}

function closePaymentModal() {
  document.getElementById('payment-modal').classList.remove('show');
}

function showPaymentStep1() {
  document.getElementById('payment-step1').style.display = 'block';
  document.getElementById('payment-step2').style.display = 'none';
}

function selectPlan(name, price, count) {
  document.getElementById('payment-step1').style.display = 'none';
  document.getElementById('payment-step2').style.display = 'block';
  document.getElementById('payment-plan-name').textContent = `${name}（${count}次）`;
  document.getElementById('payment-price').textContent     = `NT$ ${price} 元`;
}

/* ── 成就 ── */
async function loadAchievement() {
  const container = document.getElementById('achievement-grid');
  if (!container || !currentUser) return;
  await refreshUserData();

  const ctx = await buildAchievementContext();

  container.innerHTML = ACHIEVEMENTS.map(a => {
    const unlocked = a.condition(ctx);
    return `
    <div class="achievement-card ${unlocked ? 'unlocked' : 'locked'}">
      <div class="achievement-icon">${a.icon}</div>
      <div class="achievement-title">${a.title}</div>
      <div class="achievement-desc">${a.desc}</div>
      ${unlocked ? '<div class="achievement-badge">✓ 已解鎖</div>' : '<div class="achievement-badge locked-badge">🔒 未解鎖</div>'}
    </div>`;
  }).join('');
}

/* 成就的判斷依據:檢測次數、推薦人數、積分。
   積分用「累積賺到的」而不是餘額 —— 花掉了不該把已經解鎖的成就收回去。 */
async function buildAchievementContext() {
  const ctx = {
    totalScans:   currentUser.total_scans ?? 0,
    invitees:     0,
    hasAngel:     false,
    pointsEarned: 0,
    redeemed:     false,
  };
  if (window._demoMode) return ctx;

  try {
    const { data: s } = await dbQuery(supabase.rpc('rpc_my_reward_summary'), 4000);
    if (s) {
      ctx.invitees = s.invitee_stats?.confirmed ?? 0;
      ctx.hasAngel = !!s.angel;
    }
  } catch { }

  try {
    const { data: rows } = await dbQuery(
      supabase.from('sb_point_ledger').select('delta,reason').eq('user_id', currentUser.id), 4000);
    for (const r of rows ?? []) {
      if (r.delta > 0) ctx.pointsEarned += r.delta;
      if (r.reason === 'redeem_credit') ctx.redeemed = true;
    }
  } catch { }

  return ctx;
}

async function checkAchievements() {
  if (!currentUser) return;
  const ctx = await buildAchievementContext();

  // 只提示「這次才解鎖」的。原本每次都把全部已解鎖的成就再吐一輪 toast,
  // 完成一個任務會連跳好幾則,反而看不出剛剛解鎖了什麼。
  const key  = 'hq_ach_seen_' + currentUser.id;
  const seen = new Set(JSON.parse(localStorage.getItem(key) ?? '[]'));

  const fresh = ACHIEVEMENTS.filter(a => a.condition(ctx) && !seen.has(a.id));
  fresh.forEach((a, i) => setTimeout(() => showToast(`🏆 成就解鎖：${a.title}`), i * 1600));

  if (fresh.length) {
    ACHIEVEMENTS.forEach(a => { if (a.condition(ctx)) seen.add(a.id); });
    localStorage.setItem(key, JSON.stringify([...seen]));
  }
}

/* ── 排行榜 ── */
async function loadLeaderboard() {
  const container = document.getElementById('leaderboard-list');
  if (!container) return;
  container.innerHTML = '<div class="empty-state">載入中…</div>';

  // Demo 模式顯示假資料
  if (window._demoMode) {
    const demoData = [
      { name: '示範用戶', coins: 42, total_scans: 3, streak: 7 },
      { name: '健康達人', coins: 38, total_scans: 5, streak: 5 },
      { name: '養生愛好者', coins: 25, total_scans: 2, streak: 3 },
      { name: '每日挑戰者', coins: 18, total_scans: 1, streak: 2 },
    ];
    const medals = ['🥇','🥈','🥉'];
    container.innerHTML = demoData.map((u, i) => `
    <div class="leader-row ${u.name === currentUser?.name ? 'leader-me' : ''}">
      <div class="leader-rank">${medals[i] ?? (i+1)}</div>
      <div class="leader-name">${u.name}</div>
      <div class="leader-coins">🪙 ${u.coins}</div>
      <div class="leader-scans">${u.total_used} 次</div>
    </div>`).join('');
    return;
  }

  let data = null;
  try {
    const res = await dbQuery(
      supabase.from('sb_users').select('name, coins, total_used, streak').order('coins', { ascending: false }).limit(20)
    );
    data = res.data;
  } catch { }

  if (!data?.length) {
    container.innerHTML = '<div class="empty-state">排行榜尚無資料</div>';
    return;
  }

  const medals = ['🥇','🥈','🥉'];
  container.innerHTML = data.map((u, i) => `
  <div class="leader-row ${u.name === currentUser?.name ? 'leader-me' : ''}">
    <div class="leader-rank">${medals[i] ?? (i+1)}</div>
    <div class="leader-name">${escapeHtml(u.name)}</div>
    <div class="leader-coins">🪙 ${u.coins ?? 0}</div>
    <div class="leader-scans">${u.total_used ?? 0} 次</div>
  </div>`).join('');
}

/* ── 分享朋友 Modal ── */
function openShareFriendModal() {
  document.getElementById('share-friend-modal').classList.add('show');
  document.getElementById('share-code-display').textContent = currentUser?.member_code ?? '-------';
}
function closeShareFriendModal() {
  document.getElementById('share-friend-modal').classList.remove('show');
}
