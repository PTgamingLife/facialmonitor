/* ═══════════════════════════════════════════════
   報告渲染 — 整合中醫面舌診診斷框架
   ═══════════════════════════════════════════════ */

/* ── 體質類型說明（九種體質） ── */
const CONSTITUTION_DESC = {
  '平和質': { emoji:'🌿', desc:'陰陽平衡，氣血調和，為最理想的體質狀態。', advice:'維持現有生活習慣，適度運動，均衡飲食。' },
  '氣虛質': { emoji:'🍃', desc:'元氣不足，容易疲勞，說話聲低，易感冒。', advice:'多食山藥、紅棗、党參等補氣食物，避免過勞。' },
  '陽虛質': { emoji:'❄️', desc:'陽氣不足，怕冷，四肢不溫，精神不振。', advice:'多食羊肉、生薑、韭菜等溫陽食物，避免生冷。' },
  '陰虛質': { emoji:'🔥', desc:'陰液不足，手足心熱，口燥咽乾，潮熱盜汗。', advice:'多食銀耳、百合、蓮藕等滋陰食物，少辛辣。' },
  '痰濕質': { emoji:'💧', desc:'痰濕凝聚，形體肥胖，腹部肥滿，口黏苔膩。', advice:'多食冬瓜、薏仁、陳皮等化痰祛濕食物，少甜膩。' },
  '濕熱質': { emoji:'🌡️', desc:'濕熱蘊結，面垢油光，口苦口乾，大便黏滯。', advice:'多食綠豆、苦瓜、蓮子等清熱利濕食物，忌煙酒。' },
  '血瘀質': { emoji:'🩸', desc:'血行不暢，面色晦暗，皮膚粗糙，口脣暗淡。', advice:'多食山楂、黑木耳、玫瑰花等活血化瘀食物。' },
  '氣鬱質': { emoji:'🌪️', desc:'氣機鬱滯，情感脆弱，煩悶不樂，易悲傷。', advice:'多食佛手柑、玫瑰花、陳皮等疏肝理氣食物。' },
  '特稟質': { emoji:'🌸', desc:'先天稟賦不足，對某些物質有過敏反應。', advice:'避開過敏源，多食益氣固表食物，如黃耆、白術。' },
};

/* ── 面部六區對應臟腑（中醫面診映射） ── */
const FACE_ZONES = [
  { zone:'額頭', organ:'心・小腸', key:'forehead' },
  { zone:'鼻',   organ:'脾・胃',   key:'nose' },
  { zone:'左頰', organ:'肝・膽',   key:'leftCheek' },
  { zone:'右頰', organ:'肺・大腸', key:'rightCheek' },
  { zone:'眼周', organ:'腎・膀胱', key:'eyeArea' },
  { zone:'下頜', organ:'腎・生殖', key:'chin' },
];

/* ── 舌診五項指標 ── */
const TONGUE_KEYS = [
  { key:'color',   label:'舌色' },
  { key:'coating', label:'苔色' },
  { key:'texture', label:'苔質' },
  { key:'shape',   label:'舌形' },
  { key:'state',   label:'舌態' },
];

/* ── 主渲染函式 ── */
function renderReport(r) {
  const el = document.getElementById('report-content');
  if (!el || !r) return;

  const score    = r.score ?? 75;
  const date     = formatDate();
  const userName = currentUser?.name ?? '用戶';

  el.innerHTML = `
    ${scoreSection(score, userName, date)}
    ${riskAlert(r.risks)}
    ${nutrientsSection(r.nutrients)}
    ${disorderSection(r.disorders)}
    ${faceZoneSection(r.faceZones)}
    ${tongueSection(r.tongue)}
    ${constitutionSection(r.constitution)}
    ${dietSection(r.diet)}
    ${acupointSection(r.acupoints)}
    ${lifestyleSection(r.lifestyle)}
    ${westernSection(r.western)}
    <div class="report-footer-disc">⚠️ 本分析為中醫養生參考，不構成醫療診斷。<br>如有身體不適，請即時就醫。</div>
  `;

  // 分數動畫
  animateScore(score);
}

function scoreSection(score, name, date) {
  const emoji = score >= 85 ? '😄' : score >= 70 ? '😊' : score >= 55 ? '😐' : '😟';
  return `
  <div class="report-header">
    <div class="report-user">${name} 的健康分析</div>
    <div class="report-title">健康分析報告</div>
    <div class="report-date">${date}</div>
    <div class="report-divider"></div>
  </div>
  <div class="sec-card">
    <div class="score-wrap">
      <div class="score-label">健康指數</div>
      <div class="score-num" id="score-num">0</div>
      <div class="score-bar-wrap"><div class="score-bar-fill" id="score-bar" style="width:0%"></div></div>
      <span class="score-emoji">${emoji}</span>
    </div>
  </div>`;
}

function animateScore(target) {
  let cur = 0;
  const step = Math.ceil(target / 40);
  const timer = setInterval(() => {
    cur = Math.min(cur + step, target);
    const el = document.getElementById('score-num');
    const bar = document.getElementById('score-bar');
    if (el) el.textContent = cur;
    if (bar) bar.style.width = cur + '%';
    if (cur >= target) clearInterval(timer);
  }, 35);
}

function riskAlert(risks) {
  if (!risks?.length) return '';
  return `
  <div class="sec-card" style="border-left:3px solid var(--alert-color)">
    <div class="sec-title">⚠️ 主要風險提示</div>
    ${risks.map(r => `<div class="list-row"><div class="dot red"></div><div class="list-main">${r}</div></div>`).join('')}
  </div>`;
}

function nutrientsSection(items) {
  if (!items?.length) return '';
  return `
  <div class="sec-card">
    <div class="sec-title">💊 關鍵營養素建議</div>
    ${items.map(n => `
    <div class="nutrient-item">
      <span class="nutrient-icon">${n.icon ?? '🌿'}</span>
      <div>
        <div class="nutrient-name">${n.name}</div>
        <div class="nutrient-reason">${n.reason}</div>
        <div class="nutrient-foods">食材：${n.foods}</div>
      </div>
    </div>`).join('')}
  </div>`;
}

function disorderSection(items) {
  if (!items?.length) return '';
  return `
  <div class="sec-card">
    <div class="sec-title">🔍 失調注意</div>
    ${items.map(d => `
    <div class="list-row">
      <div class="dot jade"></div>
      <div>
        <div class="list-main">${d.title}</div>
        <div class="list-sub">${d.detail}</div>
      </div>
    </div>`).join('')}
  </div>`;
}

function faceZoneSection(zones) {
  const data = zones ?? {};
  return `
  <div class="sec-card">
    <div class="sec-title">👤 面部六區診斷</div>
    ${FACE_ZONES.map(f => {
      const z     = data[f.key] ?? {};
      const badge = z.status === '正常' ? 'badge-ok' : z.status === '輕微失調' ? 'badge-warn' : z.status ? 'badge-alert' : 'badge-ok';
      const status = z.status ?? '正常';
      return `
      <div class="zone-row">
        <div class="zone-name">${f.zone}</div>
        <div class="zone-organ">${f.organ}</div>
        <span class="badge ${badge}">${status}</span>
      </div>
      ${z.detail ? `<div style="font-size:13px;color:var(--text-soft);padding:2px 0 8px 48px;line-height:1.7">${z.detail}</div>` : ''}`;
    }).join('')}
  </div>`;
}

function tongueSection(tongue) {
  const t = tongue ?? {};
  return `
  <div class="sec-card">
    <div class="sec-title">👅 舌診五項分析</div>
    ${TONGUE_KEYS.map(k => {
      const val     = t[k.key]     ?? '淡紅';
      const meaning = t[k.key+'_meaning'] ?? '';
      return `
      <div class="tongue-row">
        <div class="tongue-lbl">${k.label}</div>
        <div>
          <div class="tongue-val">${val}</div>
          ${meaning ? `<div class="tongue-meaning">${meaning}</div>` : ''}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function constitutionSection(con) {
  const type = con?.type ?? '氣虛質';
  const info = CONSTITUTION_DESC[type] ?? CONSTITUTION_DESC['氣虛質'];
  return `
  <div class="sec-card">
    <div class="sec-title">🧬 體質判斷</div>
    <div class="const-type">${info.emoji} ${type}</div>
    <div class="const-desc">${info.desc}</div>
    ${con?.detail ? `<div class="cross-verify">${con.detail}</div>` : ''}
    <div class="cross-verify" style="margin-top:8px">💡 ${info.advice}</div>
  </div>`;
}

function dietSection(items) {
  if (!items?.length) return '';
  return `
  <div class="sec-card">
    <div class="sec-title">🥗 食療建議</div>
    ${items.map(d => `
    <div class="list-row">
      <div class="dot"></div>
      <div>
        <div class="list-main">${d.title}</div>
        ${d.detail ? `<div class="list-sub">${d.detail}</div>` : ''}
      </div>
    </div>`).join('')}
  </div>`;
}

function acupointSection(pts) {
  if (!pts?.length) return '';
  return `
  <div class="sec-card">
    <div class="sec-title">🎯 推薦穴位保健</div>
    ${pts.map(p => `
    <div class="acu-item">
      <div class="acu-name">▸ ${p.name}</div>
      <div class="acu-desc">${p.desc}</div>
    </div>`).join('')}
  </div>`;
}

function lifestyleSection(tips) {
  if (!tips?.length) return '';
  return `
  <div class="sec-card">
    <div class="sec-title">🌙 作息調整建議</div>
    ${tips.map(t => `
    <div class="list-row">
      <div class="dot jade"></div>
      <div class="list-main">${t}</div>
    </div>`).join('')}
  </div>`;
}

function westernSection(notes) {
  if (!notes?.length) return '';
  return `
  <div class="sec-card">
    <div class="sec-title">🏥 西醫觀察提示</div>
    ${notes.map(n => `
    <div class="western-row">
      <div class="dot red"></div>
      <div class="western-text">${n}</div>
    </div>`).join('')}
  </div>`;
}

/* ── 歷史紀錄渲染 ── */
async function loadHistory() {
  const list = document.getElementById('history-list');
  if (!list || !currentUser) return;
  list.innerHTML = '<div class="empty-state">載入中…</div>';

  const { data } = await supabase
    .from('analyses')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!data?.length) {
    list.innerHTML = '<div class="empty-state">尚無診斷記錄<br>完成第一次面舌診後即可查看</div>';
    return;
  }

  list.innerHTML = data.map(row => {
    const r     = row.result ?? {};
    const score = r.score ?? '—';
    const type  = r.constitution?.type ?? '—';
    return `
    <div class="hist-item" onclick="viewHistoryReport(${JSON.stringify(JSON.stringify(r))})">
      <div class="hist-top">
        <div class="hist-type">健康分數 ${score}</div>
        <div class="hist-date">${relativeTime(row.created_at)}</div>
      </div>
      <div class="hist-desc">體質：${type}</div>
    </div>`;
  }).join('');
}

function viewHistoryReport(jsonStr) {
  try {
    currentReport = JSON.parse(jsonStr);
    renderReport(currentReport);
    showPage('page-report');
  } catch { showToast('無法載入此報告'); }
}
