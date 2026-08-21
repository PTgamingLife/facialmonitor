/* ── 推薦(小天使)與積點 ──
   所有加減點都走 RPC，前端只負責顯示與送出請求。
   同一批 RPC 也給 LINE bot 用，兩邊資料一定一致。 */

async function loadReward() {
  const box = document.getElementById('reward-body');
  if (!box || !currentUser) return;
  box.innerHTML = '<div class="empty-state">載入中…</div>';

  if (window._demoMode) {
    box.innerHTML = '<div class="empty-state">示範模式沒有積點資料<br>請用 Google 帳號登入後再試</div>';
    return;
  }

  const { data: s, error } = await supabase.rpc('rpc_my_reward_summary');
  if (error || !s) {
    box.innerHTML = '<div class="empty-state">載入失敗，請重新整理後再試</div>';
    return;
  }

  const rates = s.rates ?? {};
  const stats = s.invitee_stats ?? { total: 0, confirmed: 0 };

  const { data: prizes } = await supabase
    .from('sb_lottery_prizes')
    .select('id,name,description,image_url,stock')
    .eq('active', true).gt('stock', 0).order('sort');

  box.innerHTML = `
  <div class="card" style="text-align:center">
    <div class="hint-text">積點餘額</div>
    <div class="score-num" style="font-size:36px">${s.points ?? 0}</div>
    <div class="hint-text">${rates.redeem_credit ?? 100} 點換 1 次檢測 · ${rates.lottery_draw ?? 30} 點抽一次</div>
  </div>

  <div class="card">
    <div class="card-title">我的推薦碼</div>
    <div class="score-num" style="font-size:28px;letter-spacing:4px">${s.member_code ?? '—'}</div>
    <button class="btn-main" onclick="shareRefCode('${s.member_code ?? ''}')">複製分享訊息</button>
    <div class="hint-text" style="margin-top:8px">
      朋友完成第一次檢測，你得 ${rates.invite_confirmed ?? 30} 點；
      他當月分數進步 ${rates.threshold ?? 10} 分，你再得一次。
    </div>
  </div>

  <div class="card">
    <div class="card-title">14 天個人健康挑戰</div>
    <div class="hint-text">依最近一次健康檢測，一次排定 14 天內容並寫入後台；每天 08:20 由 LINE 提醒。</div>
    <button class="btn-main" onclick="applyHealthChallenge()">申請挑戰</button>
  </div>

  <div class="card">
    <div class="card-title">我推薦的人（${stats.confirmed} / ${stats.total}）</div>
    ${(s.invitees ?? []).length === 0
      ? '<div class="hint-text">還沒有人填你當小天使</div>'
      : (s.invitees ?? []).map(i => `
        <div class="hist-item" style="cursor:default">
          <div class="hist-top">
            <div class="hist-type">${escapeHtml(i.name ?? '會員')}</div>
            <div class="hist-date">${i.status === 'confirmed'
              ? (i.delta != null ? `本月 ${i.delta > 0 ? '+' : ''}${i.delta} 分` : '已完成首檢')
              : '尚未首檢'}</div>
          </div>
        </div>`).join('')}
  </div>

  <div class="card">
    <div class="card-title">兌換檢測次數</div>
    <div class="hint-text">${rates.redeem_credit ?? 100} 點 = 1 次，目前有 ${s.credits ?? 0} 次</div>
    <button class="btn-main" onclick="doRedeem(1)"
      ${(s.points ?? 0) < (rates.redeem_credit ?? 100) ? 'disabled' : ''}>兌換 1 次</button>
  </div>

  <div class="card">
    <div class="card-title">幸運抽獎</div>
    ${(prizes ?? []).length === 0
      ? '<div class="hint-text">獎品補貨中</div>'
      : (prizes ?? []).map(p => `
        <div class="hist-item" style="cursor:default">
          <div class="hist-top">
            <div class="hist-type">🎁 ${escapeHtml(p.name)}</div>
            <div class="hist-date">剩 ${p.stock}</div>
          </div>
          ${p.description ? `<div class="hist-desc">${escapeHtml(p.description)}</div>` : ''}
        </div>`).join('')
        + `<button class="btn-main" onclick="doDraw()"
             ${(s.points ?? 0) < (rates.lottery_draw ?? 30) ? 'disabled' : ''}>
             馬上抽（${rates.lottery_draw ?? 30} 點）</button>`}
  </div>

  <div class="card">
    <div class="card-title">積點明細</div>
    ${(s.recent_ledger ?? []).length === 0
      ? '<div class="hint-text">還沒有積點紀錄</div>'
      : (s.recent_ledger ?? []).map(l => `
        <div class="admin-stat-row">
          <span>${escapeHtml(l.note ?? l.reason ?? '')}</span>
          <strong style="color:${l.delta > 0 ? 'var(--ok-color)' : 'var(--text-mid)'}">
            ${l.delta > 0 ? '+' : ''}${l.delta}
          </strong>
        </div>`).join('')}
  </div>`;
}

async function applyHealthChallenge() {
  const { data, error } = await supabase.rpc('rpc_apply_health_challenge', { p_user_id: currentUser.id });
  if (error || !data?.ok) { showToast(data?.error === 'no_report' ? '請先完成一次健康檢測' : '申請失敗，請稍後再試'); return; }
  showToast(data.already_active ? '你已有進行中的挑戰' : `✅ 已排定，${data.starts_on} 開始`);
}

async function doRedeem(n) {
  if (!confirm(`確定要用積點兌換 ${n} 次檢測嗎？兌換後積點不退回。`)) return;

  const { data, error } = await supabase.rpc('rpc_redeem_credits', { p_count: n });
  if (error || !data?.ok) { showToast(data?.message ?? '兌換失敗'); return; }

  currentUser.credits = data.credits;
  currentUser.points  = data.balance;
  sessionStorage.setItem('hq_user', JSON.stringify(currentUser));
  updateCreditsDisplay();
  showToast(`✅ 已兌換 ${n} 次，目前共 ${data.credits} 次`);
  loadReward();
}

async function doDraw() {
  if (!confirm('確定要抽獎嗎？扣掉的積點不退回。')) return;

  const { data, error } = await supabase.rpc('rpc_draw_lottery');
  if (error || !data?.ok) { showToast(data?.message ?? '抽獎失敗'); return; }

  currentUser.points = data.balance;
  sessionStorage.setItem('hq_user', JSON.stringify(currentUser));
  showToast(`🎉 抽中「${data.prize_name}」，我們會與你聯繫`);
  loadReward();
}

function shareRefCode(code) {
  const referralUrl = `https://liff.line.me/${window.LIFF_ID}?p=page-main&ref=${encodeURIComponent(code)}`;
  const text = `我在用「大數據健康檢測」測體質、做 14 天養生任務，滿有感的 🌿\n\n`
    + `點我的專屬網址加入，登入後會自動綁定推薦人，並獲得 1 次免費檢測：\n`
    + `${referralUrl}\n\n推薦碼：${code}（備用）`;

  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
    return;
  }
  navigator.clipboard?.writeText(text)
    .then(() => showToast('✅ 分享訊息已複製'))
    .catch(() => showToast('複製失敗，請手動選取'));
}
