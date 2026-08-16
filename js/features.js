/* ═══════════════════════════════════════════════
   features.js — 首頁、任務、豬公、成就、排行榜
   ═══════════════════════════════════════════════ */

/* ── 首頁載入 ── */
async function loadMain() {
  if (!currentUser) return;
  await refreshUserData();
  renderPiggyBank();
  renderChallenge();
  document.getElementById('main-member-code').textContent = currentUser.member_code ?? '-------';
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

/* ── 豬公金幣 ── */
function renderPiggyBank(newCoinAdded = false) {
  const coins = Math.min(currentUser.coins ?? 0, 100);

  // 進度條
  const bar = document.getElementById('piggy-bar-fill');
  if (bar) setTimeout(() => { bar.style.width = coins + '%'; }, 100);

  const badge = document.getElementById('piggy-count-badge');
  if (badge) badge.textContent = `${coins}/100`;

  // 任務完成時發射一枚金幣飛入動畫
  if (newCoinAdded) spawnCoinAnimation();
}

/* 金幣飛入豬公動畫（完成後自動移除） */
function spawnCoinAnimation() {
  const box = document.querySelector('.piggy-box');
  if (!box) return;

  const coin = document.createElement('div');
  coin.className = 'coin-fly';
  coin.textContent = '🪙';
  box.appendChild(coin);

  coin.addEventListener('animationend', () => coin.remove(), { once: true });
}

/* ── 14 天任務 ── */
async function renderChallenge() {
  const container = document.getElementById('task-list');
  if (!container || !currentUser) return;

  let completedDays = new Set();
  let todayDay = 1;

  if (window._demoMode) {
    // Demo 模式：用全域 Set 追蹤已完成任務
    window._demoCompletedDays = window._demoCompletedDays ?? new Set();
    completedDays = window._demoCompletedDays;
    todayDay = 1; // demo 固定顯示第一天可執行
  } else {
    try {
      await Promise.race([
        (async () => {
          const { data: completedRows } = await supabase
            .from('sb_challenge_progress').select('task_index').eq('user_id', currentUser.id);
          completedDays = new Set((completedRows ?? []).map(r => r.task_index + 1));

          const { data: firstScan } = await supabase
            .from('sb_analysis_records').select('created_at').eq('user_id', currentUser.id)
            .order('created_at', { ascending: true }).limit(1).single();
          if (firstScan) {
            const diff = Math.floor((Date.now() - new Date(firstScan.created_at)) / 86400000);
            todayDay = Math.min(diff + 1, 14);
          }
        })(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('db_timeout')), 2000))
      ]);
    } catch { }
  }

  const catIcon = { '食補':'🌿','飲食':'🥗','運動':'🏃','睡眠':'🌙','呼吸':'🌬️','穴位':'👐','心理':'🧘','水分':'💧','總結':'🏅' };

  container.innerHTML = TASK_PLAN.map(task => {
    const done   = completedDays.has(task.day);
    const today  = task.day === todayDay;
    const locked = task.day > todayDay;
    let cls = 'task-row';
    if (done)   cls += ' task-done';
    if (today)  cls += ' task-today';
    if (locked) cls += ' task-locked';

    const icon = done ? '✓' : locked ? '🔒' : (today ? '▶' : '○');
    return `
    <div class="${cls}" onclick="openTaskModal(${task.day})">
      <span class="task-day-icon">${icon}</span>
      <div class="task-body">
        <div class="task-title">Day ${task.day}｜${task.title}</div>
        <span class="task-cat-chip">${catIcon[task.category] ?? ''}${task.category}</span>
        ${today && !done ? '<div class="task-badge-today">今日任務</div>' : ''}
      </div>
      ${!done && !locked ? `<div class="task-xp">+${task.xp} XP</div>` : ''}
    </div>`;
  }).join('');

  window._taskRenderState = { completedDays, todayDay, catIcon };
}

async function completeTask(day) {
  if (!currentUser) return;
  try {
    if (window._demoMode) {
      // Demo：已完成就擋住
      window._demoCompletedDays = window._demoCompletedDays ?? new Set();
      if (window._demoCompletedDays.has(day)) {
        showToast('✅ 此任務已完成');
        return;
      }
      window._demoCompletedDays.add(day);
    } else {
      // 真實模式：先確認是否已完成，避免重複加幣
      const { data: existing } = await dbQuery(
        supabase.from('sb_challenge_progress').select('task_index').eq('user_id', currentUser.id).eq('task_index', day - 1).single()
      );
      if (existing) { showToast('✅ 此任務已完成'); return; }

      const { error } = await dbQuery(
        supabase.from('sb_challenge_progress').insert({ user_id: currentUser.id, task_index: day - 1, done: true })
      );
      if (error) throw error;
    }

    const task = TASK_PLAN.find(t => t.day === day);
    const newCoins = Math.min((currentUser.coins ?? 0) + 1, 100);

    if (!window._demoMode) {
      await dbQuery(supabase.from('sb_users').update({ coins: newCoins }).eq('id', currentUser.id));
    }

    currentUser.coins = newCoins;
    sessionStorage.setItem('hq_user', JSON.stringify(currentUser));

    showToast(`✅ 任務完成！+${task?.xp ?? 10} XP，+1 健康幣`);
    renderPiggyBank(true);
    renderChallenge();
    await checkAchievements();
  } catch { showToast('紀錄失敗，請再試一次'); }
}

/* ── 任務詳情 Modal ── */
function openTaskModal(day) {
  const task = TASK_PLAN.find(t => t.day === day);
  if (!task) return;

  const state = window._taskRenderState ?? {};
  const completedDays = state.completedDays ?? new Set();
  const todayDay      = state.todayDay ?? 1;
  const catIcon       = state.catIcon  ?? {};

  const done   = completedDays.has(day);
  const locked = day > todayDay;

  document.getElementById('task-modal-cat').textContent   = (catIcon[task.category] ?? '') + task.category;
  document.getElementById('task-modal-day').textContent   = `Day ${task.day}`;
  document.getElementById('task-modal-title').textContent = task.title;
  document.getElementById('task-modal-desc').textContent  = task.desc ?? '';

  const actions = document.getElementById('task-modal-actions');
  if (done) {
    actions.innerHTML = `<div style="text-align:center;color:var(--ok-color);font-weight:700;font-size:15px;">✅ 已完成</div>`;
  } else if (locked) {
    actions.innerHTML = `<div style="text-align:center;color:var(--text-hint);font-size:14px;">🔒 尚未解鎖</div>`;
  } else {
    actions.innerHTML = `
      <button class="btn-gold" style="margin-bottom:10px" onclick="completeTaskFromModal(${day})">✅ 完成任務</button>
      <button class="btn-ghost" onclick="closeTaskModal()">稍後再做</button>`;
  }

  document.getElementById('task-detail-modal').classList.add('show');
}

function closeTaskModal() {
  document.getElementById('task-detail-modal').classList.remove('show');
}

async function completeTaskFromModal(day) {
  closeTaskModal();
  await completeTask(day);
}

/* ── 推薦碼 Modal ── */
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

  const userCtx = {
    totalScans:    currentUser.total_scans ?? 0,
    streak:        currentUser.streak ?? 0,
    coins:         currentUser.coins ?? 0,
    completedDays: 0,
  };
  // 取完成天數
  if (!window._demoMode) {
    try {
      const { count } = await dbQuery(
        supabase.from('sb_challenge_progress').select('task_index', { count:'exact' }).eq('user_id', currentUser.id)
      );
      userCtx.completedDays = count ?? 0;
    } catch { }
  }

  container.innerHTML = ACHIEVEMENTS.map(a => {
    const unlocked = a.condition(userCtx);
    return `
    <div class="achievement-card ${unlocked ? 'unlocked' : 'locked'}">
      <div class="achievement-icon">${a.icon}</div>
      <div class="achievement-title">${a.title}</div>
      <div class="achievement-desc">${a.desc}</div>
      ${unlocked ? '<div class="achievement-badge">✓ 已解鎖</div>' : '<div class="achievement-badge locked-badge">🔒 未解鎖</div>'}
    </div>`;
  }).join('');
}

async function checkAchievements() {
  if (!currentUser) return;
  let completedDays = 0;
  if (!window._demoMode) {
    try {
      const { count } = await dbQuery(
        supabase.from('sb_challenge_progress').select('task_index',{count:'exact'}).eq('user_id',currentUser.id)
      );
      completedDays = count ?? 0;
    } catch { }
  }
  const ctx = {
    totalScans: currentUser.total_scans ?? 0,
    streak:     currentUser.streak ?? 0,
    coins:      currentUser.coins ?? 0,
    completedDays,
  };
  ACHIEVEMENTS.forEach(a => {
    if (a.condition(ctx)) showToast(`🏆 成就解鎖：${a.title}`);
  });
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
