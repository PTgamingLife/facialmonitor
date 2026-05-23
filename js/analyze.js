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

/* ── 開始分析 ── */
async function startAnalyze() {
  if (!faceFile || !tongueFile) {
    document.getElementById('analyze-error').textContent = '請確認兩張照片都已上傳';
    document.getElementById('analyze-error').style.display = 'block';
    return;
  }
  if (!currentUser || currentUser.credits <= 0) {
    document.getElementById('analyze-error').textContent = '剩餘次數不足，請添加健康密碼或購買方案';
    document.getElementById('analyze-error').style.display = 'block';
    return;
  }

  renderStep('loading');
  startCarousel();

  try {
    // 扣除次數
    await supabase.from('users').update({ credits: currentUser.credits - 1 }).eq('id', currentUser.id);
    currentUser.credits--;
    sessionStorage.setItem('hq_user', JSON.stringify(currentUser));

    // 上傳圖片
    const ts   = Date.now();
    const uid  = currentUser.id;
    const facePath   = `${uid}/face_${ts}.jpg`;
    const tonguePath = `${uid}/tongue_${ts}.jpg`;

    await Promise.all([
      supabase.storage.from('uploads').upload(facePath,   faceFile,   { upsert:true }),
      supabase.storage.from('uploads').upload(tonguePath, tongueFile, { upsert:true }),
    ]);

    const { data: { publicUrl: faceUrl   } } = supabase.storage.from('uploads').getPublicUrl(facePath);
    const { data: { publicUrl: tongueUrl } } = supabase.storage.from('uploads').getPublicUrl(tonguePath);

    // 呼叫 Edge Function
    const { data, error } = await supabase.functions.invoke('analyze', {
      body: { faceUrl, tongueUrl, userName: currentUser.name, userId: uid }
    });
    if (error) throw error;

    currentReport = typeof data === 'string' ? JSON.parse(data) : data;

    // 存入資料庫
    await supabase.from('analyses').insert({
      user_id:    uid,
      face_url:   faceUrl,
      tongue_url: tongueUrl,
      result:     currentReport,
    });

    // 更新 totalScans + coins
    const newScans = (currentUser.total_scans || 0) + 1;
    const newCoins = Math.min((currentUser.coins || 0) + 5, 100);
    await supabase.from('users').update({ total_scans: newScans, coins: newCoins }).eq('id', uid);
    currentUser.total_scans = newScans;
    currentUser.coins = newCoins;
    sessionStorage.setItem('hq_user', JSON.stringify(currentUser));

    stopCarousel();
    renderReport(currentReport);
    showPage('page-report');
  } catch (e) {
    stopCarousel();
    renderStep(3);
    document.getElementById('analyze-error').textContent = '分析失敗：' + (e.message || '請稍後再試');
    document.getElementById('analyze-error').style.display = 'block';
    // 退還次數
    currentUser.credits++;
    await supabase.from('users').update({ credits: currentUser.credits }).eq('id', currentUser.id);
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
