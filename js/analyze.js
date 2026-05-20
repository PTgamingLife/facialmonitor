// ── Image Upload ─────────────────────────────────────────
function handleUpload(e, type) {
  const file = e.target.files[0];
  if (!file) return;
  compressImage(file, 800, 0.75).then(result => {
    if (type === 'face') {
      sb_faceData = result;
      const zone = document.getElementById('face-zone');
      zone.classList.add('has-img');
      zone.innerHTML = `<img src="${result.dataURL}" class="preview-img"><button class="change-btn" onclick="event.stopPropagation();document.getElementById('face-input').click()">重新上傳</button>`;
      zone.onclick = null;
      document.getElementById('btn-step1').style.display = 'block';
    } else {
      sb_tongueData = result;
      const zone = document.getElementById('tongue-zone');
      zone.classList.add('has-img');
      zone.innerHTML = `<img src="${result.dataURL}" class="preview-img"><button class="change-btn" onclick="event.stopPropagation();document.getElementById('tongue-input').click()">重新上傳</button>`;
      zone.onclick = null;
      document.getElementById('btn-step2').style.display = 'block';
    }
    e.target.value = '';
  });
}

function compressImage(file, maxWidth, quality) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataURL = canvas.toDataURL('image/jpeg', quality);
        res({ dataURL, base64: dataURL.split(',')[1], type: 'image/jpeg' });
      };
      img.onerror = () => rej(new Error('圖片載入失敗'));
      img.src = e.target.result;
    };
    reader.onerror = () => rej(new Error('讀取失敗'));
    reader.readAsDataURL(file);
  });
}

// Bind upload inputs
document.getElementById('face-input').addEventListener('change', e => handleUpload(e, 'face'));
document.getElementById('tongue-input').addEventListener('change', e => handleUpload(e, 'tongue'));

// ── Step Navigation ──────────────────────────────────────
function goStep(n) {
  [1,2,3].forEach(i => {
    document.getElementById(`step-${i}`).style.display = i === n ? 'block' : 'none';
  });
  document.getElementById('step-loading').style.display = 'none';

  [1,2,3].forEach(i => {
    const dot = document.getElementById(`sdot-${i}`);
    dot.className = 'step-dot';
    if (i < n) { dot.classList.add('done'); dot.textContent = '✓'; }
    else if (i === n) { dot.classList.add('active'); dot.textContent = i; }
    else { dot.textContent = i; }
  });
  [1,2].forEach(i => {
    document.getElementById(`sline-${i}`).className = 'step-line' + (i < n ? ' done' : '');
  });

  if (n === 3 && sb_faceData && sb_tongueData) {
    document.getElementById('face-thumb').src = sb_faceData.dataURL;
    document.getElementById('tongue-thumb').src = sb_tongueData.dataURL;
  }
}

// ── Carousel (Loading) ───────────────────────────────────
function startCarousel() {
  // Simple text cycling - no images needed
}

function stopCarousel() {
  if (sb_carouselTimer) { clearInterval(sb_carouselTimer); sb_carouselTimer = null; }
}

// ── Analyze ──────────────────────────────────────────────
async function startAnalyze() {
  if (!sb_faceData || !sb_tongueData) return;
  const errEl = document.getElementById('analyze-error');
  errEl.style.display = 'none';

  document.getElementById('step-3').style.display = 'none';
  document.getElementById('step-loading').style.display = 'block';

  try {
    if ((sb_currentUser.credits || 0) <= 0) {
      throw new Error('剩餘次數不足，請點擊右上角添加健康密碼');
    }

    const res = await fetch(EDGE_FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({
        faceBase64: sb_faceData.base64,
        faceType: sb_faceData.type,
        tongueBase64: sb_tongueData.base64,
        tongueType: sb_tongueData.type,
      })
    });

    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'API 錯誤');

    sb_currentReport = json.report;

    // Deduct credit
    const newCredits = Math.max(0, (sb_currentUser.credits || 1) - 1);
    const newUsed = (sb_currentUser.total_used || 0) + 1;
    await sb.from('sb_users').update({ credits: newCredits, total_used: newUsed }).eq('id', sb_currentUser.id);
    sb_currentUser.credits = newCredits;
    sb_currentUser.total_used = newUsed;

    // Save record
    await sb.from('sb_analysis_records').insert({
      user_id: sb_currentUser.id,
      user_name: sb_currentUser.name,
      user_phone: sb_currentUser.phone,
      report: sb_currentReport,
    });

    stopCarousel();
    renderReport(sb_currentReport);
    showPage('page-report');

  } catch (err) {
    document.getElementById('step-loading').style.display = 'none';
    document.getElementById('step-3').style.display = 'block';
    errEl.textContent = '分析失敗：' + err.message;
    errEl.style.display = 'block';
    stopCarousel();
  }
}
