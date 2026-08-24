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

  // 走 RPC 而不是直接查 sb_lottery_prizes：一次拿到獎項、剩餘免費券與單抽點數，
  // 前端不必自己算「夠不夠抽」，也不用為了看券數再開一條讀表的路。
  const lot = (await supabase.rpc('rpc_my_lottery_status')).data ?? {};
  const prizes = lot.prizes ?? [];
  const freeTickets = lot.free_tickets ?? 0;

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
    <div class="card-title">我的小天使</div>
    ${s.angel
      ? `<div class="hist-type">${escapeHtml(s.angel.name ?? '')}</div>`
      : `<div class="hint-text">還沒填。輸入介紹你來的人的 7 位推薦碼，你會得 ${rates.bind_angel ?? 10} 點。</div>
         <input class="admin-edit-input" id="angel-code" type="text" inputmode="numeric"
                maxlength="7" placeholder="7 位推薦碼" style="width:100%;margin:8px 0">
         <button class="btn-main" onclick="submitAngel()">送出</button>
         <div class="modal-result" id="angel-result"></div>`}
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
        + (freeTickets > 0
            ? `<div class="hint-text" style="margin:10px 0;color:var(--ok-color)">
                 🎟️ 你有 ${freeTickets} 次免費抽獎機會</div>
               <button class="btn-main" onclick="openLotteryWheel()">免費抽一次</button>`
            : `<button class="btn-main" onclick="openLotteryWheel()"
                 ${(s.points ?? 0) < (rates.lottery_draw ?? 30) ? 'disabled' : ''}>
                 馬上抽（${rates.lottery_draw ?? 30} 點）</button>`)}
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

async function submitAngel() {
  const input = document.getElementById('angel-code');
  const res   = document.getElementById('angel-result');
  const code  = (input?.value ?? '').trim();

  if (!/^\d{7}$/.test(code)) {
    res.textContent = '請輸入 7 位數字'; res.className = 'modal-result err'; return;
  }
  res.textContent = '處理中…'; res.className = 'modal-result';

  const { data, error } = await supabase.rpc('rpc_bind_angel', { p_code: code, p_source: 'web' });
  if (error || !data?.ok) {
    res.textContent = data?.message ?? '設定失敗，請稍後再試';
    res.className = 'modal-result err';
    return;
  }
  showToast(`✅ 已認定「${data.angel_name}」為小天使，+${data.points_awarded} 點`);
  loadReward();
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

/* ── 抽獎轉盤 ──
   中什麼獎完全由 rpc_draw_lottery 決定，轉盤只負責把伺服器給的結果轉到定位。
   動畫絕不能參與決定獎項 —— 否則等於把中獎邏輯交給使用者的瀏覽器。 */

const WHEEL_COLORS = ['#0D5C63', '#22C1C3', '#4DA3E5', '#0A7C7C', '#5FD3D4', '#2E86AB'];
let _wheelPrizes = [];
let _wheelAngle  = 0;      // 累積角度，每次接著轉不回頭
let _wheelBusy   = false;

async function openLotteryWheel() {
  const { data: lot, error } = await supabase.rpc('rpc_my_lottery_status');
  if (error || !lot) { showToast('抽獎資料載入失敗'); return; }

  _wheelPrizes = lot.prizes ?? [];
  if (_wheelPrizes.length === 0) { showToast('獎品補貨中，晚點再來'); return; }

  const free = lot.free_tickets ?? 0;
  const cost = lot.cost ?? 30;
  const canSpin = free > 0 || (lot.points ?? 0) >= cost;

  let box = document.getElementById('lottery-wheel-modal');
  if (!box) {
    box = document.createElement('div');
    box.id = 'lottery-wheel-modal';
    box.className = 'modal-overlay';
    document.body.appendChild(box);
  }
  box.innerHTML = `
    <div class="modal-box" style="max-width:340px">
      <div class="modal-title">幸運抽獎</div>
      <div class="modal-sub" id="lw-sub">
        ${free > 0 ? `你有 ${free} 次免費機會` : `每抽 ${cost} 點`}
      </div>
      <div style="position:relative;width:260px;height:260px;margin:0 auto 16px">
        <canvas id="lw-canvas" width="520" height="520"
                style="width:260px;height:260px;transition:transform 4.2s cubic-bezier(.17,.67,.24,1)"></canvas>
        <div style="position:absolute;top:-6px;left:50%;transform:translateX(-50%);
                    width:0;height:0;border-left:12px solid transparent;
                    border-right:12px solid transparent;border-top:22px solid var(--gold-main);
                    filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))"></div>
      </div>
      <div class="modal-result" id="lw-result"></div>
      <button class="btn-main" id="lw-spin" onclick="spinWheel()" ${canSpin ? '' : 'disabled'}>
        ${free > 0 ? '免費抽一次' : `抽一次（${cost} 點）`}
      </button>
      <button class="btn-ghost" onclick="closeLotteryWheel()">關閉</button>
    </div>`;
  box.classList.add('show');
  _wheelAngle = 0;
  drawWheel();
}

function closeLotteryWheel() {
  if (_wheelBusy) return;                 // 轉到一半關掉會看不到結果
  document.getElementById('lottery-wheel-modal')?.classList.remove('show');
  loadReward();
}

function drawWheel() {
  const cv = document.getElementById('lw-canvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const n = _wheelPrizes.length, seg = (Math.PI * 2) / n;
  const cx = cv.width / 2, cy = cv.height / 2, r = cx - 8;

  ctx.clearRect(0, 0, cv.width, cv.height);
  _wheelPrizes.forEach((p, i) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, i * seg, (i + 1) * seg);
    ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(i * seg + seg / 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 26px "Noto Sans TC", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    // 名稱太長會疊到圓心，切掉比縮到看不清好
    const label = p.name.length > 8 ? p.name.slice(0, 7) + '…' : p.name;
    ctx.fillText(label, r - 20, 0);
    ctx.restore();
  });

  ctx.beginPath();
  ctx.arc(cx, cy, 42, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = '#0D5C63';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#0D5C63';
  ctx.font = 'bold 30px "Noto Serif TC", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('抽', cx, cy);
}

async function spinWheel() {
  if (_wheelBusy) return;
  _wheelBusy = true;
  const btn = document.getElementById('lw-spin');
  const res = document.getElementById('lw-result');
  if (btn) { btn.disabled = true; btn.textContent = '抽獎中…'; }
  if (res) { res.textContent = ''; res.className = 'modal-result'; }

  // 先問伺服器抽到什麼，再轉過去。順序不能反。
  const { data, error } = await supabase.rpc('rpc_draw_lottery');
  if (error || !data?.ok) {
    _wheelBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = '再抽一次'; }
    if (res) { res.textContent = data?.message ?? '抽獎失敗'; res.className = 'modal-result err'; }
    return;
  }

  const cv  = document.getElementById('lw-canvas');
  const idx = _wheelPrizes.findIndex((p) => p.name === data.prize_name);
  const n   = _wheelPrizes.length;

  if (cv && idx >= 0) {
    const segDeg = 360 / n;
    // 指針在正上方；canvas 0 度在三點鐘方向，所以目標是 270 度。
    // 落點在扇形內隨機偏移，避免每次都停在正中央、看起來像假的。
    const center = (idx + 0.5) * segDeg + (Math.random() - 0.5) * segDeg * 0.6;
    const delta  = (((270 - center) - (_wheelAngle % 360)) % 360 + 360) % 360;
    _wheelAngle += 360 * 5 + delta;
    cv.style.transform = `rotate(${_wheelAngle}deg)`;
  }

  window.setTimeout(() => {
    _wheelBusy = false;
    const won = data.prize_name !== '再接再厲';
    if (res) {
      res.textContent = won ? `🎉 抽中「${data.prize_name}」` : '再接再厲，下次一定中';
      res.className = won ? 'modal-result ok' : 'modal-result';
    }
    if (typeof data.balance === 'number' && currentUser) {
      currentUser.points = data.balance;
      sessionStorage.setItem('hq_user', JSON.stringify(currentUser));
    }
    const left = data.free_tickets ?? 0;
    const sub  = document.getElementById('lw-sub');
    if (sub) sub.textContent = left > 0 ? `還有 ${left} 次免費機會` : `每抽 ${data.points_spent || 30} 點`;
    if (btn) { btn.disabled = false; btn.textContent = left > 0 ? '免費再抽' : '再抽一次'; }
    if (won) showToast(`🎉 抽中「${data.prize_name}」，我們會與你聯繫`);
  }, cv && idx >= 0 ? 4300 : 0);   // 對齊 CSS transition 的 4.2s
}

/** 檢測完呼叫：有免費券就把轉盤推到使用者面前，不然他不會知道有這件事。 */
async function maybeOfferFreeSpin() {
  if (!currentUser || window._demoMode) return;
  const { data } = await supabase.rpc('rpc_my_lottery_status');
  if ((data?.free_tickets ?? 0) > 0) {
    showToast('🎁 首次檢測完成，送你一次免費抽獎！');
    window.setTimeout(openLotteryWheel, 1200);
  }
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
