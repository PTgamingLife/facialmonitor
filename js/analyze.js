/* ── 步驟控制 ── */
let currentStep = 1;

function resetToStep1() {
  faceFile   = null;
  tongueFile = null;
  currentStep = 1;
  renderStep(1);
  updateStepBar(1);

  // 重設上傳區
  const fz = document.getElementById('face-zone');
  const tz = document.getElementById('tongue-zone');
  if (fz) resetUploadZone(fz, '📷', '點擊上傳臉部照片', '卸妝、均勻光線效果最佳');
  if (tz) resetUploadZone(tz, '👅', '點擊上傳舌頭照片', '建議早晨空腹，自然光下拍攝');

  document.getElementById('btn-step1').style.display = 'none';
  document.getElementById('btn-step2').style.display = 'none';
  document.getElementById('analyze-error').style.display = 'none';
}

function renderStep(n) {
  [1,2,3,'loading'].forEach(s => {
    const el = document.getElementById(`step-${s}`);
    if (el) el.style.display = (s === n) ? 'block' : 'none';
  });
}

function updateStepBar(n) {
  [1,2,3].forEach(i => {
    const dot  = document.getElementById(`sdot-${i}`);
    const line = document.getElementById(`sline-${i}`);
    if (dot)  { dot.classList.toggle('active', i === n); dot.classList.toggle('done', i < n); }
    if (line) { line.classList.toggle('done', i < n); }
  });
}

function goStep(n) {
  currentStep = n;
  renderStep(n);
  updateStepBar(n);
  window.scrollTo(0,0);
}

/* ── 上傳區 Helper ── */
function resetUploadZone(zone, icon, text, hint) {
  zone.classList.remove('has-img');
  zone.innerHTML = `
    <div class="upload-ring-anim"></div>
    <span class="upload-icon">${icon}</span>
    <div class="upload-text">${text}</div>
    <div class="upload-hint">${hint}</div>`;
}

function showPreview(zone, dataUrl, label) {
  zone.classList.add('has-img');
  zone.innerHTML = `
    <img class="preview-img" src="${dataUrl}" alt="${label}">
    <button class="change-btn" onclick="event.stopPropagation()">更換</button>`;
}

/* ── 初始化上傳 ── */
function initUploads() {
  const faceInput   = document.getElementById('face-input');
  const tongueInput = document.getElementById('tongue-input');
  const faceZone    = document.getElementById('face-zone');
  const tongueZone  = document.getElementById('tongue-zone');

  faceZone.addEventListener('click', () => faceInput.click());
  faceInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    faceFile = file;
    const b64 = await fileToBase64(file);
    showPreview(faceZone, b64, '面部');
    document.getElementById('btn-step1').style.display = 'block';
    // 更新確認頁縮圖
    const th = document.getElementById('face-thumb');
    if (th) th.src = b64;
  });

  tongueZone.addEventListener('click', () => tongueInput.click());
  tongueInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    tongueFile = file;
    const b64 = await fileToBase64(file);
    showPreview(tongueZone, b64, '舌部');
    document.getElementById('btn-step2').style.display = 'block';
    const th = document.getElementById('tongue-thumb');
    if (th) th.src = b64;
  });
}

/* ── 圖片轉 Base64 Helper ── */
function fileToBase64JPEG(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX = 800;
        let w = img.width, h = img.height;
        if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = c.toDataURL('image/jpeg', 0.75);
        resolve({ base64: dataUrl.split(',')[1], type: 'image/jpeg' });
      };
      img.onerror = () => reject(new Error('圖片載入失敗'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('讀取失敗'));
    reader.readAsDataURL(file);
  });
}

/* ── 開始分析 ── */
async function startAnalyze() {
  if (!faceFile || !tongueFile) {
    document.getElementById('analyze-error').textContent = '請確認兩張照片都已上傳';
    document.getElementById('analyze-error').style.display = 'block';
    return;
  }
  if (!currentUser || currentUser.credits <= 0) {
    document.getElementById('analyze-error').textContent = '剩餘次數不足，請添加健康密碼';
    document.getElementById('analyze-error').style.display = 'block';
    return;
  }

  renderStep('loading');
  startCarousel();

  try {
    // 轉 base64
    const [faceData, tongueData] = await Promise.all([
      fileToBase64JPEG(faceFile),
      fileToBase64JPEG(tongueFile),
    ]);

    // 呼叫 Edge Function（原始 fetch 方式，ANON key 作 Bearer）
    // 同時傳入 userId/userName/userPhone，由 server 端儲存紀錄避免 client 大 payload 問題
    const res = await fetch(window.EDGE_FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${window.SUPABASE_ANON}`,
      },
      body: JSON.stringify({
        faceBase64:   faceData.base64,
        faceType:     faceData.type,
        tongueBase64: tongueData.base64,
        tongueType:   tongueData.type,
        userId:       window._demoMode ? null : currentUser.id,
        userName:     currentUser.name,
        userPhone:    currentUser.phone || '',
      })
    });

    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'API 錯誤');

    currentReport = json.report;

    // 扣除次數 & 更新 total_used。
    // 一定要走 RPC：前端已無權直接改 sb_users.credits / total_used，
    // 而且扣次數與計數必須在同一個 transaction 完成。
    const { data: consumed } = await supabase.rpc('rpc_consume_credit');
    const newCredits = consumed?.ok ? consumed.credits    : Math.max(0, (currentUser.credits || 1) - 1);
    const newUsed    = consumed?.ok ? consumed.total_used : (currentUser.total_used || 0) + 1;
    currentUser.credits    = newCredits;
    currentUser.total_used = newUsed;
    currentUser.total_scans = newUsed;
    sessionStorage.setItem('hq_user', JSON.stringify(currentUser));

    // 紀錄已由 Edge Function server 端儲存（json.saved）
    if (window._demoMode) {
      // Demo 模式：另存 sessionStorage 模擬紀錄
      const demoRecs = JSON.parse(sessionStorage.getItem('hq_demo_records') || '[]');
      demoRecs.unshift({ id: Date.now().toString(), user_id: 'demo', report: currentReport, created_at: new Date().toISOString() });
      sessionStorage.setItem('hq_demo_records', JSON.stringify(demoRecs.slice(0, 20)));
    }

    stopCarousel();
    renderReport(currentReport);
    showPage('page-report');

    // 首檢送的免費抽獎券是資料庫 trigger 在存紀錄時發的，前端這裡才問得到。
    // 不主動跳出來的話，使用者根本不會知道有這張券。
    if (typeof maybeOfferFreeSpin === 'function') maybeOfferFreeSpin();

  } catch (e) {
    stopCarousel();
    renderStep(3);
    document.getElementById('analyze-error').textContent = '分析失敗：' + (e.message || '請稍後再試');
    document.getElementById('analyze-error').style.display = 'block';
  }
}

/* ── 輪播 Helper ── */
let carouselTimer = null;
let carouselIdx   = 0;

const CAROUSEL_TIPS = [
  '早餐前喝一杯溫開水，有助腸胃蠕動 🌿',
  '規律睡眠是最好的養生法 🌙',
  '多曬太陽，補充天然維生素 D ☀️',
  '飯後散步15分鐘，促進氣血循環 🚶',
  '深呼吸10次，舒緩壓力穩定心神 🧘',
  '多吃五色蔬果，均衡五臟六腑 🥦',
];

function startCarousel() {
  const track = document.getElementById('carousel-track');
  const dots  = document.getElementById('carousel-dots');
  if (!track) return;
  track.innerHTML = CAROUSEL_TIPS.map(t => `<div class="carousel-slide">${t}</div>`).join('');
  dots.innerHTML  = CAROUSEL_TIPS.map((_,i) => `<div class="carousel-dot${i===0?' active':''}"></div>`).join('');
  carouselIdx = 0;

  carouselTimer = setInterval(() => {
    carouselIdx = (carouselIdx + 1) % CAROUSEL_TIPS.length;
    track.style.transform = `translateX(-${carouselIdx * 100}%)`;
    dots.querySelectorAll('.carousel-dot').forEach((d,i) => d.classList.toggle('active', i === carouselIdx));
  }, 3500);
}

function stopCarousel() { clearInterval(carouselTimer); }

function updateCreditsDisplay() {
  const el = document.getElementById('credits-display');
  if (el) {
    el.textContent = currentUser?.credits ?? '-';
    el.className   = 'credits-num' + ((currentUser?.credits ?? 1) <= 0 ? ' credits-zero' : '');
  }
  const memberCodeEl = document.getElementById('member-code-display');
  if (memberCodeEl) memberCodeEl.textContent = currentUser?.member_code ?? '-------';
}

/* ── 重新診斷 ── */
function restartDiagnosis() {
  showPage('page-challenge');
}
