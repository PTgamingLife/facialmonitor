// ── History ───────────────────────────────────────────────
async function loadHistory() {
  if (!sb_currentUser) return;
  const listEl = document.getElementById('history-list');
  listEl.innerHTML = '<div class="empty-state">載入中…</div>';

  const { data, error } = await sb.from('sb_analysis_records')
    .select('id, created_at, report')
    .eq('user_id', sb_currentUser.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !data || !data.length) {
    listEl.innerHTML = `<div class="history-empty">
      <div class="history-empty-icon">📋</div>
      <div class="history-empty-text">尚無診斷記錄<br>完成第一次診斷後會顯示在這裡</div>
    </div>`;
    return;
  }

  listEl.innerHTML = data.map((rec, idx) => {
    const d = new Date(rec.created_at);
    const dateStr = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
    const r = rec.report || {};
    const constitution = (r.constitution && r.constitution.type) || '--';
    let score = 75;
    if (r.scores && r.scores.total) score = r.scores.total;
    const pct = Math.min(100, score);

    return `<div class="med-card" onclick="openHistoryRecord('${rec.id}')">
      <div class="med-card-top">
        <div class="med-card-date">${dateStr}</div>
        <div class="med-card-constitution">${escHtml(constitution)}</div>
        <div class="med-card-score-num">${score}</div>
        <div class="med-card-score-unit">分</div>
        <div class="med-card-bar-wrap">
          <div class="med-card-bar" style="width:${pct}%"></div>
        </div>
      </div>
      <div class="med-card-bottom">
        <div class="med-card-see">查看報告 →</div>
      </div>
    </div>`;
  }).join('');
}

// Store history data for opening
let sb_historyCache = {};

async function openHistoryRecord(recordId) {
  const { data } = await sb.from('sb_analysis_records')
    .select('report, created_at').eq('id', recordId).single();
  if (!data) return;
  sb_currentReport = data.report;
  renderReport(data.report);
  showPage('page-report');
  // Set date
  const d = new Date(data.created_at);
  document.getElementById('report-date').textContent =
    `${d.getFullYear()} 年 ${d.getMonth()+1} 月 ${d.getDate()} 日`;
}

// ── Share Friend ─────────────────────────────────────────
function openShareFriend() {
  document.getElementById('share-friend-modal').classList.add('active');
}
function closeShareFriend() {
  document.getElementById('share-friend-modal').classList.remove('active');
}
function doShareFriend() {
  const msg = document.getElementById('share-msg-inp').value.trim();
  const appUrl = 'https://ptgaminglife.github.io/facialmonitor/';
  const memberCode = sb_currentUser?.member_code || '（尚未生成）';
  const nl = '\n';

  // 組合分享文字，不重複網址
  // navigator.share 的 url 參數會另外帶網址，所以 text 裡不要放網址
  const shareTextWithUrl = '我來送健康 🌿' + nl + nl + appUrl + nl + nl +
    (msg ? msg + nl + nl : '') +
    '推薦碼：' + memberCode + nl +
    '（填入可獲得1次免費檢測）';

  const shareTextNoUrl = '我來送健康 🌿' + nl + nl +
    (msg ? msg + nl + nl : '') +
    '推薦碼：' + memberCode + nl +
    '（填入可獲得1次免費檢測）' + nl + nl + appUrl;

  // Try native share (url參數分開傳，text裡不放網址避免重複)
  if (navigator.share) {
    navigator.share({
      title: '我來送健康 🌿',
      text: shareTextNoUrl,
    })
      .then(() => { closeShareFriend(); })
      .catch(() => { fallbackShare(shareTextWithUrl); });
  } else {
    fallbackShare(shareTextWithUrl);
  }
}
function fallbackShare(text) {
  // Try clipboard + show options
  const encoded = encodeURIComponent(text);
  const lineUrl = `https://line.me/R/msg/text/?${encoded}`;
  const smsUrl = `sms:?body=${encoded}`;

  // Open LINE
  window.open(lineUrl, '_blank');
  closeShareFriend();
}

// ── Payment ───────────────────────────────────────────────
function openPayment() {
  document.getElementById('code-modal').classList.remove('active');
  // 重置到方案選擇畫面
  document.getElementById('pay-step-1').style.display = 'block';
  document.getElementById('pay-step-2').style.display = 'none';
  document.getElementById('payment-modal').classList.add('active');
}

function closePayment() {
  document.getElementById('payment-modal').classList.remove('active');
}

function selectPlan(credits, price, name) {
  // 顯示付款確認畫面
  document.getElementById('pay-step-1').style.display = 'none';
  document.getElementById('pay-step-2').style.display = 'block';

  document.getElementById('pay-confirm-plan-name').textContent = name + '（' + credits + ' 次）';
  document.getElementById('pay-confirm-amount').textContent = 'NT$ ' + price + ' 元';

  // 更新 LINE 連結，帶入方案資訊
  const userEmail = sb_currentUser?.email || '';
  const msg = encodeURIComponent(
    '您好，我想購買「' + name + '」方案 NT$' + price + ' 元\n帳號信箱：' + userEmail
  );
  const lineBtn = document.getElementById('pay-line-btn');
  if (lineBtn) {
    lineBtn.href = 'https://line.me/ti/p/ZC-w2BuPoi';
  }
}

// ── Referral ──────────────────────────────────────────────
async function submitReferral() {
  const code = document.getElementById('referral-code-inp').value.trim();
  const resEl = document.getElementById('referral-result');
  resEl.style.color = 'var(--alert-color)'; resEl.textContent = '';

  if (!code || code.length !== 7) { resEl.textContent = '請輸入7位會員碼'; return; }
  if (code === sb_currentUser.member_code) { resEl.textContent = '不能填入自己的會員碼'; return; }

  // Check if this user already used referral opportunity (regardless of code validity)
  const { data: myData } = await sb.from('sb_users')
    .select('referral_used, credits').eq('id', sb_currentUser.id).single();
  if (myData?.referral_used) {
    resEl.style.color = 'var(--text-hint)';
    resEl.textContent = '你已使用過推薦碼機會（每帳號限一次）';
    document.getElementById('btn-referral').disabled = true;
    document.getElementById('btn-referral').textContent = '已使用';
    return;
  }

  // Mark this account as referral_used FIRST（不論成功失敗，機會只有一次）
  await sb.from('sb_users').update({ referral_used: true }).eq('id', sb_currentUser.id);
  sb_currentUser.referral_used = true;
  document.getElementById('btn-referral').disabled = true;
  document.getElementById('btn-referral').textContent = '已使用';

  // Find referrer by member_code
  const { data: referrer } = await sb.from('sb_users')
    .select('id, referral_count').eq('member_code', code).single();

  if (!referrer) {
    resEl.style.color = 'var(--alert-color)';
    resEl.textContent = '查無此會員碼，推薦碼機會已使用，但未獲得次數';
    return;
  }
  if ((referrer.referral_count || 0) >= 28) {
    resEl.style.color = 'var(--alert-color)';
    resEl.textContent = '此會員碼已達推薦上限（28次），推薦碼機會已使用，但未獲得次數';
    return;
  }

  // Give +1 credit to THIS user only（被推薦者+1，推薦碼提供者不加值）
  const newCredits = (myData.credits || 0) + 1;
  await sb.from('sb_users').update({ credits: newCredits }).eq('id', sb_currentUser.id);

  // Update referrer's referral_count（每推薦4人，推薦者獲得+1次）
  const newRefCount = (referrer.referral_count || 0) + 1;
  await sb.from('sb_users').update({ referral_count: newRefCount }).eq('id', referrer.id);

  // 每 4 次推薦成功，給推薦者 +1 credit
  if (newRefCount % 4 === 0) {
    const { data: refFresh } = await sb.from('sb_users')
      .select('credits').eq('id', referrer.id).single();
    const newRefCredits = (refFresh?.credits || 0) + 1;
    await sb.from('sb_users').update({ credits: newRefCredits }).eq('id', referrer.id);
  }

  sb_currentUser.credits = newCredits;
  document.getElementById('credit-num').textContent = newCredits;

  resEl.style.color = 'var(--ok-color)';
  resEl.textContent = '✅ 成功！你獲得 +1 次檢測機會';
}

// ── Member Code ──────────────────────────────────────────
function generateMemberCode() {
  return Math.floor(1000000 + Math.random() * 9000000).toString();
}

function copyMemberCode() {
  const code = document.getElementById('member-code-val').textContent;
  navigator.clipboard?.writeText(code).then(() => {
    const btn = document.querySelector('.copy-code-btn');
    btn.textContent = '已複製！';
    setTimeout(() => { btn.textContent = '複製'; }, 2000);
  });
}

async function ensureMemberCode() {
  if (!sb_currentUser) return;

  // Reload latest user data to get member_code
  const { data: freshUser } = await sb.from('sb_users')
    .select('member_code, credits, referral_used, referral_count')
    .eq('id', sb_currentUser.id).single();

  if (freshUser) {
    Object.assign(sb_currentUser, freshUser);
    document.getElementById('credit-num').textContent = freshUser.credits || 0;
  }

  if (sb_currentUser.member_code) {
    document.getElementById('member-code-val').textContent = sb_currentUser.member_code;
    // Disable referral button if already used
    const btn = document.getElementById('btn-referral');
    if (btn && sb_currentUser.referral_used) {
      btn.disabled = true; btn.textContent = '已使用';
    }
    return;
  }

  // Admin member code = 7540336
  const isAdmin = sb_currentUser.email === 'poting75321@gmail.com';
  const code = isAdmin ? '7540336' : generateMemberCode();
  await sb.from('sb_users').update({ member_code: code }).eq('id', sb_currentUser.id);
  sb_currentUser.member_code = code;
  document.getElementById('member-code-val').textContent = code;
}

// ── Achievement ───────────────────────────────────────────
const BADGE_MILESTONES = [1, 3, 9, 15, 21, 28];
const TASK_BADGES   = ['⚡','🎯','💪','🏃','🔥','👑'];
const BOTTLE_BADGES = ['🍶','🌊','💌','📬','🌟','🎖️'];
const REFERRAL_BADGES = ['🤝','🌿','🌱','🎋','🌳','🏆'];

async function loadAchievement() {
  if (!sb_currentUser) return;

  // Get task completion count (total done tasks)
  const { count: taskCount } = await sb.from('sb_challenge_progress')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', sb_currentUser.id)
    .eq('done', true);

  // Get bottle count
  const { count: bottleCount } = await sb.from('sb_bottles')
    .select('id', { count: 'exact', head: true })
    .eq('sender_id', sb_currentUser.id);

  // Get referral count
  const { data: myUser } = await sb.from('sb_users')
    .select('referral_count').eq('id', sb_currentUser.id).single();
  const referralCount = myUser?.referral_count || 0;

  // Render task badges
  const taskGrid = document.getElementById('badge-task-grid');
  if (taskGrid) taskGrid.innerHTML = BADGE_MILESTONES.map((m, i) => {
    const unlocked = (taskCount || 0) >= m;
    return `<div class="badge-item">
      <div class="badge-circle ${unlocked ? 'unlocked' : 'locked'}">${TASK_BADGES[i]}</div>
      <div class="badge-num ${unlocked ? 'unlocked' : ''}">${m}次</div>
    </div>`;
  }).join('');

  // Render bottle badges
  const bottleGrid = document.getElementById('badge-bottle-grid');
  if (bottleGrid) bottleGrid.innerHTML = BADGE_MILESTONES.map((m, i) => {
    const unlocked = (bottleCount || 0) >= m;
    return `<div class="badge-item">
      <div class="badge-circle ${unlocked ? 'unlocked' : 'locked'}">${BOTTLE_BADGES[i]}</div>
      <div class="badge-num ${unlocked ? 'unlocked' : ''}">${m}封</div>
    </div>`;
  }).join('');

  // Render referral badges
  const referralGrid = document.getElementById('badge-referral-grid');
  if (referralGrid) referralGrid.innerHTML = BADGE_MILESTONES.map((m, i) => {
    const unlocked = referralCount >= m;
    return `<div class="badge-item">
      <div class="badge-circle ${unlocked ? 'unlocked' : 'locked'}">${REFERRAL_BADGES[i]}</div>
      <div class="badge-num ${unlocked ? 'unlocked' : ''}">${m}人</div>
    </div>`;
  }).join('');

  // Load leaderboard in achievement page
  await loadLeaderboardInto('lb-podium2', 'lb-list2');
}

async function loadLeaderboardInto(podiumId, listId) {
  const { data } = await sb.from('sb_analysis_records')
    .select('user_name, user_phone, report');
  if (!data) return;

  const userBest = {};
  data.forEach(rec => {
    const key = rec.user_phone || rec.user_name;
    const score = rec.report?.scores?.total || 0;
    if (!userBest[key] || score > userBest[key].score) {
      userBest[key] = { name: rec.user_name || '匿名', score };
    }
  });

  const sorted = Object.values(userBest).sort((a, b) => b.score - a.score).slice(0, 10);
  if (!sorted.length) return;

  const avatarC = ['lb-avatar lb-avatar-1','lb-avatar lb-avatar-2','lb-avatar lb-avatar-3'];
  const blockH = ['lb-block-1','lb-block-2','lb-block-3'];
  const medals = ['🥇','🥈','🥉'];
  const top3 = sorted.slice(0, 3);
  const order = top3.length >= 3 ? [1,0,2] : top3.length === 2 ? [1,0] : [0];

  document.getElementById(podiumId).innerHTML = order.map(i => {
    if (!top3[i]) return '';
    const u = top3[i];
    return `<div class="lb-podium-item">
      ${i===0?'<div class="lb-crown">👑</div>':'<div style="height:28px"></div>'}
      <div class="${avatarC[i]}">${(u.name||'?')[0]}</div>
      <div class="lb-rank-name">${escHtml(u.name)}</div>
      <div class="lb-rank-score">${u.score}<span class="lb-rank-unit">分</span></div>
      <div class="${blockH[i]}">${medals[i]}</div>
    </div>`;
  }).join('');

  const rest = sorted.slice(3);
  if (rest.length) {
    document.getElementById(listId).innerHTML = rest.map((u,i) => `
      <div class="lb-row">
        <div class="lb-rank-num">${i+4}</div>
        <div class="lb-user-info"><div class="lb-user-name">${escHtml(u.name)}</div></div>
        <div class="lb-score-badge">${u.score} 分</div>
      </div>`).join('');
  }
}

// ── Piggy Bank ────────────────────────────────────────────
function renderPiggyBank(count) {
  const clamped = Math.min(Math.max(count, 0), 100);
  const pct = clamped / 100;

  // Update count badge
  const countEl = document.getElementById('piggy-count');
  if (countEl) countEl.textContent = clamped;

  // Update fill rect: pig body bottom ≈ y=170, max fill height = 100 SVG units
  const maxH = 100;
  const fillH = Math.round(pct * maxH);
  const fillRect = document.getElementById('pig-fill');
  if (fillRect) {
    fillRect.setAttribute('y', 170 - fillH);
    fillRect.setAttribute('height', fillH);
  }

  // Update progress bar
  const bar = document.getElementById('piggy-bar-fill');
  if (bar) bar.style.width = (pct * 100) + '%';

  // Render coin circles with "H" in pig body (grid from bottom)
  const layer = document.getElementById('pig-coins-layer');
  if (!layer) return;

  const coinR = 7;       // coin radius
  const spacing = 18;    // spacing between coins
  const cols = 7;        // coins per row
  const bodyCx = 105;    // pig body center x
  const bodyBottom = 168; // y of pig body bottom (inside fill)

  let svg = '';
  for (let i = 0; i < clamped; i++) {
    const col = (i % cols) - Math.floor(cols / 2); // -3..+3
    const row = Math.floor(i / cols);
    const cx = bodyCx + col * spacing;
    const cy = bodyBottom - coinR - row * spacing;
    if (cy < 72) break; // don't overflow above pig body
    svg += `<g transform="translate(${cx},${cy})">` +
      `<circle r="${coinR}" fill="#F5D17A" stroke="#C49A5A" stroke-width="1.2"/>` +
      `<text text-anchor="middle" dominant-baseline="central" font-size="8" font-weight="bold" fill="#9E7A3F">H</text>` +
      `</g>`;
  }
  layer.innerHTML = svg;
}

// ── Challenge ─────────────────────────────────────────────
let sb_challengePartner = null;
let sb_challengeData = null;

async function loadChallenge() {
  if (!sb_currentUser) return;

  // Count ALL completed tasks for piggy bank
  const { count: totalDone } = await sb.from('sb_challenge_progress')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', sb_currentUser.id)
    .eq('done', true);
  renderPiggyBank(totalDone || 0);

  // Check latest report has tasks
  const { data: records } = await sb.from('sb_analysis_records')
    .select('id, report, created_at')
    .eq('user_id', sb_currentUser.id)
    .order('created_at', { ascending: false })
    .limit(1);

  const latest = records?.[0];

  if (!latest || !latest.report?.tasks) {
    document.getElementById('challenge-no-report').style.display = 'block';
    document.getElementById('challenge-tasks').style.display = 'none';
    document.getElementById('challenge-empty').style.display = 'none';
    return;
  }

  sb_challengeData = latest;
  document.getElementById('challenge-no-report').style.display = 'none';
  document.getElementById('challenge-empty').style.display = 'none';
  document.getElementById('challenge-tasks').style.display = 'block';

  const tasks = latest.report.tasks || [];
  const riskTitle = latest.report.topRisks?.[0]?.issue || '健康任務';
  document.getElementById('task-risk-title').textContent = `⚡ ${riskTitle} — 14天計劃`;

  const created = new Date(latest.created_at);
  const deadline = new Date(created.getTime() + 14 * 24 * 60 * 60 * 1000);
  const daysLeft = Math.max(0, Math.ceil((deadline - new Date()) / (1000 * 60 * 60 * 24)));
  document.getElementById('task-days-left').textContent = `剩 ${daysLeft} 天`;

  // Get saved progress
  const { data: progress } = await sb.from('sb_challenge_progress')
    .select('task_index, done')
    .eq('user_id', sb_currentUser.id)
    .eq('record_id', latest.id);

  const doneSet = new Set((progress || []).filter(p => p.done).map(p => p.task_index));

  const startDate = new Date(latest.created_at);
  const today = new Date();
  const daysPassed = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));

  document.getElementById('task-list').innerHTML = tasks.map((t, i) => {
    const taskDay = i; // 0-indexed
    const isToday = taskDay === daysPassed;
    const isPast = taskDay < daysPassed;
    const isFuture = taskDay > daysPassed;
    const isDone = doneSet.has(i);

    if (isFuture && taskDay > daysPassed + 0) {
      // Only show next 1 day preview, rest locked
      if (taskDay === daysPassed + 1) {
        return `<div class="task-item" style="opacity:0.35;">
          <div class="task-check" style="border-color:var(--text-hint);cursor:default;"></div>
          <div>
            <div class="task-day">Day ${t.day} — 明天解鎖</div>
            <div class="task-text" style="color:var(--text-hint);">${escHtml(t.action)}</div>
          </div>
        </div>`;
      } else if (taskDay <= daysPassed + 3) {
        return `<div class="task-item" style="opacity:0.2;">
          <div class="task-check" style="border-color:var(--text-hint);cursor:default;">🔒</div>
          <div>
            <div class="task-day">Day ${t.day}</div>
            <div class="task-text" style="color:var(--text-hint);">尚未解鎖</div>
          </div>
        </div>`;
      }
      return ''; // Hide far future tasks
    }

    return `<div class="task-item" id="task-item-${i}" ${isToday ? 'style="background:rgba(196,154,90,0.06);border-radius:8px;padding:10px;"' : ''}>
      <div class="task-check ${isDone ? 'done' : ''}" 
           onclick="${(isPast || isToday) ? `toggleTask(${i}, '${latest.id}')` : ''}"
           style="${isFuture ? 'cursor:default;opacity:0.4;' : ''}">
        ${isDone ? '✓' : isToday ? '▶' : ''}
      </div>
      <div>
        <div class="task-day">Day ${t.day}${isToday ? ' 📍 今天' : ''}</div>
        <div class="task-text ${isDone ? 'done' : ''}">${escHtml(t.action)}</div>
      </div>
    </div>`;
  }).filter(Boolean).join('');

  // Load saved partner
  const { data: partnerRel } = await sb.from('sb_challenge_partners')
    .select('partner_id').eq('user_id', sb_currentUser.id).single();

  if (partnerRel) {
    const { data: pUser } = await sb.from('sb_users')
      .select('id, name, member_code').eq('id', partnerRel.partner_id).single();
    if (pUser) showPartnerInfo(pUser);
  }
}

async function connectPartner() {
  const code = document.getElementById('partner-code-inp').value.trim();
  const errEl = document.getElementById('partner-error');
  errEl.style.display = 'none';

  if (!code || code.length !== 7) return showErr(errEl, '請輸入7位會員碼');
  if (code === sb_currentUser.member_code) return showErr(errEl, '不能連結自己');

  const { data: partner } = await sb.from('sb_users')
    .select('id, name, member_code').eq('member_code', code).single();

  if (!partner) return showErr(errEl, '查無此會員碼');

  // Save partner relationship
  await sb.from('sb_challenge_partners').upsert({
    user_id: sb_currentUser.id,
    partner_id: partner.id
  }, { onConflict: 'user_id' });

  showPartnerInfo(partner);
}

function showPartnerInfo(partner) {
  sb_challengePartner = partner;
  document.getElementById('partner-avatar').textContent = (partner.name || '?')[0];
  document.getElementById('partner-name').textContent = partner.name;
  document.getElementById('partner-info').style.display = 'block';
}

async function toggleTask(index, recordId) {
  const el = document.getElementById(`task-item-${index}`);
  const check = el.querySelector('.task-check');
  const text = el.querySelector('.task-text');
  const isDone = check.classList.contains('done');

  if (isDone) {
    check.classList.remove('done'); check.textContent = '';
    text.classList.remove('done');
    await sb.from('sb_challenge_progress').delete()
      .eq('user_id', sb_currentUser.id).eq('record_id', recordId).eq('task_index', index);
  } else {
    check.classList.add('done'); check.textContent = '✓';
    text.classList.add('done');
    await sb.from('sb_challenge_progress').upsert({
      user_id: sb_currentUser.id, record_id: recordId, task_index: index, done: true
    }, { onConflict: 'user_id,record_id,task_index' });
  }

  // Refresh piggy bank count
  const { count: newTotal } = await sb.from('sb_challenge_progress')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', sb_currentUser.id)
    .eq('done', true);
  renderPiggyBank(newTotal || 0);
}

// ── Leaderboard ──────────────────────────────────────────
async function loadLeaderboard() {
  document.getElementById('lb-podium').innerHTML = '<div style="text-align:center;color:var(--text-hint);padding:40px 0;width:100%;">載入中…</div>';
  document.getElementById('lb-list').innerHTML = '';

  // 每個用戶取最高分紀錄
  const { data, error } = await sb.from('sb_analysis_records')
    .select('user_name, user_phone, report, created_at')
    .order('created_at', { ascending: false });

  if (error || !data) return;

  // 計算每位用戶最高分
  const userBest = {};
  data.forEach(rec => {
    const key = rec.user_phone || rec.user_name;
    const score = rec.report?.scores?.total || 0;
    if (!userBest[key] || score > userBest[key].score) {
      userBest[key] = {
        name: rec.user_name || '匿名用戶',
        score,
        date: rec.created_at
      };
    }
  });

  const sorted = Object.values(userBest).sort((a, b) => b.score - a.score).slice(0, 10);
  if (!sorted.length) {
    document.getElementById('lb-podium').innerHTML = '<div style="text-align:center;color:var(--text-hint);padding:40px 0;width:100%;">尚無資料</div>';
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const blockH = ['lb-block-1', 'lb-block-2', 'lb-block-3'];
  const avatarC = ['lb-avatar lb-avatar-1', 'lb-avatar lb-avatar-2', 'lb-avatar lb-avatar-3'];
  const top3 = sorted.slice(0, 3);
  // 排列順序：2nd, 1st, 3rd
  const order = top3.length >= 3 ? [1, 0, 2] : top3.length === 2 ? [1, 0] : [0];

  let podiumHtml = '';
  order.forEach(i => {
    if (!top3[i]) return;
    const u = top3[i];
    podiumHtml += `
      <div class="lb-podium-item">
        ${i === 0 ? '<div class="lb-crown">👑</div>' : '<div style="height:28px"></div>'}
        <div class="${avatarC[i]}">${(u.name||'?')[0]}</div>
        <div class="lb-rank-name">${escHtml(u.name)}</div>
        <div class="lb-rank-score">${u.score}<span class="lb-rank-unit">分</span></div>
        <div class="${blockH[i]}">${medals[i]}</div>
      </div>`;
  });
  document.getElementById('lb-podium').innerHTML = podiumHtml;

  // 4th+ list
  const rest = sorted.slice(3);
  if (rest.length) {
    document.getElementById('lb-list').innerHTML = rest.map((u, i) => `
      <div class="lb-row">
        <div class="lb-rank-num">${i + 4}</div>
        <div class="lb-user-info">
          <div class="lb-user-name">${escHtml(u.name)}</div>
        </div>
        <div class="lb-score-badge">${u.score} 分</div>
      </div>`).join('');
  }
}

// ── Bottle ────────────────────────────────────────────────
let sb_currentBottle = null;
let sb_bottleViewed = new Set(); // 本次已看過的

async function loadBottle() {
  if (!sb_currentUser) return;
  document.getElementById('bottle-text').textContent = '正在尋找漂流瓶…';
  document.getElementById('bottle-sign').textContent = '';
  document.getElementById('bottle-from').textContent = '來自遠方…';
  document.getElementById('btn-heart').className = 'btn-heart';
  document.getElementById('btn-heart').textContent = '🤍 送出愛心';
  document.getElementById('bottle-card').style.display = 'block';
  document.getElementById('bottle-empty').style.display = 'none';

  // 排除自己寄的 + 本次已看過的
  const viewed = Array.from(sb_bottleViewed);

  let query = sb.from('sb_bottles')
    .select('id, message, sign, sender_id, created_at')
    .neq('sender_id', sb_currentUser.id)
    .order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error || !data || !data.length) {
    document.getElementById('bottle-card').style.display = 'none';
    document.getElementById('bottle-empty').style.display = 'block';
    return;
  }

  // 過濾已看過的，找一封未讀
  const unread = data.filter(b => !viewed.includes(b.id));
  if (!unread.length) {
    // 全部看過了，重置
    sb_bottleViewed.clear();
    sb_currentBottle = data[Math.floor(Math.random() * data.length)];
  } else {
    sb_currentBottle = unread[Math.floor(Math.random() * unread.length)];
  }

  sb_bottleViewed.add(sb_currentBottle.id);

  // 確認是否已愛心過
  const { data: likeData } = await sb.from('sb_bottle_likes')
    .select('id')
    .eq('bottle_id', sb_currentBottle.id)
    .eq('liker_id', sb_currentUser.id)
    .single();

  const d = new Date(sb_currentBottle.created_at);
  const dateStr = `${d.getMonth()+1}/${d.getDate()}`;

  document.getElementById('bottle-from').textContent = `來自 ${dateStr} 的漂流瓶`;
  document.getElementById('bottle-text').textContent = sb_currentBottle.message;
  document.getElementById('bottle-sign').textContent = `— ${sb_currentBottle.sign || '匿名'}`;

  if (likeData) {
    document.getElementById('btn-heart').className = 'btn-heart liked';
    document.getElementById('btn-heart').textContent = '❤️ 已給愛心';
  }
}

async function likeBottle() {
  if (!sb_currentBottle || !sb_currentUser) return;
  const btn = document.getElementById('btn-heart');
  if (btn.classList.contains('liked')) return;

  // 確認此用戶是否已給過此瓶愛心
  const { data: existing } = await sb.from('sb_bottle_likes')
    .select('id').eq('bottle_id', sb_currentBottle.id).eq('liker_id', sb_currentUser.id).single();
  if (existing) { btn.className = 'btn-heart liked'; btn.textContent = '❤️ 已給愛心'; return; }

  // 確認寄信者是否已獲得過愛心獎勵
  const { data: senderData } = await sb.from('sb_users')
    .select('id, credits, bottle_rewarded').eq('id', sb_currentBottle.sender_id).single();

  // 記錄愛心
  await sb.from('sb_bottle_likes').insert({
    bottle_id: sb_currentBottle.id,
    liker_id: sb_currentUser.id
  });

  // 若寄信者尚未獲得愛心獎勵 → 加1次
  if (senderData && !senderData.bottle_rewarded) {
    await sb.from('sb_users').update({
      credits: (senderData.credits || 0) + 1,
      bottle_rewarded: true
    }).eq('id', sb_currentBottle.sender_id);
  }

  btn.className = 'btn-heart liked';
  btn.textContent = '❤️ 已給愛心';
}

async function sendBottle() {
  const msg = document.getElementById('bottle-msg-inp').value.trim();
  const sign = document.getElementById('bottle-sign-inp').value.trim() || '匿名';
  const errEl = document.getElementById('bottle-send-error');
  const okEl = document.getElementById('bottle-send-ok');
  errEl.style.display = 'none'; okEl.style.display = 'none';

  if (!msg) { showErr(errEl, '請輸入訊息內容'); return; }
  if (msg.length < 5) { showErr(errEl, '訊息至少5個字'); return; }

  const { error } = await sb.from('sb_bottles').insert({
    sender_id: sb_currentUser.id,
    sender_name: sb_currentUser.name,
    message: msg,
    sign: sign
  });

  if (error) { showErr(errEl, '寄送失敗，請稍後再試'); return; }

  document.getElementById('bottle-msg-inp').value = '';
  okEl.textContent = '🍶 漂流瓶已投入大海！';
  okEl.style.display = 'block';
  setTimeout(() => { okEl.style.display = 'none'; }, 3000);
}
