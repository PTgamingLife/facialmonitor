// ── WebView Detection ────────────────────────────────────
(function() {
  const ua = navigator.userAgent || '';
  const isWebView =
    // LINE
    ua.includes('Line/') ||
    // Facebook
    ua.includes('FBAN') || ua.includes('FBAV') ||
    // Instagram
    ua.includes('Instagram') ||
    // WeChat
    ua.includes('MicroMessenger') ||
    // Generic WebView markers
    (ua.includes('wv') && ua.includes('Android')) ||
    ua.includes('WebView') ||
    // iOS WebView (no Safari in UA but has AppleWebKit)
    (ua.includes('iPhone') && !ua.includes('Safari') && ua.includes('AppleWebKit'));

  if (isWebView) {
    const warning = document.getElementById('webview-warning');
    if (warning) {
      warning.style.display = 'flex';
      // Also disable Google login button
      const btn = document.querySelector('.btn-google-main');
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
      }
    }
  }
})();

function copyAppUrl() {
  const url = 'https://ptgaminglife.github.io/facialmonitor/';
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      document.getElementById('webview-copy-ok').style.display = 'block';
    });
  } else {
    // Fallback
    const el = document.createElement('textarea');
    el.value = url;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    document.getElementById('webview-copy-ok').style.display = 'block';
  }
}

// ── Utility ───────────────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function showErr(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}

function badgeHtml(status) {
  if (!status) return '';
  if (status.includes('正常')) return '<span class="badge badge-ok">正常</span>';
  if (status.includes('輕微')) return '<span class="badge badge-warn">輕微失調</span>';
  return '<span class="badge badge-alert">需注意</span>';
}

function openLine() {
  window.open('https://line.me/R/ti/p/@超艋健康', '_blank');
}

function downloadReport() {
  if (!sb_currentReport) return;
  const content = document.getElementById('report-content');
  html2canvas(content, {
    backgroundColor: '#F7F2EA',
    scale: 2,
    useCORS: true,
    logging: false,
    windowWidth: 480
  }).then(canvas => {
    const link = document.createElement('a');
    link.download = `健康報告_${new Date().toISOString().split('T')[0]}.png`;
    link.href = canvas.toDataURL('image/png', 0.9);
    link.click();
  });
}

function resetToStep1() {
  // Called after returning to main page - always reset to step 1
  [1,2,3].forEach(i => {
    const el = document.getElementById(`step-${i}`);
    if (el) el.style.display = i === 1 ? 'block' : 'none';
  });
  const loadingEl = document.getElementById('step-loading');
  if (loadingEl) loadingEl.style.display = 'none';
  if (typeof goStep === 'function') goStep(1);
}

function restartScan() {
  sb_faceData = null; sb_tongueData = null;
  // Reset upload zones
  const fz = document.getElementById('face-zone');
  fz.classList.remove('has-img');
  fz.innerHTML = `<div class="upload-zone-corners">
    <div class="uz-corner uz-tl"></div><div class="uz-corner uz-tr"></div>
    <div class="uz-corner uz-bl"></div><div class="uz-corner uz-br"></div>
  </div>
  <div class="upload-icon"><svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="50" cy="42" rx="28" ry="34" stroke="#C49A5A" stroke-width="2" fill="rgba(196,154,90,0.06)"/><ellipse cx="38" cy="36" rx="4.5" ry="5" stroke="#C49A5A" stroke-width="1.8"/><ellipse cx="62" cy="36" rx="4.5" ry="5" stroke="#C49A5A" stroke-width="1.8"/><circle cx="39" cy="37" r="2" fill="#C49A5A"/><circle cx="63" cy="37" r="2" fill="#C49A5A"/><path d="M50 42 L46 52 Q50 54 54 52 Z" stroke="#C49A5A" stroke-width="1.5" fill="none"/><path d="M38 60 Q50 68 62 60" stroke="#C49A5A" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M32 29 Q38 26 44 29" stroke="#C49A5A" stroke-width="1.5" stroke-linecap="round"/><path d="M56 29 Q62 26 68 29" stroke="#C49A5A" stroke-width="1.5" stroke-linecap="round"/><path d="M22 38 Q17 42 22 52" stroke="#C49A5A" stroke-width="1.5" fill="none"/><path d="M78 38 Q83 42 78 52" stroke="#C49A5A" stroke-width="1.5" fill="none"/></svg></div>
  <div class="upload-text">點擊上傳<br>臉部照片</div>`;
  fz.onclick = () => document.getElementById('face-input').click();
  document.getElementById('btn-step1').style.display = 'none';

  const tz = document.getElementById('tongue-zone');
  tz.classList.remove('has-img');
  tz.innerHTML = `<div class="upload-zone-corners">
    <div class="uz-corner uz-tl"></div><div class="uz-corner uz-tr"></div>
    <div class="uz-corner uz-bl"></div><div class="uz-corner uz-br"></div>
  </div>
  <div class="upload-icon"><svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 38 Q35 28 50 30 Q65 28 82 38 Q72 50 50 52 Q28 50 18 38Z" stroke="#C49A5A" stroke-width="2" fill="rgba(196,154,90,0.08)"/><path d="M28 41 Q50 44 72 41 L72 48 Q50 52 28 48 Z" fill="white" stroke="#C49A5A" stroke-width="1"/><line x1="40" y1="42" x2="40" y2="50" stroke="#C49A5A" stroke-width="0.8" opacity="0.5"/><line x1="50" y1="42" x2="50" y2="51" stroke="#C49A5A" stroke-width="0.8" opacity="0.5"/><line x1="60" y1="42" x2="60" y2="50" stroke="#C49A5A" stroke-width="0.8" opacity="0.5"/><path d="M35 50 Q35 58 50 72 Q65 58 65 50 Q58 52 50 52 Q42 52 35 50Z" fill="rgba(196,100,100,0.2)" stroke="#C49A5A" stroke-width="2"/><path d="M50 52 L50 70" stroke="#C49A5A" stroke-width="1" stroke-dasharray="2,2" opacity="0.6"/></svg></div>
  <div class="upload-text">點擊上傳<br>舌部照片</div>`;
  tz.onclick = () => document.getElementById('tongue-input').click();
  document.getElementById('btn-step2').style.display = 'none';

  document.getElementById('credit-num').textContent = sb_currentUser.credits || 0;
  showPage('page-main');
  goStep(1);
}
