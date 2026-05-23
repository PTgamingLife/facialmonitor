/* ── 管理後台 ── */

async function loadAdminUsers() {
  const list = document.getElementById('admin-user-list');
  if (!list) return;

  const { data: users } = await supabase
    .from('users')
    .select('id,name,phone,credits,coins,total_scans,member_code,created_at')
    .order('created_at', { ascending: false });

  const { data: settings } = await supabase.from('settings').select('*').single();
  if (settings) {
    const c1  = document.getElementById('admin-code1-input');
    const c10 = document.getElementById('admin-code10-input');
    if (c1)  c1.value  = settings.code_1  ?? '';
    if (c10) c10.value = settings.code_10 ?? '';
  }

  const stats = document.getElementById('admin-stats');
  if (stats && users) {
    stats.innerHTML = `
    <div class="admin-stat-row">
      <span>👥 總用戶</span><strong>${users.length}</strong>
    </div>
    <div class="admin-stat-row">
      <span>🔬 總掃描</span><strong>${users.reduce((s,u)=>s+(u.total_scans??0),0)}</strong>
    </div>`;
  }

  if (!users?.length) { list.innerHTML = '<div class="empty-state">尚無用戶資料</div>'; return; }

  list.innerHTML = `
  <table class="admin-table">
    <thead>
      <tr>
        <th>姓名</th><th>手機</th><th>會員碼</th><th>次數</th><th>金幣</th><th>掃描</th><th>操作</th>
      </tr>
    </thead>
    <tbody>
    ${users.map(u => `
      <tr>
        <td>${escapeHtml(u.name)}</td>
        <td>${u.phone}</td>
        <td style="font-size:11px;letter-spacing:1px">${u.member_code ?? '—'}</td>
        <td>
          <input class="admin-edit-input" id="cr-${u.id}" type="number" value="${u.credits ?? 0}" min="0">
        </td>
        <td>${u.coins ?? 0}</td>
        <td>${u.total_scans ?? 0}</td>
        <td>
          <button class="btn-save-credits" onclick="saveCredits('${u.id}')">儲存</button>
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

async function saveCredits(userId) {
  const input = document.getElementById(`cr-${userId}`);
  if (!input) return;
  const val = parseInt(input.value);
  if (isNaN(val) || val < 0) { showToast('請輸入有效次數'); return; }

  const { error } = await supabase.from('users').update({ credits: val }).eq('id', userId);
  if (error) { showToast('儲存失敗'); return; }
  showToast('✅ 次數已更新');
}

async function updateCode(type) {
  const inputId = type === 1 ? 'admin-code1-input' : 'admin-code10-input';
  const resultId = type === 1 ? 'admin-code1-result' : 'admin-code10-result';
  const input  = document.getElementById(inputId);
  const result = document.getElementById(resultId);

  const code = input?.value.trim();
  if (!code || !/^\d{7}$/.test(code)) {
    result.textContent = '請輸入 7 位數字'; result.style.color = 'var(--alert-color)'; return;
  }

  const field = type === 1 ? 'code_1' : 'code_10';
  const { error } = await supabase.from('settings').upsert({ id: 1, [field]: code });
  if (error) { result.textContent = '更新失敗'; result.style.color='var(--alert-color)'; return; }
  result.textContent = '✓ 已更新'; result.style.color = 'var(--ok-color)';
  setTimeout(() => { result.textContent = ''; }, 3000);
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
