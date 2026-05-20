// ── Admin Functions ───────────────────────────────────────
// ── Health Codes Management ──────────────────────────────
let sb_allCodes = [];

async function loadHealthCodes() {
  const listEl = document.getElementById('health-code-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="empty-state">載入中…</div>';

  const { data, error } = await sb.from('sb_health_codes')
    .select('id, code, credits, used_by, used_at')
    .order('created_at', { ascending: false })
    .limit(50);

  sb_allCodes = data || [];

  if (!sb_allCodes.length) {
    listEl.innerHTML = '<div class="empty-state">尚無健康密碼</div>';
    return;
  }

  listEl.innerHTML = `<div class="code-list">` +
    sb_allCodes.map(c => `
      <div class="code-row" id="coderow-${c.id}">
        <div class="code-value">${escHtml(c.code)}</div>
        <div class="code-credits">+${c.credits}次</div>
        ${c.used_by
          ? `<div class="code-status-used">已使用</div>`
          : `<div class="code-status-ok">可用</div>
             <button class="btn-del-code" onclick="deleteHealthCode('${c.id}')" title="刪除">✕</button>`
        }
      </div>`).join('') + `</div>`;
}

async function addHealthCode() {
  const code = document.getElementById('new-code-inp').value.trim();
  const credits = parseInt(document.getElementById('new-code-credits').value) || 1;
  const errEl = document.getElementById('code-mgmt-error');
  const okEl = document.getElementById('code-mgmt-ok');
  errEl.style.display = 'none'; okEl.style.display = 'none';

  if (!code || code.length !== 7) return showErr(errEl, '密碼必須是7位數字');
  if (!/^\d+$/.test(code)) return showErr(errEl, '密碼只能包含數字');

  const { error } = await sb.from('sb_health_codes').insert({ code, credits });
  if (error) {
    if (error.message.includes('duplicate') || error.code === '23505') {
      return showErr(errEl, '此密碼已存在');
    }
    return showErr(errEl, '新增失敗：' + error.message);
  }

  document.getElementById('new-code-inp').value = '';
  okEl.textContent = `✅ 密碼 ${code} 已新增（+${credits}次）`;
  okEl.style.display = 'block';
  setTimeout(() => { okEl.style.display = 'none'; }, 3000);
  loadHealthCodes();
}

async function deleteHealthCode(id) {
  const row = document.getElementById(`coderow-${id}`);
  if (!confirm('確定刪除此密碼？')) return;
  await sb.from('sb_health_codes').delete().eq('id', id).is('used_by', null);
  if (row) row.remove();
}

async function loadAdminUsers() {
  loadHealthCodes();
  const { data } = await sb.from('sb_users')
    .select('id, name, phone, credits, total_used')
    .order('created_at', { ascending: false })
    .limit(100);
  sb_allUsers = data || [];
  renderUserList(sb_allUsers);
}

function filterUsers() {
  const q = document.getElementById('admin-search').value.toLowerCase();
  const filtered = sb_allUsers.filter(u =>
    u.name.toLowerCase().includes(q) || u.phone.toLowerCase().includes(q)
  );
  renderUserList(filtered);
}

function renderUserList(users) {
  const el = document.getElementById('admin-user-list');
  if (!users.length) { el.innerHTML = '<div class="empty-state">無用戶資料</div>'; return; }
  el.innerHTML = `<div class="user-list">` + users.map(u => `
    <div class="user-row">
      <div class="user-avatar">${(u.name||'?')[0]}</div>
      <div class="user-info">
        <div class="user-name">${escHtml(u.name||'')}</div>
        <div class="user-phone">${escHtml(u.email||u.phone||'')} · 使用 ${u.total_used||0} 次</div>
      </div>
      <div class="user-credits">${u.credits||0}次</div>
      <div class="user-actions">
        <button class="btn-add-credit" onclick="quickAdd('${u.id}',1)">+1</button>
        <button class="btn-add-credit" onclick="quickAdd('${u.id}',5)">+5</button>
      </div>
    </div>`).join('') + `</div>`;
}

async function quickAdd(userId, amount) {
  const user = sb_allUsers.find(u => u.id === userId);
  if (!user) return;
  const newCredits = (user.credits || 0) + amount;
  await sb.from('sb_users').update({ credits: newCredits }).eq('id', userId);
  user.credits = newCredits;
  renderUserList(sb_allUsers);
}

async function bulkAddCredits() {
  const phone = document.getElementById('bulk-phone').value.trim();
  const amount = parseInt(document.getElementById('bulk-amount').value) || 0;
  const errEl = document.getElementById('bulk-error');
  const okEl = document.getElementById('bulk-success');
  errEl.style.display = 'none'; okEl.style.display = 'none';

  if (!phone) return showErr(errEl, '請輸入手機號碼');
  if (amount < 1) return showErr(errEl, '次數需大於0');

  // 支援手機號碼或信箱查詢
  let query = sb.from('sb_users').select('id, credits, name');
  if (phone.includes('@')) {
    query = query.eq('email', phone);
  } else {
    query = query.eq('phone', phone);
  }
  const { data, error } = await query.single();
  if (error || !data) return showErr(errEl, '查無此用戶（可輸入手機或信箱）');

  const newCredits = (data.credits || 0) + amount;
  await sb.from('sb_users').update({ credits: newCredits }).eq('id', data.id);
  okEl.textContent = `✅ 已為 ${data.name||phone} 新增 ${amount} 次，共 ${newCredits} 次`;
  okEl.style.display = 'block';
  loadAdminUsers();
}
