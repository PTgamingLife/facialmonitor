/* ═══════════════════════════════════════════════
   報告渲染 — 整合中醫面舌診診斷框架
   ═══════════════════════════════════════════════ */

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

/* ── 主渲染函式 ── */
function renderReport(r) {
  const el = document.getElementById('report-content');
  if (!el || !r) return;

  // API 新格式: scores.total；舊格式: score
  const score    = r.scores?.total ?? r.score ?? 75;
  const date     = formatDate();
  const userName = currentUser?.name ?? '用戶';

  el.innerHTML = `
    ${scoreSection(score, userName, date)}
    ${topRisksSection(r.topRisks, r.disorder)}
    ${nutrientsSection(r.nutrients)}
    ${faceZoneSection(r.faceZones)}
    ${tongueSection(r)}
    ${constitutionSection(r.constitution)}
    ${dietSection(r)}
    ${acupointSection(r.acupoints)}
    ${lifestyleSection(r.lifestyle)}
    ${westernSection(r)}
    <div class="report-footer-disc">⚠️ 本分析為中醫養生參考，不構成醫療診斷。<br>如有身體不適，請即時就醫。</div>
  `;

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

/* ── 兩大風險 + 古典與現代改善建議 ── */
function topRisksSection(topRisks, disorder) {
  if (!topRisks?.length) return '';
  const show = topRisks.slice(0, 2);
  return `
  <div class="sec-card risk-card">
    <div class="sec-title">⚠️ 身體最有可能發生的兩大風險</div>
    ${show.map((r, i) => `
    <div class="risk-block">
      <div class="risk-number">${i + 1}</div>
      <div class="risk-content">
        <div class="risk-title">${r.issue}</div>
        <div class="risk-disease">${r.diseases}</div>
        <div class="risk-advice">💡 ${r.advice}</div>
      </div>
    </div>`).join('')}
    ${disorder ? `
    <div class="remedy-divider">改善建議</div>
    <div class="risk-remedy">
      <div class="remedy-title">📖 《黃帝內經》調養</div>
      <div class="remedy-text">${disorder.huangdi?.theory ?? ''}</div>
      ${disorder.huangdi?.foods?.length ? `<div class="remedy-foods">推薦食材：${disorder.huangdi.foods.join('、')}</div>` : ''}
    </div>
    <div class="risk-remedy" style="margin-top:10px">
      <div class="remedy-title">🔬 《吃的營養學》科學建議</div>
      <div class="remedy-text">${disorder.nutrition?.advice ?? ''}</div>
      ${disorder.nutrition?.nutrients?.length ? `<div class="remedy-foods">關鍵營養素：${disorder.nutrition.nutrients.join('、')}</div>` : ''}
    </div>` : ''}
  </div>`;
}

/* ── 關鍵營養素 ── */
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

/* ── 面部六區（兼容新陣列格式與舊物件格式）── */
function faceZoneSection(zones) {
  if (!zones) return '';

  let rows;
  if (Array.isArray(zones)) {
    rows = zones.map(z => ({ zone: z.zone, organ: z.organ, status: z.status, detail: z.detail }));
  } else {
    const MAP = [
      { key:'forehead',   zone:'額頭', organ:'心・小腸' },
      { key:'nose',       zone:'鼻',   organ:'脾・胃'   },
      { key:'leftCheek',  zone:'左頰', organ:'肝・膽'   },
      { key:'rightCheek', zone:'右頰', organ:'肺・大腸' },
      { key:'eyeArea',    zone:'眼周', organ:'腎・膀胱' },
      { key:'chin',       zone:'下頜', organ:'腎・生殖' },
    ];
    rows = MAP.map(f => ({ zone: f.zone, organ: f.organ, status: zones[f.key]?.status, detail: zones[f.key]?.detail }));
  }

  return `
  <div class="sec-card">
    <div class="sec-title">👤 面部六區診斷</div>
    ${rows.map(z => {
      const badge  = z.status === '正常' ? 'badge-ok' : z.status === '輕微失調' ? 'badge-warn' : z.status ? 'badge-alert' : 'badge-ok';
      const status = z.status ?? '正常';
      return `
      <div class="zone-row">
        <div class="zone-name">${z.zone}</div>
        <div class="zone-organ">${z.organ}</div>
        <span class="badge ${badge}">${status}</span>
      </div>
      ${z.detail ? `<div style="font-size:13px;color:var(--text-soft);padding:2px 0 8px 48px;line-height:1.7">${z.detail}</div>` : ''}`;
    }).join('')}
  </div>`;
}

/* ── 舌診（兼容新 tongueAnalysis 陣列與舊 tongue 物件）── */
function tongueSection(r) {
  if (r.tongueAnalysis?.length) {
    return `
    <div class="sec-card">
      <div class="sec-title">👅 舌診分析</div>
      ${r.tongueAnalysis.map(t => `
      <div class="tongue-row">
        <div class="tongue-lbl">${t.item}</div>
        <div>
          <div class="tongue-val">${t.observation}</div>
          ${t.meaning ? `<div class="tongue-meaning">${t.meaning}</div>` : ''}
        </div>
      </div>`).join('')}
    </div>`;
  }

  const TONGUE_KEYS = [
    { key:'color',   label:'舌色' },
    { key:'coating', label:'苔色' },
    { key:'texture', label:'苔質' },
    { key:'shape',   label:'舌形' },
    { key:'state',   label:'舌態' },
  ];
  const t = r.tongue ?? {};
  return `
  <div class="sec-card">
    <div class="sec-title">👅 舌診五項分析</div>
    ${TONGUE_KEYS.map(k => {
      const val     = t[k.key]            ?? '淡紅';
      const meaning = t[k.key + '_meaning'] ?? '';
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

/* ── 體質判斷 ── */
function constitutionSection(con) {
  const type    = con?.type ?? '氣虛質';
  const matched = CONSTITUTION_DESC[type];
  const emoji   = matched?.emoji ?? '🌿';
  const stdDesc = matched?.desc  ?? '';
  const advice  = matched?.advice ?? '';
  // API 新格式用 description；舊格式用 detail
  const apiDesc = con?.description ?? con?.detail ?? '';

  return `
  <div class="sec-card">
    <div class="sec-title">🧬 體質判斷</div>
    <div class="const-type">${emoji} ${type}</div>
    ${stdDesc ? `<div class="const-desc">${stdDesc}</div>` : ''}
    ${apiDesc && apiDesc !== stdDesc ? `<div class="cross-verify">${apiDesc}</div>` : ''}
    ${con?.crossVerify ? `<div class="cross-verify">🔍 ${con.crossVerify}</div>` : ''}
    ${advice ? `<div class="cross-verify" style="margin-top:8px">💡 ${advice}</div>` : ''}
  </div>`;
}

/* ── 食療建議（兼容新 dietAdvice 與舊 diet）── */
function dietSection(r) {
  if (r.dietAdvice) {
    const eat   = r.dietAdvice.eat   ?? [];
    const avoid = r.dietAdvice.avoid ?? null;
    if (!eat.length && !avoid) return '';
    return `
    <div class="sec-card">
      <div class="sec-title">🥗 食療建議</div>
      ${eat.map(d => `
      <div class="list-row">
        <div class="dot jade"></div>
        <div>
          <div class="list-main">${d.food}</div>
          ${d.reason ? `<div class="list-sub">${d.reason}</div>` : ''}
        </div>
      </div>`).join('')}
      ${avoid ? `
      <div class="list-row" style="margin-top:4px">
        <div class="dot red"></div>
        <div>
          <div class="list-main">避免：${avoid.food}</div>
          ${avoid.reason ? `<div class="list-sub">${avoid.reason}</div>` : ''}
        </div>
      </div>` : ''}
    </div>`;
  }

  const items = r.diet;
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

/* ── 穴位（effect + location 取代 desc）── */
function acupointSection(pts) {
  if (!pts?.length) return '';
  return `
  <div class="sec-card">
    <div class="sec-title">🎯 推薦穴位保健</div>
    ${pts.map(p => `
    <div class="acu-item">
      <div class="acu-name">▸ ${p.name}</div>
      <div class="acu-desc">${p.effect ?? p.desc ?? ''}</div>
      ${p.location ? `<div class="acu-location">📍 ${p.location}</div>` : ''}
    </div>`).join('')}
  </div>`;
}

/* ── 作息調整 ── */
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

/* ── 西醫觀察（兼容新 westernNotes 與舊 western）── */
function westernSection(r) {
  const notes = r.westernNotes ?? r.western;
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

  let data = [];

  if (window._demoMode) {
    data = JSON.parse(sessionStorage.getItem('hq_demo_records') || '[]');
  } else {
    const { data: dbData, error } = await supabase
      .from('sb_analysis_records')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('loadHistory error:', error);
      list.innerHTML = '<div class="empty-state">載入失敗，請重新整理後再試</div>';
      return;
    }
    data = dbData || [];
  }

  if (!data.length) {
    list.innerHTML = '<div class="empty-state">尚無診斷記錄<br>完成第一次面舌診後即可查看</div>';
    return;
  }

  // 存入全域陣列，onclick 用 index 避免 HTML 屬性引號衝突
  window._historyReports = data.map(row => row.report ?? {});

  list.innerHTML = window._historyReports.map((r, i) => {
    const score = r.scores?.total ?? r.score ?? '—';
    const type  = r.constitution?.type ?? '—';
    const date  = data[i]?.created_at ?? '';
    return `
    <div class="hist-item" onclick="viewHistoryReport(${i})">
      <div class="hist-top">
        <div class="hist-type">健康分數 ${score}</div>
        <div class="hist-date">${relativeTime(date)}</div>
      </div>
      <div class="hist-desc">體質：${type}</div>
    </div>`;
  }).join('');
}

function viewHistoryReport(index) {
  try {
    const r = window._historyReports?.[index];
    if (!r) throw new Error('report not found');
    currentReport = r;
    renderReport(r);
    showPage('page-report');
  } catch { showToast('無法載入此報告'); }
}
