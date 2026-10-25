// cb-app.js — 畫面切換、進度、遊戲迴圈、輸入
(function (cb_root) {
  const { CB_COLS, CB_ROWS, cbCreateGame, cbPull, cbStep, cbPinHandle } = cb_root.CB_ENGINE;
  const { cbDraw } = cb_root.CB_DRAW;
  const NET = cb_root.CB_NET;
  const LEVELS = cb_root.CB_LEVELS;
  const $ = (id) => document.getElementById(id);
  const CB_TICK_MS = 1000 / 30;
  const CB_LOSE_TEXT = {
    cat_burn: '貓咪被岩漿燙到了!', box_burn: '紙箱被燒掉了!', dog: '被狗狗抓到了!', stuck: '卡住了,再想想!',
  };

  const cb_state = { cb_level: 1, cb_attempts: 1, cb_startAt: 0, cb_game: null, cb_cell: 10, cb_acc: 0, cb_last: 0, cb_running: false, cb_ended: false, cb_muted: false };
  let cb_progress = { best: {} };

  // ---------- 進度存取 ----------
  const cbKey = () => `cb_progress_${NET.cb_user.cb_id}`;
  function cbLoad() {
    try { cb_progress = JSON.parse(localStorage.getItem(cbKey())) || { best: {} }; } catch (e) { cb_progress = { best: {} }; }
    try { cb_state.cb_muted = localStorage.getItem('cb_muted') === '1'; } catch (e) { /* ignore */ }
  }
  function cbSave() { try { localStorage.setItem(cbKey(), JSON.stringify(cb_progress)); } catch (e) { /* 無痕模式 */ } }
  function cbTotals() {
    const vals = Object.values(cb_progress.best);
    return { cb_stars: vals.reduce((a, b) => a + b.stars, 0), cb_cleared: vals.length, cb_timeMs: vals.reduce((a, b) => a + b.timeMs, 0) };
  }
  const cbUnlocked = (n) => n === 1 || !!cb_progress.best[n - 1];

  // ---------- 音效(WebAudio 小嗶聲) ----------
  let cb_audio = null;
  function cbTone(freqs, dur, type) {
    if (cb_state.cb_muted) return;
    try {
      cb_audio = cb_audio || new (window.AudioContext || window.webkitAudioContext)();
      freqs.forEach((f, k) => {
        const o = cb_audio.createOscillator(), gn = cb_audio.createGain(), t0 = cb_audio.currentTime + k * dur;
        o.type = type || 'sine'; o.frequency.value = f;
        gn.gain.setValueAtTime(0.18, t0); gn.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        o.connect(gn).connect(cb_audio.destination); o.start(t0); o.stop(t0 + dur);
      });
    } catch (e) { /* 不支援就安靜 */ }
  }

  // ---------- 畫面切換 ----------
  function cbShow(id) {
    document.querySelectorAll('.cb-screen').forEach((el) => el.classList.toggle('active', el.id === id));
    cb_state.cb_running = id === 'cb_game';
    if (cb_state.cb_running) { cbResize(); cb_state.cb_last = performance.now(); requestAnimationFrame(cbLoop); }
  }

  function cbRenderHome() {
    const u = NET.cb_user, t = cbTotals();
    $('cb_userName').textContent = u.cb_name;
    $('cb_userAvatar').src = u.cb_avatar || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#FFC8D6"/><text x="20" y="27" font-size="20" text-anchor="middle">🐱</text></svg>');
    $('cb_userStars').textContent = `★ ${t.cb_stars} / ${LEVELS.length * 3}`;
    $('cb_guestTip').hidden = u.cb_isLine;
  }

  function cbRenderLevels() {
    const wrap = $('cb_levelGrid');
    wrap.innerHTML = '';
    LEVELS.forEach((lv, k) => {
      const n = k + 1, best = cb_progress.best[n], open = cbUnlocked(n);
      const b = document.createElement('button');
      b.className = 'cb-level' + (best ? ' done' : '') + (open ? '' : ' locked');
      b.disabled = !open;
      b.innerHTML = `<span class="cb-lv-n">${open ? n : '🔒'}</span><span class="cb-lv-s">${best ? '★'.repeat(best.stars) + '☆'.repeat(3 - best.stars) : open ? '☆☆☆' : ''}</span>`;
      b.onclick = () => cbStartLevel(n, true);
      wrap.appendChild(b);
    });
    const t = cbTotals();
    $('cb_levelStars').textContent = `★ ${t.cb_stars} / ${LEVELS.length * 3}`;
  }

  // ---------- 遊戲 ----------
  function cbStartLevel(n, fresh) {
    const lv = LEVELS[n - 1];
    if (!lv) return;
    if (fresh || n !== cb_state.cb_level) cb_state.cb_attempts = 1; else cb_state.cb_attempts++;
    cb_state.cb_level = n;
    cb_state.cb_game = cbCreateGame(lv);
    cb_state.cb_startAt = performance.now();
    cb_state.cb_ended = false;
    clearTimeout(cb_state.cb_resultTimer);
    cb_state.cb_acc = 0;
    $('cb_gameTitle').textContent = `第 ${n} 關 · ${lv.name}`;
    $('cb_hint').textContent = lv.hint;
    $('cb_result').hidden = true;
    cbShow('cb_game');
  }

  function cbResize() {
    const wrap = $('cb_canvasWrap'), cv = $('cb_canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cell = Math.max(4, Math.min(wrap.clientWidth / CB_COLS, wrap.clientHeight / CB_ROWS));
    cv.style.width = `${cell * CB_COLS}px`; cv.style.height = `${cell * CB_ROWS}px`;
    cv.width = Math.round(cell * CB_COLS * dpr); cv.height = Math.round(cell * CB_ROWS * dpr);
    cb_state.cb_cell = cell * dpr;
  }

  function cbLoop(ts) {
    if (!cb_state.cb_running) return;
    const g = cb_state.cb_game;
    cb_state.cb_acc += Math.min(100, ts - cb_state.cb_last);
    cb_state.cb_last = ts;
    while (cb_state.cb_acc >= CB_TICK_MS) {
      const before = g.state;
      cbStep(g);
      cb_state.cb_acc -= CB_TICK_MS;
      if (before === 'play' && g.state !== 'play') cbOnEnd(g);
    }
    cbDraw($('cb_canvas').getContext('2d'), g, cb_state.cb_cell, ts);
    requestAnimationFrame(cbLoop);
  }

  function cbOnEnd(g) {
    if (cb_state.cb_ended) return;
    cb_state.cb_ended = true;
    const n = cb_state.cb_level;
    if (g.state === 'win') {
      cbTone([660, 880, 1320], 0.12, 'triangle');
      const stars = cb_state.cb_attempts === 1 ? 3 : cb_state.cb_attempts === 2 ? 2 : 1;
      const timeMs = Math.round(performance.now() - cb_state.cb_startAt);
      const prev = cb_progress.best[n];
      const improved = !prev || stars > prev.stars || (stars === prev.stars && timeMs < prev.timeMs);
      if (improved) { cb_progress.best[n] = { stars, timeMs }; cbSave(); NET.cbSubmitScore(cbTotals()); }
      cb_state.cb_resultTimer = setTimeout(() => cbShowResult(true, stars, timeMs), 1600);
    } else {
      cbTone([300, 200], 0.18, 'sawtooth');
      if (navigator.vibrate) navigator.vibrate(120);
      cb_state.cb_resultTimer = setTimeout(() => cbShowResult(false), 1100);
    }
  }

  function cbShowResult(win, stars, timeMs) {
    const n = cb_state.cb_level, last = n >= LEVELS.length;
    $('cb_resTitle').textContent = win ? (last ? '全部破關!🎉' : '躲好了!') : '哎呀!';
    $('cb_resText').textContent = win ? `用了 ${(timeMs / 1000).toFixed(1)} 秒` : CB_LOSE_TEXT[cb_state.cb_game.reason] || '再試一次';
    $('cb_resStars').textContent = win ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '';
    $('cb_resNext').hidden = !win || last;
    $('cb_resRetry').textContent = win ? '再玩一次' : '再試一次';
    $('cb_resShare').hidden = !win;
    $('cb_result').dataset.stars = stars || 0;
    $('cb_result').hidden = false;
  }

  function cbPointer(ev) {
    const g = cb_state.cb_game;
    if (!g || g.state !== 'play') return;
    const rect = $('cb_canvas').getBoundingClientRect();
    const cx = (ev.clientX - rect.left) / rect.width * CB_COLS, cy = (ev.clientY - rect.top) / rect.height * CB_ROWS;
    let best = null, bestD = 3.2;
    g.pins.forEach((p) => {
      if (p.pulled) return;
      const x0 = p.x, y0 = p.y, x1 = p.dir === 'h' ? p.x + p.len : p.x + 1, y1 = p.dir === 'h' ? p.y + 1 : p.y + p.len;
      const dx = Math.max(x0 - cx, 0, cx - x1), dy = Math.max(y0 - cy, 0, cy - y1);
      let d = Math.hypot(dx, dy);
      const [hx, hy] = cbPinHandle(p);
      d = Math.min(d, Math.max(0, Math.hypot(cx - hx, cy - hy) - 1.4));
      if (d < bestD) { bestD = d; best = p; }
    });
    if (best && cbPull(g, best.id)) {
      cbTone([520 + best.id * 40], 0.08, 'square');
      if (navigator.vibrate) navigator.vibrate(15);
    }
  }

  // ---------- 排行榜 ----------
  async function cbOpenRank() {
    $('cb_rank').hidden = false;
    const list = $('cb_rankList');
    list.innerHTML = '<li class="cb-rank-msg">讀取中…</li>';
    try {
      const rows = (await NET.cbFetchTop10()) || [];
      if (!rows.length) { list.innerHTML = '<li class="cb-rank-msg">還沒有人上榜,搶頭香!</li>'; return; }
      list.innerHTML = '';
      rows.forEach((r, k) => {
        const li = document.createElement('li');
        li.className = 'cb-rank-row' + (k < 3 ? ` top${k + 1}` : '');
        const medal = ['🥇', '🥈', '🥉'][k] || `${k + 1}`;
        const img = document.createElement('img');
        img.src = r.cb_avatar || ''; img.alt = ''; img.onerror = () => { img.style.visibility = 'hidden'; };
        const name = document.createElement('span'); name.className = 'cb-rank-name'; name.textContent = r.cb_name;
        const score = document.createElement('span'); score.className = 'cb-rank-score';
        score.textContent = `★${r.cb_stars} · ${(r.cb_time_ms / 1000).toFixed(0)}s`;
        const m = document.createElement('span'); m.className = 'cb-rank-medal'; m.textContent = medal;
        li.append(m, img, name, score);
        list.appendChild(li);
      });
    } catch (err) {
      list.innerHTML = '<li class="cb-rank-msg">排行榜暫時連不上</li>';
    }
  }

  function cbToast(text) {
    const t = $('cb_toast');
    t.textContent = text; t.classList.add('show');
    clearTimeout(cbToast.tm); cbToast.tm = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ---------- 綁定 ----------
  function cbBind() {
    $('cb_btnStart').onclick = () => { cbRenderLevels(); cbShow('cb_levels'); };
    $('cb_btnRank').onclick = cbOpenRank;
    $('cb_btnRank2').onclick = cbOpenRank;
    $('cb_btnHow').onclick = () => { $('cb_how').hidden = false; };
    $('cb_howClose').onclick = () => { $('cb_how').hidden = true; };
    $('cb_rankClose').onclick = () => { $('cb_rank').hidden = true; };
    $('cb_levelsBack').onclick = () => { cbRenderHome(); cbShow('cb_home'); };
    $('cb_gameBack').onclick = () => { clearTimeout(cb_state.cb_resultTimer); cbRenderLevels(); cbShow('cb_levels'); };
    $('cb_gameRestart').onclick = () => cbStartLevel(cb_state.cb_level, false);
    $('cb_resRetry').onclick = () => cbStartLevel(cb_state.cb_level, cb_state.cb_game.state === 'win');
    $('cb_resNext').onclick = () => cbStartLevel(cb_state.cb_level + 1, true);
    $('cb_resLevels').onclick = () => { cbRenderLevels(); cbShow('cb_levels'); };
    $('cb_resShare').onclick = async () => {
      const n = cb_state.cb_level, s = +$('cb_result').dataset.stars;
      const r = await NET.cbShare(`我在「${cb_root.CB_CONFIG.cb_gameName}」過了第 ${n} 關,拿到 ${'★'.repeat(s)}!`);
      if (r === 'copied') cbToast('已複製,貼給朋友吧!');
      else if (r === 'sent') cbToast('分享成功!');
    };
    $('cb_btnMute').onclick = () => {
      cb_state.cb_muted = !cb_state.cb_muted;
      try { localStorage.setItem('cb_muted', cb_state.cb_muted ? '1' : '0'); } catch (e) { /* ignore */ }
      $('cb_btnMute').textContent = cb_state.cb_muted ? '🔇' : '🔊';
    };
    $('cb_canvas').addEventListener('pointerdown', cbPointer);
    window.addEventListener('resize', () => { if (cb_state.cb_running) cbResize(); });
  }

  async function cbBoot() {
    cbBind();
    await NET.cbInitLiff();
    cbLoad();
    $('cb_btnMute').textContent = cb_state.cb_muted ? '🔇' : '🔊';
    cbRenderHome();
    $('cb_loading').hidden = true;
    cbShow('cb_home');
  }

  cb_root.CB_APP = { cb_state, cbStartLevel };   // 給測試用
  document.addEventListener('DOMContentLoaded', cbBoot);
})(window);
