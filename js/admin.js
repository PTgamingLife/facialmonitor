/* ── 管理後台 ── */

async function loadAdminUsers() {
  const list = document.getElementById('admin-user-list');
  if (!list) return;
  loadAdminTips('draft');

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

async function loadAdminTips(status = 'draft') {
  const list = document.getElementById('admin-tip-list');
  if (!list) return;
  list.innerHTML = '<div class="empty-state">載入中…</div>';
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  const { data: tips, error } = await supabase
    .from('sb_daily_tips')
    .select('id,tip_date,title,summary,body,detail_points,source_urls,risk_flags,status,content_version,approved_at,review_note')
    .eq('status', status)
    .gte('tip_date', status === 'draft' ? today : '2000-01-01')
    .order('tip_date', { ascending: true })
    .limit(60);
  if (error) { list.innerHTML = `<div class="empty-state">載入失敗：${escapeHtml(error.message)}</div>`; return; }
  if (!tips?.length) { list.innerHTML = '<div class="empty-state">目前沒有這個狀態的內容</div>'; return; }

  list.innerHTML = tips.map(t => {
    const points = Array.isArray(t.detail_points) ? t.detail_points : [];
    const flags = Array.isArray(t.risk_flags) ? t.risk_flags : [];
    const sources = Array.isArray(t.source_urls) ? t.source_urls : [];
    return `<article class="admin-tip-card">
      <div class="admin-tip-head"><strong>${escapeHtml(t.tip_date)}｜${escapeHtml(t.title)}</strong><span>v${t.content_version}</span></div>
      ${flags.length ? `<div class="admin-tip-warning">⚠️ 風險詞：${escapeHtml(flags.join('、'))}</div>` : ''}
      <div class="admin-tip-summary">${escapeHtml(t.summary ?? '')}</div>
      <details><summary>查看完整內容</summary>
        <div class="admin-tip-body">${escapeHtml(t.body)}</div>
        <ol>${points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ol>
        <div class="admin-tip-sources">來源：${sources.map(u => `<a href="${safeHttpUrl(u)}" target="_blank" rel="noopener">${escapeHtml(new URL(safeHttpUrl(u)).hostname)}</a>`).join('、')}</div>
      </details>
      ${status === 'draft' ? `<div class="admin-tip-actions">
        <button class="btn-update-code" onclick="reviewTip('${t.id}','approve',${flags.length > 0})">通過</button>
        <button class="btn-outline" onclick="reviewTip('${t.id}','reject')">退回</button>
      </div>` : `<div class="admin-tip-review-note">${escapeHtml(t.review_note ?? '')}</div>`}
    </article>`;
  }).join('');
}

function safeHttpUrl(value) {
  try {
    const u = new URL(String(value));
    return ['https:', 'http:'].includes(u.protocol) ? u.href : 'about:blank';
  } catch (_) { return 'about:blank'; }
}

async function reviewTip(tipId, decision, hasRiskFlags = false) {
  if (decision === 'approve' && hasRiskFlags && !confirm('這篇含有風險字詞。確認已人工核對內容與來源，仍要通過嗎？')) return;
  const note = decision === 'reject' ? (prompt('退回原因（會留在審核紀錄）') ?? '') : '';
  if (decision === 'reject' && !note.trim()) return;
  const { data, error } = await supabase.rpc('rpc_admin_review_tip', {
    p_tip_id: tipId, p_decision: decision, p_note: note || null
  });
  if (error || !data?.ok) { showToast('審核失敗'); return; }
  showToast(decision === 'approve' ? '✅ 已通過' : '已退回');
  await loadAdminTips('draft');
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
