/* ===== sk_main.js — 畫面流程、輸入、音效、主迴圈 ===== */
(function () {
  'use strict';
  const G = window.sk_Game, R = window.sk_Render;
  const $ = id => document.getElementById(id);

  const sk_CHARS = [
    { id: 'aurora', name: '小光', style: 'bob', skin: '#FFDCC0', hair: '#2B3A55', body: '#5CF2C8', bodyDark: '#2BB3A3', scarf: '#FF7A6B', shoe: '#0B3D5C' },
    { id: 'coral', name: '珊珊', style: 'twin', skin: '#FFE2CB', hair: '#8A4B2E', body: '#FF9C8A', bodyDark: '#E0655A', scarf: '#FFF1C8', shoe: '#7A2E3A' },
    { id: 'frost', name: '冰冰', style: 'bun', skin: '#F7CBA5', hair: '#1F1B2E', body: '#9DB8FF', bodyDark: '#6A86E0', scarf: '#C8F4FF', shoe: '#2D3A6B' },
    { id: 'tide', name: '阿潮', style: 'cap', skin: '#D9A074', hair: '#2E1F1A', body: '#FFD36B', bodyDark: '#E0A83A', scarf: '#2BB3A3', shoe: '#3A2A1A' }
  ];
  /* 載入黏土角色圖；載不到就維持程式繪製的版本 */
  const sk_FRAMES = ['run0', 'run1', 'run2', 'run3', 'idle', 'fall', 'hurt', 'land'];
  const sk_SPRITE_IDS = ['aurora', 'coral', 'frost', 'tide'];   /* 有 sk_assets/<id>/ 的角色 */
  for (const ch of sk_CHARS) {
    if (sk_SPRITE_IDS.indexOf(ch.id) < 0) continue;
    const sp = { frames: {}, ready: false, left: sk_FRAMES.length };
    ch.sk_sprites = sp;
    for (const f of sk_FRAMES) {
      const img = new Image();
      img.onload = () => { sp.frames[f] = img; if (--sp.left === 0) sp.ready = true; };
      img.onerror = () => { sp.left = -99; };
      img.src = `sk_assets/${ch.id}/${f}.png`;
    }
  }
  const sk_DIFF_ORDER = ['baby', 'easy', 'normal', 'hard'];
  const sk_DIFF_HINT = { baby: '不會失敗', easy: '輕鬆', normal: '標準', hard: '高手' };

  /* ---------- 存檔（localStorage 可能被擋，全部包 try） ---------- */
  const sk_store = {
    get(k, d) { try { const v = localStorage.getItem('sk_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('sk_' + k, JSON.stringify(v)); } catch (e) { /* 忽略 */ } }
  };
  const sk_settings = { char: sk_store.get('char', 'aurora'), diff: sk_store.get('diff', 'normal'), mute: sk_store.get('mute', false) };

  /* ---------- 音效：WebAudio 合成 ---------- */
  let sk_ac = null;
  function sk_audio() {
    if (sk_settings.mute) return null;
    try { if (!sk_ac) sk_ac = new (window.AudioContext || window.webkitAudioContext)(); if (sk_ac.state === 'suspended') sk_ac.resume(); } catch (e) { return null; }
    return sk_ac;
  }
  function sk_tone(freq, dur, type, vol, slide) {
    const ac = sk_audio(); if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol || 0.15, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const sk_sfx = {
    land: () => sk_tone(520, 0.07, 'sine', 0.08, 380),
    heal: () => sk_tone(880, 0.12, 'triangle', 0.06, 1320),
    spring: () => sk_tone(300, 0.25, 'square', 0.06, 900),
    hurt: () => sk_tone(220, 0.25, 'sawtooth', 0.1, 90),
    crumble: () => sk_tone(160, 0.2, 'triangle', 0.08, 60),
    world: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => sk_tone(f, 0.18, 'triangle', 0.08), i * 90)); },
    go: () => sk_tone(660, 0.2, 'triangle', 0.1, 990),
    tick: () => sk_tone(440, 0.08, 'triangle', 0.07),
    over: () => { [392, 330, 262].forEach((f, i) => setTimeout(() => sk_tone(f, 0.3, 'triangle', 0.09), i * 160)); }
  };

  /* ---------- 輸入 ---------- */
  const sk_keys = new Set();
  const sk_touchState = { left: false, right: false };
  function sk_dir() {
    const l = sk_keys.has('L') || sk_touchState.left, r = sk_keys.has('R') || sk_touchState.right;
    return l === r ? 0 : l ? -1 : 1;
  }
  window.addEventListener('keydown', e => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { sk_keys.add('L'); e.preventDefault(); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { sk_keys.add('R'); e.preventDefault(); }
    else if (e.code === 'Escape' || e.code === 'KeyP') sk_togglePause();
    else if ((e.code === 'Enter' || e.code === 'Space') && sk_mode !== 'play') {
      if (sk_mode === 'menu') sk_start(); else if (sk_mode === 'result') sk_start();
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') sk_keys.delete('L');
    if (e.code === 'ArrowRight' || e.code === 'KeyD') sk_keys.delete('R');
  });
  window.addEventListener('blur', () => { sk_keys.clear(); sk_touchState.left = sk_touchState.right = false; });
  function sk_bindTouch(el, side) {
    const on = e => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (er) { /* 舊瀏覽器沒有也沒關係 */ }
      sk_touchState[side] = true; el.classList.add('sk_on'); sk_audio();
    };
    const off = e => { e.preventDefault(); sk_touchState[side] = false; el.classList.remove('sk_on'); };
    el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
    /* 長按時擋掉系統選單與選字 */
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('selectstart', e => e.preventDefault());
    el.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  }
  /* 遊戲進行中整頁都不要跳長按選單（選單畫面不影響） */
  document.addEventListener('contextmenu', e => { if (sk_mode === 'play') e.preventDefault(); });
  sk_bindTouch($('sk_left'), 'left'); sk_bindTouch($('sk_right'), 'right');

  /* ---------- 選單 ---------- */
  const sk_renderer = R.sk_createRenderer($('sk_canvas'));
  const sk_previews = [];
  function sk_buildMenu() {
    const cw = $('sk_chars');
    cw.innerHTML = '';
    sk_previews.length = 0;
    for (const ch of sk_CHARS) {
      const b = document.createElement('button');
      b.className = 'sk_opt' + (ch.id === sk_settings.char ? ' sk_sel' : '');
      const cv = document.createElement('canvas');
      b.appendChild(cv);
      b.appendChild(document.createTextNode(ch.name));
      b.onclick = () => { sk_settings.char = ch.id; sk_store.set('char', ch.id); sk_buildMenu(); sk_tone(700, 0.06, 'triangle', 0.06); };
      cw.appendChild(b);
      sk_previews.push({ r: R.sk_createRenderer(cv), ch });
    }
    const dw = $('sk_diffs');
    dw.innerHTML = '';
    for (const id of sk_DIFF_ORDER) {
      const d = G.sk_DIFF[id];
      const b = document.createElement('button');
      b.className = 'sk_opt' + (id === sk_settings.diff ? ' sk_sel' : '');
      b.innerHTML = `${d.name}<small>${sk_DIFF_HINT[id]}・♥${d.hp}</small>`;
      b.onclick = () => { sk_settings.diff = id; sk_store.set('diff', id); sk_buildMenu(); sk_tone(700, 0.06, 'triangle', 0.06); };
      dw.appendChild(b);
    }
    const best = sk_store.get('best_' + sk_settings.diff, 0);
    $('sk_bestVal').textContent = best ? best + ' m' : '—';
    $('sk_mute').textContent = sk_settings.mute ? '🔇 音效關' : '🔊 音效開';
  }
  $('sk_mute').onclick = () => { sk_settings.mute = !sk_settings.mute; sk_store.set('mute', sk_settings.mute); sk_buildMenu(); };

  /* ---------- 流程 ---------- */
  let sk_mode = 'menu';      /* menu | play | pause | result */
  let sk_match = null;
  let sk_lastCount = 0;
  const sk_show = (id, v) => $(id).classList.toggle('sk_hidden', !v);

  function sk_newMatch() {
    const sz = sk_renderer.size();
    return G.sk_createMatch({ difficulty: sk_settings.diff, viewH: sk_renderer.sk_viewHFor(sz.w, sz.h) });
  }
  function sk_start() {
    sk_audio();
    sk_match = sk_newMatch();
    sk_mode = 'play';
    sk_lastCount = 0;
    ['sk_menu', 'sk_pause', 'sk_result'].forEach(id => sk_show(id, false));
    sk_show('sk_hud', true); sk_show('sk_touch', true);
    $('sk_endRun').classList.toggle('sk_hidden', !sk_match.diff.endless);
    sk_toast(sk_renderer.worldName(sk_match));
  }
  function sk_togglePause() {
    if (sk_mode === 'play') { sk_mode = 'pause'; sk_show('sk_pause', true); }
    else if (sk_mode === 'pause') { sk_mode = 'play'; sk_show('sk_pause', false); }
  }
  function sk_toMenu() {
    sk_mode = 'menu';
    ['sk_pause', 'sk_result', 'sk_hud', 'sk_touch'].forEach(id => sk_show(id, false));
    sk_show('sk_menu', true);
    sk_match = null;
    sk_buildMenu();
  }
  function sk_finish() {
    const s = sk_match, p = s.player;
    const depth = Math.floor(p.deepest);
    const key = 'best_' + s.diff.id;
    const best = sk_store.get(key, 0);
    const isBest = depth > best;
    if (isBest) sk_store.set(key, depth);
    sk_mode = 'result';
    sk_sfx.over();
    const cause = { spike: '被尖刺打倒了', ceiling: '被天花板追上了', fall: '掉出畫面了', quit: '結束這局' }[s.cause] || '挑戰結束';
    $('sk_resTitle').textContent = cause;
    $('sk_resDepth').textContent = depth;
    sk_show('sk_newBest', isBest && depth > 0);
    const t = Math.floor(s.time);
    $('sk_resStats').innerHTML =
      `<div>存活時間<b>${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</b></div>` +
      `<div>最深世界<b>${sk_renderer.worldName(s)}</b></div>` +
      `<div>彈簧<b>${p.stats.springs}</b></div>` +
      `<div>最佳紀錄<b>${Math.max(best, depth)} m</b></div>`;
    setTimeout(() => { if (sk_mode === 'result') { sk_show('sk_result', true); sk_show('sk_touch', false); } }, 650);
  }

  $('sk_start').onclick = sk_start;
  $('sk_again').onclick = sk_start;
  $('sk_resMenu').onclick = sk_toMenu;
  $('sk_toMenu').onclick = sk_toMenu;
  $('sk_resume').onclick = sk_togglePause;
  $('sk_pauseBtn').onclick = sk_togglePause;
  $('sk_endRun').onclick = () => {
    if (!sk_match) return;
    sk_show('sk_pause', false); sk_mode = 'play';
    G.sk_kill(sk_match, 'quit', []);
    sk_finish();
  };

  let sk_toastTimer = 0;
  function sk_toast(text) {
    const el = $('sk_toast');
    el.textContent = text; el.classList.add('sk_show');
    clearTimeout(sk_toastTimer);
    sk_toastTimer = setTimeout(() => el.classList.remove('sk_show'), 1800);
  }

  /* ---------- HUD ---------- */
  let sk_hudCache = '';
  function sk_updateHud(s) {
    const p = s.player;
    $('sk_depth').textContent = Math.floor(p.deepest);
    const key = p.hp + '/' + p.maxHp;
    if (key === sk_hudCache) return;
    sk_hudCache = key;
    const h = $('sk_hearts');
    if (p.maxHp > 12) h.innerHTML = `♥ <b style="font-size:18px;margin-left:4px">${p.hp}</b><span class="sk_unit">/${p.maxHp}</span>`;
    else h.innerHTML = Array.from({ length: p.maxHp }, (_, i) => `<span class="${i < p.hp ? '' : 'sk_off'}">♥</span>`).join('');
  }

  /* ---------- 主迴圈：固定步長 1/60 ---------- */
  let sk_last = performance.now(), sk_acc = 0;
  let sk_demo = null;
  function sk_frame(now) {
    const dt = Math.min(0.1, (now - sk_last) / 1000);
    sk_last = now;
    const t = now / 1000;
    const ch = sk_CHARS.find(c => c.id === sk_settings.char) || sk_CHARS[0];
    if (sk_mode === 'play' && sk_match) {
      sk_acc += dt;
      while (sk_acc >= G.sk_C.STEP) {
        sk_acc -= G.sk_C.STEP;
        const evs = G.sk_step(sk_match, sk_dir());
        sk_renderer.onEvents(evs, sk_match, t);
        for (const e of evs) {
          if (e.type === 'land') sk_sfx.land();
          else if (e.type === 'heal') sk_sfx.heal();
          else if (e.type === 'spring') sk_sfx.spring();
          else if (e.type === 'hurt') { sk_sfx.hurt(); try { navigator.vibrate && navigator.vibrate(30); } catch (er) { /* 忽略 */ } }
          else if (e.type === 'crumble') sk_sfx.crumble();
          else if (e.type === 'go') sk_sfx.go();
          else if (e.type === 'world') { sk_sfx.world(); sk_toast(`${e.world * 100} m・${sk_renderer.worldName(sk_match)}`); }
          else if (e.type === 'dead') sk_finish();
        }
      }
      const c = sk_match.phase === 'countdown' ? Math.ceil(sk_match.countdown) : 0;
      if (c !== sk_lastCount) { sk_lastCount = c; if (c) sk_sfx.tick(); }
      $('sk_count').textContent = c ? c : '';
      sk_updateHud(sk_match);
      sk_renderer.draw(sk_match, ch, t, dt);
    } else {
      sk_acc = 0;
      $('sk_count').textContent = '';
      if (sk_match) sk_renderer.draw(sk_match, ch, t, sk_mode === 'result' ? dt : 0);
      else {
        /* 選單背景：示範場景緩慢捲動 */
        if (!sk_demo) {
          sk_demo = G.sk_createMatch({ difficulty: 'normal', viewH: 18, seed: 7 });
          sk_demo.player.alive = false; sk_demo.cause = 'fall';
        }
        sk_demo.cameraTop += dt * 1.2;
        G.sk_fill(sk_demo);
        sk_renderer.draw(sk_demo, ch, t, dt);
      }
      for (const pv of sk_previews) pv.r.preview(pv.ch, t, pv.ch.id === sk_settings.char);
    }
    requestAnimationFrame(sk_frame);
  }
  window.addEventListener('resize', () => sk_renderer.resize());
  sk_buildMenu();
  requestAnimationFrame(sk_frame);
})();
