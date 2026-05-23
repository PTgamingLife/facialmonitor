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

function checkWebView() {
  if (isRestrictedWebView()) {
    const banner = document.getElementById('webview-banner');
    if (banner) banner.style.display = 'flex';
  }
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
