/* ── 工具函式 ── */

function formatDate(d = new Date()) {
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}

function relativeTime(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff/60000);
  if (m < 1)   return '剛剛';
  if (m < 60)  return `${m} 分鐘前`;
  const h = Math.floor(m/60);
  if (h < 24)  return `${h} 小時前`;
  return `${Math.floor(h/24)} 天前`;
}

function generateMemberCode() {
  return String(Math.floor(1000000 + Math.random() * 9000000));
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => showToast('已複製！'));
}

function showToast(msg, duration = 2200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

/* ── WebView 偵測 ── */
function isRestrictedWebView() {
  const ua = navigator.userAgent.toLowerCase();
  return /line|fbav|instagram|micromessenger/.test(ua);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase())
      && !window.MSStream;
}

function checkWebView() {
  if (isRestrictedWebView()) {
    const banner = document.getElementById('webview-banner');
    if (banner) banner.style.display = 'flex';
    return;
  }
  // iOS Safari 不支援 beforeinstallprompt，需手動引導
  if (isIOS() && !isStandalone() && !localStorage.getItem('hq_install_dismissed')) {
    setTimeout(() => showInstallBanner(), 4000);
  }
}

/* ── PWA 安裝處理 ── */
let _pwaInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _pwaInstallPrompt = e;
  if (!isStandalone() && !isRestrictedWebView() && !localStorage.getItem('hq_install_dismissed')) {
    setTimeout(() => showInstallBanner(), 3000);
  }
});

window.addEventListener('appinstalled', () => {
  dismissInstallBanner();
  _pwaInstallPrompt = null;
});

function showInstallBanner() {
  const banner = document.getElementById('install-banner');
  if (!banner) return;
  banner.style.display = 'flex';
}

function dismissInstallBanner() {
  const banner = document.getElementById('install-banner');
  if (banner) banner.style.display = 'none';
  localStorage.setItem('hq_install_dismissed', '1');
}

async function triggerInstall() {
  if (_pwaInstallPrompt) {
    _pwaInstallPrompt.prompt();
    const { outcome } = await _pwaInstallPrompt.userChoice;
    if (outcome === 'accepted') dismissInstallBanner();
    _pwaInstallPrompt = null;
  } else if (isIOS()) {
    openIosInstallModal();
  }
}

function openIosInstallModal() {
  document.getElementById('ios-install-modal').classList.add('show');
}

function closeIosInstallModal() {
  document.getElementById('ios-install-modal').classList.remove('show');
  localStorage.setItem('hq_install_dismissed', '1');
}

/* ── 圖片 → base64 ── */
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

/* ── 下載報告為圖片 ── */
async function downloadReport() {
  const el = document.getElementById('report-content');
  if (!el || typeof html2canvas === 'undefined') {
    showToast('下載功能需要較新的瀏覽器');
    return;
  }
  showToast('正在產生報告圖片…');
  try {
    const canvas = await html2canvas(el, { backgroundColor: '#F7F2EA', scale: 2 });
    const link = document.createElement('a');
    link.download = `健康報告_${formatDate()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('報告已下載！');
  } catch(e) {
    showToast('下載失敗，請截圖儲存');
  }
}

/* ── 幣數格線位置（10 顆/排，由左上往右下，100枚全部裝進 220×220） ── */
function coinPosition(index) {
  const col = index % 10;
  const row = Math.floor(index / 10);
  const x   = 5 + col * 21;   // 10列 × 21px = 210px ≤ 220
  const y   = 5 + row * 21;   // 10排 × 21px = 210px ≤ 220
  return { x, y };
}
