/* ── 管理後台 ── */

async function loadAdminUsers() {
  const list = document.getElementById('admin-user-list');
  if (!list) return;

  // 用戶列表
  const { data: users } = await supabase
    .from('sb_users')
    .select('id,name,phone,email,credits,total_used,member_code,created_at')
    .order('created_at', { ascending: false });

  // 密碼設定：讀取未使用的 health codes
  const { data: codes } = await supabase
    .from('sb_health_codes')
    .select('id,code,credits')
    .is('used_by', null)
    .order('credits');

  if (codes) {
    const c1  = codes.find(c => c.credits === 1);
    const c10 = codes.find(c => c.credits === 10);
    const c1El  = document.getElementById('admin-code1-input');
    const c10El = document.getElementById('admin-code10-input');
    if (c1El)  { c1El.value  = c1?.code  ?? ''; c1El.dataset.id  = c1?.id  ?? ''; }
    if (c10El) { c10El.value = c10?.code ?? ''; c10El.dataset.id = c10?.id ?? ''; }
  }

  const stats = document.getElementById('admin-stats');
  if (stats && users) {
    stats.innerHTML = `
    <div class="admin-stat-row">
      <span>👥 總用戶</span><strong>${users.length}</strong>
    </div>
    <div class="admin-stat-row">
      <span>🔬 總掃描</span><strong>${users.reduce((s, u) => s + (u.total_used ?? 0), 0)}</strong>
    </div>`;
  }

  if (!users?.length) { list.innerHTML = '<div class="empty-state">尚無用戶資料</div>'; return; }

  list.innerHTML = users.map(u => `
  <div class="admin-user-card">
    <div class="auc-top">
      <div>
        <div class="auc-name">${escapeHtml(u.name)}</div>
        <div class="auc-email">${escapeHtml(u.email ?? u.phone ?? '')}</div>
      </div>
      <div class="auc-code">${u.member_code ?? '—'}</div>
    </div>
    <div class="auc-bottom">
      <div class="auc-stat"><span>掃描</span><strong>${u.total_used ?? 0}</strong></div>
      <div class="auc-credits-row">
        <span class="auc-stat-label">次數</span>
        <input class="admin-edit-input" id="cr-${u.id}" type="number" value="${u.credits ?? 0}" min="0">
        <button class="btn-save-credits" onclick="saveCredits('${u.id}')">儲存</button>
      </div>
    </div>
  </div>`).join('');
}

async function saveCredits(userId) {
  const input = document.getElementById(`cr-${userId}`);
  if (!input) return;
  const val = parseInt(input.value);
  if (isNaN(val) || val < 0) { showToast('請輸入有效次數'); return; }

  // 走 RPC：前端已無權直接改 sb_users.credits，且後台調整要留在積點總帳裡
  const { data, error } = await supabase.rpc('rpc_admin_set_balance', {
    p_target_user_id: userId,
    p_credits: val,
  });
  if (error || !data?.ok) { showToast('儲存失敗'); return; }
  showToast('✅ 次數已更新');
}

async function updateCode(type) {
  const inputId  = type === 1 ? 'admin-code1-input' : 'admin-code10-input';
  const resultId = type === 1 ? 'admin-code1-result' : 'admin-code10-result';
  const input    = document.getElementById(inputId);
  const result   = document.getElementById(resultId);

  const code = input?.value.trim();
  if (!code || !/^\d{7}$/.test(code)) {
    result.textContent = '請輸入 7 位數字'; result.style.color = 'var(--alert-color)'; return;
  }

  const existingId = input?.dataset.id;
  let error;

  if (existingId) {
    // 更新現有未使用的 code
    ({ error } = await supabase.from('sb_health_codes').update({ code }).eq('id', existingId));
  } else {
    // 新增一筆
    ({ error } = await supabase.from('sb_health_codes').insert({ code, credits: type }));
  }

  if (error) { result.textContent = '更新失敗'; result.style.color = 'var(--alert-color)'; return; }
  result.textContent = '✓ 已更新'; result.style.color = 'var(--ok-color)';
  setTimeout(() => { result.textContent = ''; }, 3000);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
