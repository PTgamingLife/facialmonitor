/* ── 管理後台 ── */

async function loadAdminUsers() {
  const list = document.getElementById('admin-user-list');
  if (!list) return;
  loadAdminTips('scheduled');
  loadAdminBlessings('visible');
  loadPrizeClaims('pending');

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

/**
 * 每日挑戰行事曆。
 *
 * v2 沒有待審佇列:通過自動檢查的內容直接排程,管理者靠 LINE 提醒進來,
 * 進來也只做兩件事 —— 看被擋下的那幾天、或把某一天撤下。
 *
 * scheduled = 未來 14 天已排定的;blocked = 被自動檢查擋下、目前沒有內容的。
 */
async function loadAdminTips(view = 'scheduled') {
  const list = document.getElementById('admin-tip-list');
  if (!list) return;
  list.innerHTML = '<div class="empty-state">載入中…</div>';

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  let q = supabase
    .from('sb_daily_tips')
    .select('id,tip_date,kind,title,summary,body,intros,game_titles,action_today,'
          + 'source_name,source_urls,risk_flags,status,active,content_version,quiz_question,'
          + 'quiz_options,quiz_answer,quiz_explain')
    .gte('tip_date', today)
    .order('tip_date', { ascending: true })
    .limit(30);
  q = view === 'blocked'
    ? q.eq('status', 'draft')
    : q.eq('status', 'approved').eq('active', true);

  const { data: tips, error } = await q;
  if (error) { list.innerHTML = `<div class="empty-state">載入失敗：${escapeHtml(error.message)}</div>`; return; }

  renderTipStock(view === 'scheduled' ? (tips?.length ?? 0) : null);

  if (!tips?.length) {
    list.innerHTML = view === 'blocked'
      ? '<div class="empty-state">沒有被擋下的內容。</div>'
      : '<div class="empty-state">未來 14 天沒有排定的內容。存量歸零時會改用長青備用題。</div>';
    return;
  }

  const TONE = { zhou: '周小輪', kang: '康小泳', xs: '小XS' };

  list.innerHTML = tips.map(t => {
    const flags   = Array.isArray(t.risk_flags) ? t.risk_flags : [];
    const sources = Array.isArray(t.source_urls) ? t.source_urls : [];
    const intros  = t.intros ?? {};
    const titles  = t.game_titles ?? {};
    const options = Array.isArray(t.quiz_options) ? t.quiz_options : [];
    const isBless = t.kind === 'blessing';

    return `<article class="admin-tip-card">
      <div class="admin-tip-head">
        <strong>${escapeHtml(t.tip_date)}｜${isBless ? '💚 祝福關卡' : '🌿 知識題'}</strong>
        <span>v${t.content_version}</span>
      </div>
      ${flags.length
        ? `<div class="admin-tip-warning">⚠️ 被擋下：${escapeHtml(flags.join('、'))}<br>這一天目前沒有內容。</div>`
        : ''}
      <div class="admin-tip-summary"><strong>${escapeHtml(t.title ?? '')}</strong></div>
      <details><summary>開場白與完整內容</summary>
        <ul class="admin-tip-intros">
          ${Object.keys(TONE).map(k => `<li><b>${TONE[k]}</b>：${escapeHtml(intros[k] ?? '（缺）')}
            <span class="admin-tip-gametitle">${escapeHtml(titles[k] ?? '')}</span></li>`).join('')}
        </ul>
        <div class="admin-tip-body">${escapeHtml(t.body ?? '')}</div>
        ${isBless ? '' : `<div class="admin-tip-body">
          <b>${escapeHtml(t.quiz_question ?? '')}</b>
          <ol>${options.map((o, i) =>
            `<li${i === t.quiz_answer ? ' class="admin-tip-answer"' : ''}>${escapeHtml(o)}</li>`).join('')}</ol>
          ${escapeHtml(t.quiz_explain ?? '')}
        </div>`}
        ${t.action_today ? `<div class="admin-tip-body">今天可以做的一件事：${escapeHtml(t.action_today)}</div>` : ''}
        <div class="admin-tip-sources">來源：${escapeHtml(t.source_name ?? '')}
          ${sources.map(u => `<a href="${safeHttpUrl(u)}" target="_blank" rel="noopener">連結</a>`).join('、')}</div>
      </details>
      ${t.status === 'approved' ? `<div class="admin-tip-actions">
        <button class="btn-outline" onclick="withdrawTip('${t.id}')">撤下這一天</button>
      </div>` : ''}
    </article>`;
  }).join('');
}

/** 存量提示。≤ 4 天就是 LINE 會開始每天提醒的那條線。 */
function renderTipStock(days) {
  const box = document.getElementById('admin-tip-stock');
  if (!box) return;
  if (days === null || days > 4) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.innerHTML = days === 0
    ? '⚠️ 未來 14 天完全沒有內容。今天起會改用長青備用題。'
    : `⚠️ 只剩 ${days} 天有內容。存量 4 天以內每天都會推 LINE 提醒。`;
}

/** 撤下某一天。用 active = false,不刪除 —— 留著才看得出這天為什麼沒內容。 */
async function withdrawTip(tipId) {
  if (!confirm('把這一天撤下來？撤下之後那天就沒有內容，會改用長青備用題。')) return;
  const { data, error } = await supabase.rpc('rpc_admin_withdraw_tip', { p_id: tipId });
  if (error || !data?.ok) { showToast(data?.message ?? '撤下失敗'); return; }
  showToast('已撤下');
  await loadAdminTips('scheduled');
}

/**
 * 祝福管理。
 *
 * 自動檢查擋得住療效宣稱、網址與聯絡方式,擋不住的還是要有人看 ——
 * 這是使用者寫的內容,v2 唯一保留人工的地方。
 */
async function loadAdminBlessings(status = 'visible') {
  const list = document.getElementById('admin-blessing-list');
  if (!list) return;
  list.innerHTML = '<div class="empty-state">載入中…</div>';

  const { data, error } = await supabase.rpc('rpc_admin_list_blessings', {
    p_status: status, p_limit: 50,
  });
  if (error) { list.innerHTML = `<div class="empty-state">載入失敗：${escapeHtml(error.message)}</div>`; return; }
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) { list.innerHTML = '<div class="empty-state">這個狀態目前沒有祝福。</div>'; return; }

  list.innerHTML = rows.map(b => `<article class="admin-tip-card">
    <div class="admin-tip-head">
      <strong>${escapeHtml(b.author_name)}</strong>
      <span>${escapeHtml(b.blessed_date)}${b.is_public ? '' : '｜未公開'}</span>
    </div>
    <div class="admin-tip-summary">${escapeHtml(b.text)}</div>
    ${status === 'visible' ? `<div class="admin-tip-actions">
      <button class="btn-outline" onclick="blockBlessing('${b.id}')">下架</button>
    </div>` : ''}
  </article>`).join('');
}

async function blockBlessing(id) {
  const reason = prompt('下架原因（會留在紀錄裡，可留空）') ?? '';
  const { data, error } = await supabase.rpc('rpc_admin_block_blessing', {
    p_id: id, p_reason: reason || null,
  });
  if (error || !data?.ok) { showToast(data?.message ?? '下架失敗'); return; }
  showToast('已下架');
  await loadAdminBlessings('visible');
}

function safeHttpUrl(value) {
  try {
    const u = new URL(String(value));
    return ['https:', 'http:'].includes(u.protocol) ? u.href : 'about:blank';
  } catch (_) { return 'about:blank'; }
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

/* ── 領獎管理 ───────────────────────────────────────────────
   名單裡有其他會員的姓名與電話,查詢與確認都走擋了 is_admin_caller()
   的 RPC —— 前端這一層只是畫面,不是權限。 */
let _prizeFilter = 'pending';

async function loadPrizeClaims(status = 'pending') {
  _prizeFilter = status;
  const box = document.getElementById('admin-prize-list');
  if (!box) return;
  box.innerHTML = '<div class="empty-state">載入中…</div>';

  const { data, error } = await supabase.rpc('rpc_admin_prize_claims', { p_status: status });
  if (error || !data?.ok) {
    box.innerHTML = `<div class="empty-state">${escapeHtml(data?.message ?? '讀取失敗')}</div>`;
    return;
  }

  const rows = data.rows ?? [];
  if (!rows.length) {
    box.innerHTML = `<div class="empty-state">${status === 'pending' ? '目前沒有待領取的獎品' : '沒有紀錄'}</div>`;
    return;
  }

  box.innerHTML = rows.map(r => {
    const when = new Date(r.drawn_at).toLocaleString('zh-TW',
      { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const pending = r.status === 'pending';
    return `
      <div class="admin-row" data-draw="${r.draw_id}">
        <div>
          <div style="font-weight:700">${escapeHtml(r.prize_name)}</div>
          <div style="font-size:12px;color:var(--text-soft)">
            ${escapeHtml(r.user_name || '（未填姓名）')}
            ${r.member_code ? '· ' + escapeHtml(r.member_code) : ''}
            ${r.phone ? '· ' + escapeHtml(r.phone) : ''}
          </div>
          <div style="font-size:11px;color:var(--text-soft)">
            ${when} 抽中${r.has_line ? '' : '　⚠️ 未綁定 LINE，無法通知'}
          </div>
        </div>
        ${pending
          ? `<button class="btn-update-code" onclick="confirmClaim('${r.draw_id}', this)">確認領取</button>`
          : '<span style="font-size:12px;color:var(--ok-color)">✓ 已領取</span>'}
      </div>`;
  }).join('');
}

/* 確認領取 = 標記 + 推 LINE 通知。兩件事一起做才不會出現
   「後台顯示已領、當事人完全不知道」。走 Edge Function 是因為推播需要
   channel token,那把鑰匙不能放進瀏覽器。 */
async function confirmClaim(drawId, btn) {
  if (!confirm('確認這份獎品已經交給對方？\n確認後會發送一則 LINE 訊息通知本人。')) return;

  btn.disabled = true;
  btn.textContent = '處理中…';

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(window.SUPABASE_URL + '/functions/v1/prize-claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token ?? ''}`,
        'apikey': window.SUPABASE_ANON,
      },
      body: JSON.stringify({ draw_id: drawId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.message ?? '確認失敗');

    showToast('✅ ' + body.message);
    loadPrizeClaims(_prizeFilter);
  } catch (e) {
    showToast('⚠️ ' + (e.message || '確認失敗'));
    btn.disabled = false;
    btn.textContent = '確認領取';
  }
}
