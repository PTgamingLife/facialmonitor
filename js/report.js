// ── Render Report ────────────────────────────────────────
function renderReport(r) {
  const today = new Date();
  const dateStr = `${today.getFullYear()} 年 ${today.getMonth()+1} 月 ${today.getDate()} 日`;
  document.getElementById('report-date').textContent = dateStr;

  // Calculate total score
  let total = 75;
  if (r.scores && r.scores.total) {
    total = r.scores.total;
  } else {
    // Derive from face + tongue
    const faceScores = (r.scores && r.scores.faceZone) || [];
    const tongueScores = (r.scores && r.scores.tongue) || [];
    if (faceScores.length || tongueScores.length) {
      const all = [...faceScores, ...tongueScores];
      total = Math.round(all.reduce((a,b) => a+b, 0) / all.length * 10);
    }
  }
  total = Math.min(100, Math.max(0, total));

  // Score animation
  let cur = 0;
  const scoreEl = document.getElementById('r-score');
  const barEl = document.getElementById('r-score-bar');
  const timer = setInterval(() => {
    cur = Math.min(cur + 2, total);
    scoreEl.textContent = cur;
    if (cur >= total) clearInterval(timer);
  }, 25);
  barEl.style.width = total + '%';

  const label = total >= 85 ? '✨ 健康狀態良好' : total >= 70 ? '📊 有待調整' : '⚠️ 需要關注';
  document.getElementById('r-score-label').textContent = label;

  // Risk section
  if (r.topRisks && r.topRisks.length) {
    document.getElementById('r-risk-section').style.display = 'block';
    const risksHtml = r.topRisks.map(risk => {
      const issue = risk.issue || risk;
      const advice = risk.advice || '';
      const diseases = risk.diseases || '';
      return `<div class="risk-card">
        <div class="risk-card-header">
          <div class="risk-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C49A5A" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div class="risk-issue">${escHtml(issue)}</div>
        </div>
        ${advice ? `<div class="risk-advice">💡 ${escHtml(advice)}</div>` : ''}
        ${diseases ? `<div class="risk-diseases">⚕ ${escHtml(diseases)}</div>` : ''}
      </div>`;
    }).join('');
    document.getElementById('r-risks').innerHTML = risksHtml;
  }

  // Nutrients (moved before face zones)
  if (r.nutrients) {
    const nutrientHtml = `<div class="nutrient-grid">` +
      r.nutrients.map(n => `
        <div class="nutrient-card">
          <div class="nutrient-name">${escHtml(n.name||'')}</div>
          <div class="nutrient-reason">${escHtml(n.reason||'')}</div>
          <div class="nutrient-foods">🌿 ${escHtml(n.foods||'')}</div>
        </div>`).join('') + `</div>`;
    document.getElementById('r-nutrients').innerHTML = nutrientHtml;
  }

  // Disorder Notice (黃帝內經 + 吃的營養觀)
  if (r.disorder) {
    const d = r.disorder;
    const disorderEl = document.getElementById('r-disorder');
    const disorderCard = document.getElementById('r-disorder-card');
    if (disorderEl && d) {
      disorderEl.innerHTML = `
        <div class="disorder-organ">
          ⚠️ ${escHtml(d.organ||'')} 失調最嚴重
        </div>
        <div class="disorder-risk">${escHtml(d.risk||'')}</div>

        <div class="disorder-book">
          <div class="disorder-book-title">📜 黃帝內經建議</div>
          <div class="disorder-book-content">
            ${escHtml(d.huangdi?.theory||'')}
            ${d.huangdi?.foods ? `<div class="disorder-foods">${(d.huangdi.foods||[]).map(f=>`<span class="disorder-food-tag">🌿 ${escHtml(f)}</span>`).join('')}</div>` : ''}
          </div>
        </div>

        <div class="disorder-book">
          <div class="disorder-book-title">📗 吃的營養觀建議</div>
          <div class="disorder-book-content">
            ${escHtml(d.nutrition?.advice||'')}
            ${d.nutrition?.nutrients ? `<div class="disorder-foods">${(d.nutrition.nutrients||[]).map(n=>`<span class="disorder-food-tag">💊 ${escHtml(n)}</span>`).join('')}</div>` : ''}
          </div>
        </div>
      `;
      if (disorderCard) disorderCard.style.display = 'block';
    }
  } else {
    const disorderCard = document.getElementById('r-disorder-card');
    if (disorderCard) disorderCard.style.display = 'none';
  }

  // Face zones
  if (r.faceZones) {
    const html = r.faceZones.map(z => {
      const badge = badgeHtml(z.status);
      const isAbnormal = z.status && !z.status.includes('正常');
      const riskHtml = isAbnormal && z.risk ? `
        <div class="zone-risk-info">
          <div class="zone-risk-symptoms">⚠ ${escHtml(z.risk.symptoms||'')}</div>
          <div class="zone-risk-diseases">可能相關：${escHtml(z.risk.diseases||'')}</div>
        </div>` : '';
      return `<div class="zone-row ${isAbnormal ? 'zone-abnormal' : ''}">
        <div class="zone-name">${escHtml(z.zone)}</div>
        <div class="zone-organ">${escHtml(z.organ||'')}</div>
        ${badge}
      </div>${riskHtml}`;
    }).join('');
    document.getElementById('r-face-zones').innerHTML = html;
  }

  // Tongue analysis
  if (r.tongueAnalysis) {
    const html = r.tongueAnalysis.map(t => {
      const isAbnormal = t.status && !t.status.includes('正常');
      const riskHtml = (t.risk || t.warning) ? `
        <div class="zone-risk-info">
          <div class="zone-risk-symptoms">⚠ ${escHtml(t.risk?.symptoms || t.warning || '')}</div>
          ${t.risk?.diseases ? `<div class="zone-risk-diseases">可能相關：${escHtml(t.risk.diseases)}</div>` : ''}
        </div>` : '';
      return `<div class="tongue-row">
        <div class="tongue-item">${escHtml(t.item)}</div>
        <div class="tongue-obs">${escHtml(t.observation||'')}</div>
        <div class="tongue-meaning">${escHtml(t.meaning||'')}</div>
        ${riskHtml}
      </div>`;
    }).join('');
    document.getElementById('r-tongue').innerHTML = html;
  }

  // Constitution
  if (r.constitution) {
    document.getElementById('r-constitution').innerHTML = `
      <div class="constitution-type">${escHtml(r.constitution.type||'')}</div>
      <div class="constitution-desc">${escHtml(r.constitution.description||'')}</div>
      ${r.constitution.crossVerify ? `<div class="constitution-cross">🔍 ${escHtml(r.constitution.crossVerify)}</div>` : ''}
    `;
  }

// Nutrients already rendered above

  // Diet
  if (r.dietAdvice) {
    let html = '<div class="diet-eat">';
    html += '<div class="diet-eat-title">✅ 建議多吃</div>';
    (r.dietAdvice.eat || []).forEach(e => {
      html += `<div class="diet-row"><div class="diet-dot"></div><div><div class="diet-food">${escHtml(e.food||'')}</div><div class="diet-reason">${escHtml(e.reason||'')}</div></div></div>`;
    });
    html += '</div>';
    if (r.dietAdvice.avoid) {
      html += `<div class="diet-avoid-title">🚫 建議少吃</div>
      <div class="diet-row"><div class="diet-dot diet-dot-avoid"></div><div><div class="diet-food">${escHtml(r.dietAdvice.avoid.food||'')}</div><div class="diet-reason">${escHtml(r.dietAdvice.avoid.reason||'')}</div></div></div>`;
    }
    document.getElementById('r-diet').innerHTML = html;
  }

  // Acupoints
  if (r.acupoints) {
    const html = `<div class="acupoint-cards">` +
      r.acupoints.map(a => `
        <div class="acupoint-card">
          <div class="acupoint-circle">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
              <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4"/>
            </svg>
          </div>
          <div class="acupoint-name">${escHtml(a.name||'')}</div>
          <div class="acupoint-loc">${escHtml(a.location||'')}</div>
          <div class="acupoint-effect">${escHtml(a.effect||'')}</div>
        </div>`).join('') + `</div>`;
    document.getElementById('r-acupoints').innerHTML = html;
  }

  // Lifestyle
  if (r.lifestyle) {
    const html = `<div class="lifestyle-list">` +
      r.lifestyle.map((item, i) => `
        <div class="lifestyle-item">
          <div class="lifestyle-num">${i+1}</div>
          <div class="lifestyle-text">${escHtml(item)}</div>
        </div>`).join('') + `</div>`;
    document.getElementById('r-lifestyle').innerHTML = html;
  }

  // Western notes
  if (r.westernNotes) {
    const html = `<div class="western-list">` +
      r.westernNotes.map(w => `<div class="western-item">${escHtml(w)}</div>`).join('') + `</div>`;
    document.getElementById('r-western').innerHTML = html;
  }
}
