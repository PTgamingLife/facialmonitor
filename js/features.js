/* ═══════════════════════════════════════════════
   features.js — 首頁、任務、豬公、漂流瓶、成就、排行榜
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
      supabase.from('users').select('*').eq('id', currentUser.id).single()
    );
    if (data) {
      Object.assign(currentUser, data);
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
            .from('task_completions').select('day').eq('user_id', currentUser.id);
          completedDays = new Set((completedRows ?? []).map(r => r.day));

          const { data: firstScan } = await supabase
            .from('analyses').select('created_at').eq('user_id', currentUser.id)
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

  container.innerHTML = TASK_PLAN.map(task => {
    const done   = completedDays.has(task.day);
    const today  = task.day === todayDay;
    const locked = task.day > todayDay;
    let cls = 'task-row';
    if (done)   cls += ' task-done';
    if (today)  cls += ' task-today';
    if (locked) cls += ' task-locked';

    const icon = done ? '✓' : locked ? '🔒' : '▶';
    const descHtml = (!locked && task.desc)
      ? `<div class="task-desc">${task.desc.replace(/\n/g,'<br>')}</div>` : '';
    const catIcon = { '食補':'🌿','飲食':'🥗','運動':'🏃','睡眠':'🌙','呼吸':'🌬️','穴位':'👐','心理':'🧘','水分':'💧','總結':'🏅' };
    return `
    <div class="${cls}" onclick="${(locked || done) ? '' : `completeTask(${task.day})`}">
      <span class="task-day-icon">${icon}</span>
      <div class="task-body">
        <div class="task-title">Day ${task.day}｜${task.title}</div>
        <span class="task-cat-chip">${catIcon[task.category] ?? ''}${task.category}</span>
        ${today ? '<div class="task-badge-today">今日任務</div>' : ''}
        ${descHtml}
      </div>
      ${!done && !locked ? `<div class="task-xp">+${task.xp} XP</div>` : ''}
    </div>`;
  }).join('');
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
        supabase.from('task_completions').select('day').eq('user_id', currentUser.id).eq('day', day).single()
      );
      if (existing) { showToast('✅ 此任務已完成'); return; }

      const { error } = await dbQuery(
        supabase.from('task_completions').insert({ user_id: currentUser.id, day, completed_at: new Date().toISOString() })
      );
      if (error) throw error;
    }

    const task = TASK_PLAN.find(t => t.day === day);
    const newCoins = Math.min((currentUser.coins ?? 0) + 1, 100);

    if (!window._demoMode) {
      await dbQuery(supabase.from('users').update({ coins: newCoins }).eq('id', currentUser.id));
    }

    currentUser.coins = newCoins;
    sessionStorage.setItem('hq_user', JSON.stringify(currentUser));

    showToast(`✅ 任務完成！+${task?.xp ?? 10} XP，+1 健康幣`);
    renderPiggyBank(true);
    renderChallenge();
    await checkAchievements();
  } catch { showToast('紀錄失敗，請再試一次'); }
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
    // 查詢設定的推薦碼
    const { data: settings } = await supabase.from('settings').select('*').single();
    let addCredits = 0;
    if (settings) {
      if (code === settings.code_1)   addCredits = 1;
      if (code === settings.code_10)  addCredits = 10;
      if (code === '7540336')         addCredits = 100;
    }

    if (!addCredits) {
      // 檢查是否為其他用戶的會員碼（推薦碼）
      const { data: refUser } = await supabase.from('users').select('id').eq('member_code', code).single();
      if (!refUser || refUser.id === currentUser.id) {
        res.textContent = '密碼無效'; res.className = 'modal-result err'; return;
      }
      // 已使用過？
      const { data: usedCheck } = await supabase.from('code_usages').select('id').eq('user_id', currentUser.id).eq('code', code).single();
      if (usedCheck) { res.textContent = '此密碼已使用過'; res.className = 'modal-result err'; return; }

      addCredits = 1;
      await supabase.from('code_usages').insert({ user_id: currentUser.id, code });
      // 推薦者也加一次
      const { data: refFull } = await supabase.from('users').select('credits').eq('id', refUser.id).single();
      await supabase.from('users').update({ credits: (refFull?.credits ?? 0) + 1 }).eq('id', refUser.id);
    }

    const newCredits = (currentUser.credits ?? 0) + addCredits;
    await supabase.from('users').update({ credits: newCredits }).eq('id', currentUser.id);
    currentUser.credits = newCredits;
    sessionStorage.setItem('hq_user', JSON.stringify(currentUser));
    updateCreditsDisplay();
    res.textContent = `✓ 成功！已增加 ${addCredits} 次檢測次數`;
    res.className = 'modal-result ok';
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

/* ── 漂流瓶（10 瓶預設內容 + 水池動畫） ── */
const DEMO_BOTTLES = [
  { message:'今天早上喝了一大杯溫水，整個人清醒好多，推薦給大家！', category:'水分', time:'10分鐘前' },
  { message:'飯後散步20分鐘真的很有效，消化變好，肚子不脹了 🚶‍♀️', category:'運動', time:'32分鐘前' },
  { message:'連續一週九點上床，皮膚明顯變好，睡眠品質提升真的很重要！', category:'睡眠', time:'1小時前' },
  { message:'冥想10分鐘後，工作壓力少很多，強力推薦！適合睡前做✨', category:'心理', time:'2小時前' },
  { message:'減少手機使用一小時，改拿書來看，心情好平靜。晚安 🌙', category:'心理', time:'3小時前' },
  { message:'今天每餐只吃七分飽，晚上睡覺特別舒服！消化很好', category:'飲食', time:'5小時前' },
  { message:'按摩足三里穴真的會有酸脹感，按完腿感覺輕盈好多 👣 大家試試', category:'穴位', time:'昨天' },
  { message:'今天補充了五份蔬菜，顏色好豐富，吃飯變成一種享受！🥦🥕', category:'飲食', time:'昨天' },
  { message:'每天深呼吸十次真的能讓人靜下來，尤其是工作焦慮時特別有效 🌬️', category:'呼吸', time:'2天前' },
  { message:'14天挑戰完成了！這段時間精神變好，體重也少了一點，感謝這個計畫！💪', category:'總結', time:'3天前' },
];

const BOTTLE_POS = [
  { left:'8%',  top:'20%', dur:'3.2s', delay:'0s'   },
  { left:'30%', top:'48%', dur:'2.8s', delay:'0.5s' },
  { left:'55%', top:'16%', dur:'3.5s', delay:'1.1s' },
  { left:'73%', top:'42%', dur:'2.6s', delay:'0.3s' },
  { left:'14%', top:'63%', dur:'3.8s', delay:'0.8s' },
  { left:'42%', top:'66%', dur:'3.0s', delay:'1.5s' },
  { left:'63%', top:'61%', dur:'2.9s', delay:'0.6s' },
  { left:'82%', top:'20%', dur:'3.3s', delay:'1.2s' },
  { left:'84%', top:'58%', dur:'2.7s', delay:'0.9s' },
  { left:'38%', top:'28%', dur:'3.6s', delay:'1.8s' },
];

async function loadBottle() {
  const container = document.getElementById('bottle-list');
  if (!container) return;

  let bottles = DEMO_BOTTLES;

  if (!window._demoMode) {
    container.innerHTML = '<div class="empty-state">載入中…</div>';
    try {
      const res = await dbQuery(
        supabase.from('bottles').select('*').order('created_at', { ascending: false }).limit(10)
      );
      if (res.data?.length) {
        bottles = res.data.map(b => ({
          message:  b.message,
          category: b.category ?? '健康心聲',
          time:     relativeTime(b.created_at),
        }));
      }
    } catch { }
  }

  window._bottleData = bottles;

  // 渲染水池 + 浮瓶
  container.innerHTML = `
    <div class="bottle-pool-wrap">
      <div class="bottle-pool">
        <div class="pool-glare"></div>
        ${bottles.map((_, i) => {
          const p = BOTTLE_POS[i % BOTTLE_POS.length];
          return `<span class="floating-bottle"
            style="left:${p.left};top:${p.top};--dur:${p.dur};--delay:${p.delay}"
            onclick="openBottleMessage(${i})">🫙</span>`;
        }).join('')}
      </div>
      <p class="bottle-pool-hint">👆 點瓶子查看健康心聲</p>
    </div>`;
}

function openBottleMessage(i) {
  const b = (window._bottleData ?? DEMO_BOTTLES)[i];
  if (!b) return;
  document.getElementById('bottle-msg-text').textContent = b.message;
  document.getElementById('bottle-msg-cat').textContent  = b.category;
  document.getElementById('bottle-msg-time').textContent = b.time;
  document.getElementById('bottle-msg-modal').classList.add('show');
}

function closeBottleMessage() {
  document.getElementById('bottle-msg-modal').classList.remove('show');
}

async function sendBottle() {
  const msg = document.getElementById('bottle-textarea').value.trim();
  const cat = document.getElementById('bottle-category').value;
  if (!msg) { showToast('請輸入訊息再送出'); return; }
  if (msg.length > 300) { showToast('訊息請在 300 字以內'); return; }

  try {
    await supabase.from('bottles').insert({ message: msg, category: cat, user_id: currentUser.id });
    const newSent = (currentUser.bottles_sent ?? 0) + 1;
    await supabase.from('users').update({ bottles_sent: newSent }).eq('id', currentUser.id);
    currentUser.bottles_sent = newSent;
    sessionStorage.setItem('hq_user', JSON.stringify(currentUser));

    document.getElementById('bottle-textarea').value = '';
    showToast('🌊 漂流瓶已送出！');
    loadBottle();
    await checkAchievements();
  } catch { showToast('送出失敗，請稍後再試'); }
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
    bottlesSent:   currentUser.bottles_sent ?? 0,
  };
  // 取完成天數
  if (!window._demoMode) {
    try {
      const { count } = await dbQuery(
        supabase.from('task_completions').select('day', { count:'exact' }).eq('user_id', currentUser.id)
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
        supabase.from('task_completions').select('day',{count:'exact'}).eq('user_id',currentUser.id)
      );
      completedDays = count ?? 0;
    } catch { }
  }
  const ctx = {
    totalScans: currentUser.total_scans ?? 0,
    streak:     currentUser.streak ?? 0,
    coins:      currentUser.coins ?? 0,
    completedDays,
    bottlesSent: currentUser.bottles_sent ?? 0,
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
      <div class="leader-scans">${u.total_scans} 次</div>
    </div>`).join('');
    return;
  }

  let data = null;
  try {
    const res = await dbQuery(
      supabase.from('users').select('name, coins, total_scans, streak').order('coins', { ascending: false }).limit(20)
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
    <div class="leader-scans">${u.total_scans ?? 0} 次</div>
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
