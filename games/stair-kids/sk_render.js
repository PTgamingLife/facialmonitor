/* ===== sk_render.js — Canvas 繪圖：極光背景、玻璃階梯、角色、粒子 ===== */
(function (root) {
  'use strict';
  const C = root.sk_Game.sk_C;

  /* 六個世界（每 100 公尺換一個），只換美術 */
  const sk_WORLDS = [
    { name: '極光峽灣', sky: ['#0B3D5C', '#0E5A6E', '#2BB3A3'], aurora: ['#5CF2C8', '#7AC8FF'], hill: '#08304A', accent: '#FF7A6B' },
    { name: '珊瑚潟湖', sky: ['#103A5E', '#1B6B85', '#4CC7B5'], aurora: ['#FF9C8A', '#7FF0D8'], hill: '#0C2F4C', accent: '#FF7A6B' },
    { name: '星霧森林', sky: ['#0C2A44', '#134A55', '#1F8A78'], aurora: ['#B4FF9C', '#5CE1F2'], hill: '#072634', accent: '#FFB36B' },
    { name: '冰晶洞窟', sky: ['#0A2C52', '#1A5D8F', '#6FC8E8'], aurora: ['#C8F4FF', '#8AA8FF'], hill: '#0A2340', accent: '#FF8FA3' },
    { name: '暮光沙洲', sky: ['#1B2D55', '#3B4F7A', '#E79A7E'], aurora: ['#FFC48A', '#FF8FB1'], hill: '#16243F', accent: '#FFD36B' },
    { name: '深海神殿', sky: ['#061B33', '#0A3550', '#12706F'], aurora: ['#4DF0FF', '#9C7BFF'], hill: '#041526', accent: '#FF7A6B' }
  ];

  function sk_createRenderer(canvas) {
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1, scale = 30, ox = 0, oy = 0, viewH = 16;
    const particles = [];
    const stars = [];
    for (let i = 0; i < 90; i++) stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.3, t: Math.random() * 6 });
    const orbs = [];
    for (let i = 0; i < 14; i++) {
      orbs.push({ x: Math.random(), y: Math.random(), r: 0.06 + Math.random() * 0.16, par: 0.08 + Math.random() * 0.3,
        a: 0.05 + Math.random() * 0.08, c: i % 2, warm: i % 5 === 0, ph: Math.random() * 6 });
    }
    let shake = 0, flash = 0, worldFade = 0, prevWorld = 0;

    function resize() {
      dpr = Math.min(2, root.devicePixelRatio || 1);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    /* 依畫面比例決定可見高度（16～24 格），手機直向可以多看幾格 */
    function sk_viewHFor(w, h) {
      return Math.max(16, Math.min(24, Math.floor((h / w) * C.FIELD_W * 0.92)));
    }
    function layout(s) {
      viewH = s.viewH;
      scale = Math.min(W / (C.FIELD_W + 1.2), H / (viewH + 1.2));
      ox = (W - C.FIELD_W * scale) / 2;
      oy = (H - viewH * scale) / 2 + scale * 0.35;
    }
    const sx = x => ox + x * scale;
    const sy = (y, s) => oy + (y - s.cameraTop) * scale;

    function rr(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    const worldOf = s => sk_WORLDS[s.world % sk_WORLDS.length];

    /* ---------- 背景：漸層＋星點＋極光絲帶＋視差山丘 ---------- */
    function drawBg(s, t) {
      const w = worldOf(s);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, w.sky[0]); g.addColorStop(0.55, w.sky[1]); g.addColorStop(1, w.sky[2]);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const drift = s.cameraTop * scale * 0.05;
      for (const st of stars) {
        const y = ((st.y * H - drift) % H + H) % H;
        ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 1.6 + st.t);
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(st.x * W, y * 0.75, st.r, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const col = w.aurora[k % 2];
        const base = H * (0.18 + k * 0.13) - (s.cameraTop * scale * 0.12) % (H * 0.4) * 0.15;
        const grad = ctx.createLinearGradient(0, base - 80, 0, base + 120);
        grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.5, col); grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.globalAlpha = 0.16 - k * 0.03;
        ctx.beginPath();
        ctx.moveTo(0, base + 120);
        for (let x = 0; x <= W; x += 24) {
          const y = base + Math.sin(x * 0.006 + t * (0.4 + k * 0.15) + k) * 40 + Math.sin(x * 0.017 - t * 0.7) * 14;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, base + 160); ctx.lineTo(0, base + 160); ctx.closePath(); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      /* 視差光球：越大越近、捲得越快 */
      ctx.globalCompositeOperation = 'lighter';
      const span = H * 1.4;
      for (const o of orbs) {
        const y = ((o.y * span - s.cameraTop * scale * o.par) % span + span) % span - H * 0.2;
        const x = o.x * W + Math.sin(t * 0.3 + o.ph) * 20;
        const r = o.r * Math.min(W, H);
        const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, o.warm ? w.accent : w.aurora[o.c]);
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = o.a;
        ctx.fillStyle = rg;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      /* 底部暗角，讓場地更突出 */
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(2,12,24,0.55)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }

    /* ---------- 場地：玻璃框、天花板、死亡線 ---------- */
    function drawField(s, t) {
      const fx = sx(0), fw = C.FIELD_W * scale, fy = oy, fh = viewH * scale;
      ctx.save();
      rr(fx - 6, fy - 6, fw + 12, fh + 12, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
      /* 深度刻度 */
      ctx.font = `${Math.max(10, scale * 0.38)}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.textAlign = 'right';
      const first = Math.ceil(s.cameraTop / 10) * 10;
      for (let m = first; m < s.cameraTop + viewH; m += 10) {
        if (m < 0 || fx < 44) continue;
        const y = sy(m, s);
        ctx.fillRect(fx - 6, y, 4, 1);
        ctx.fillText(m + 'm', fx - 10, y + 4);
      }
      /* 天花板：發光冰刺／雲朵 */
      const cy = fy;
      ctx.save();
      const glow = ctx.createLinearGradient(0, cy, 0, cy + scale * 1.4);
      glow.addColorStop(0, s.diff.ceil == null ? 'rgba(255,255,255,0.35)' : 'rgba(255,122,107,0.45)');
      glow.addColorStop(1, 'rgba(255,122,107,0)');
      ctx.fillStyle = glow; ctx.fillRect(fx, cy, fw, scale * 1.4);
      if (s.diff.ceil == null) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (let x = 0; x < C.FIELD_W; x += 1) {
          ctx.beginPath(); ctx.arc(sx(x + 0.5), cy + 2, scale * (0.55 + 0.1 * Math.sin(t * 2 + x)), 0, Math.PI); ctx.fill();
        }
      } else {
        const n = Math.round(C.FIELD_W * 1.5);
        const tw = fw / n;
        const sg = ctx.createLinearGradient(0, cy, 0, cy + scale * 0.8);
        sg.addColorStop(0, '#FFE1DC'); sg.addColorStop(1, '#FF7A6B');
        ctx.fillStyle = sg;
        ctx.shadowColor = '#FF7A6B'; ctx.shadowBlur = 12;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = fx + i * tw;
          ctx.moveTo(x, cy); ctx.lineTo(x + tw / 2, cy + scale * (0.65 + 0.12 * Math.sin(i * 1.7))); ctx.lineTo(x + tw, cy);
        }
        ctx.fill();
      }
      ctx.restore();
      /* 角色往下沉太多時，下緣出現紅光警示 */
      const sink = s.player.y - (s.cameraTop + C.CAMERA_LEAD);
      if (sink > 2 && !s.diff.endless) {
        const a = Math.min(0.6, (sink - 2) / 6);
        const g = ctx.createLinearGradient(0, fy + fh - scale * 3, 0, fy + fh);
        g.addColorStop(0, 'rgba(255,80,80,0)'); g.addColorStop(1, `rgba(255,80,80,${a})`);
        ctx.fillStyle = g; ctx.fillRect(fx, fy + fh - scale * 3, fw, scale * 3);
      }
    }

    /* ---------- 階梯 ---------- */
    function drawStep(st, s, t) {
      if (st.gone) return;
      let x = sx(st.x0), y = sy(st.depth, s);
      const w = (st.x1 - st.x0) * scale, h = scale * 0.55;
      if (y < oy - h || y > oy + viewH * scale + h) return;
      if (st.fakeT >= 0) x += Math.sin(t * 90) * 2;
      ctx.save();
      ctx.shadowColor = 'rgba(0,20,40,0.45)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 6;
      const k = st.kind;
      let top, bot, edge;
      if (k === 'normal') { top = 'rgba(255,255,255,0.55)'; bot = 'rgba(180,240,235,0.25)'; edge = 'rgba(255,255,255,0.85)'; }
      else if (k === 'belt') { top = 'rgba(40,70,110,0.85)'; bot = 'rgba(20,40,70,0.85)'; edge = '#7AC8FF'; }
      else if (k === 'spring') { top = '#FFB3A6'; bot = '#FF7A6B'; edge = '#FFE1DC'; }
      else if (k === 'spike') { top = 'rgba(90,30,50,0.85)'; bot = 'rgba(60,20,40,0.85)'; edge = '#FF7A6B'; }
      else { top = 'rgba(255,255,255,0.22)'; bot = 'rgba(255,255,255,0.08)'; edge = 'rgba(255,255,255,0.5)'; }
      const yy = k === 'spring' ? y + st.squish * h * 0.5 : y;
      const g = ctx.createLinearGradient(0, yy, 0, yy + h);
      g.addColorStop(0, top); g.addColorStop(1, bot);
      rr(x, yy, w, h, h * 0.45);
      ctx.fillStyle = g; ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 1.5; ctx.strokeStyle = edge;
      if (k === 'fake') ctx.setLineDash([6, 5]);
      ctx.stroke(); ctx.setLineDash([]);
      /* 上緣高光 */
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      rr(x + h * 0.4, yy + 2, w - h * 0.8, Math.max(1.5, h * 0.12), 2); ctx.fill();
      ctx.beginPath(); rr(x, yy, w, h, h * 0.45); ctx.clip();
      if (k === 'belt') {
        ctx.strokeStyle = 'rgba(122,200,255,0.9)'; ctx.lineWidth = 2;
        const gap = scale * 0.7, phase = ((t * C.BELT_SPEED * scale * st.belt) % gap + gap) % gap;
        for (let px = x - gap + phase; px < x + w + gap; px += gap) {
          const d = st.belt * h * 0.22;
          ctx.beginPath(); ctx.moveTo(px - d, yy + h * 0.28); ctx.lineTo(px + d, yy + h * 0.5); ctx.lineTo(px - d, yy + h * 0.72); ctx.stroke();
        }
      } else if (k === 'fake') {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
          const cx = x + (w * i) / 4;
          ctx.beginPath(); ctx.moveTo(cx, yy); ctx.lineTo(cx - h * 0.3, yy + h * 0.5); ctx.lineTo(cx + h * 0.2, yy + h); ctx.stroke();
        }
      }
      ctx.restore();
      if (k === 'spike') {
        ctx.save();
        const n = Math.max(3, Math.round(w / (scale * 0.45)));
        const tw = w / n;
        const sg = ctx.createLinearGradient(0, y - scale * 0.5, 0, y);
        sg.addColorStop(0, '#FFE1DC'); sg.addColorStop(1, '#FF5E57');
        ctx.fillStyle = st.flash > 0 ? '#fff' : sg;
        ctx.shadowColor = '#FF5E57'; ctx.shadowBlur = 10 + 4 * Math.sin(t * 5);
        ctx.beginPath();
        for (let i = 0; i < n; i++) { ctx.moveTo(x + i * tw, y + 1); ctx.lineTo(x + i * tw + tw / 2, y - scale * 0.45); ctx.lineTo(x + (i + 1) * tw, y + 1); }
        ctx.fill(); ctx.restore();
      } else if (k === 'spring') {
        ctx.save();
        ctx.strokeStyle = '#FFE1DC'; ctx.lineWidth = 2;
        const coils = Math.max(2, Math.round(w / (scale * 1.2)));
        for (let i = 0; i < coils; i++) {
          const cx = x + w * (i + 0.5) / coils;
          ctx.beginPath();
          for (let j = 0; j <= 4; j++) ctx.lineTo(cx + (j % 2 ? 5 : -5), y + h + j * scale * 0.08 * (1 - st.squish * 0.5));
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    /* ---------- 角色：圓潤小朋友＋擠壓拉伸＋眨眼 ---------- */
    function drawKid(s, ch, t) {
      const p = s.player;
      const px = sx(p.x), py = sy(p.y, s);
      const w = C.PLAYER_W * scale, h = C.PLAYER_H * scale;
      if (p.invuln > 0 && Math.floor(t * 20) % 2 === 0) return;
      if (ch.sk_sprites && ch.sk_sprites.ready) { drawSpriteKid(s, ch, t); return; }
      let stretch = 1;
      if (!p.onStep) stretch = 1 + Math.max(-0.12, Math.min(0.15, p.vy * 0.012));
      const land = Math.max(0, 0.18 - (t - (p.landT || -9))) * 1.2;
      stretch -= land;
      const bw = w * (2 - stretch), bh = h * stretch;
      const running = p.onStep && p.moving;
      const bob = running ? Math.abs(Math.sin(t * 16)) * scale * 0.08 : 0;
      ctx.save();
      ctx.translate(px, py - bob);
      /* 腳下陰影 */
      if (p.onStep) { ctx.fillStyle = 'rgba(0,20,40,0.3)'; ctx.beginPath(); ctx.ellipse(0, bob + 2, bw * 0.55, scale * 0.12, 0, 0, 6.283); ctx.fill(); }
      ctx.scale(p.dir < 0 ? -1 : 1, 1);
      /* 腳 */
      const legSw = running ? Math.sin(t * 16) * bw * 0.18 : 0;
      ctx.fillStyle = ch.shoe;
      rr(-bw * 0.32 + legSw, -bh * 0.12, bw * 0.28, bh * 0.12, 4); ctx.fill();
      rr(bw * 0.06 - legSw, -bh * 0.12, bw * 0.28, bh * 0.12, 4); ctx.fill();
      /* 身體 */
      const bg = ctx.createLinearGradient(0, -bh * 0.55, 0, -bh * 0.1);
      bg.addColorStop(0, ch.body); bg.addColorStop(1, ch.bodyDark);
      ctx.fillStyle = bg;
      rr(-bw * 0.42, -bh * 0.56, bw * 0.84, bh * 0.46, bw * 0.3); ctx.fill();
      /* 圍巾 */
      ctx.fillStyle = ch.scarf;
      rr(-bw * 0.44, -bh * 0.6, bw * 0.88, bh * 0.08, 4); ctx.fill();
      const tail = Math.sin(t * 8) * 3 + (p.onStep ? 0 : -6);
      ctx.beginPath(); ctx.moveTo(-bw * 0.3, -bh * 0.56); ctx.lineTo(-bw * 0.65, -bh * 0.5 + tail); ctx.lineTo(-bw * 0.5, -bh * 0.44 + tail); ctx.closePath(); ctx.fill();
      /* 頭 */
      const hr = bw * 0.5;
      const hy = -bh * 0.6 - hr * 0.85;
      ctx.fillStyle = ch.skin;
      ctx.beginPath(); ctx.arc(0, hy, hr, 0, 6.283); ctx.fill();
      /* 頭髮 */
      ctx.fillStyle = ch.hair;
      ctx.beginPath(); ctx.arc(0, hy - hr * 0.1, hr * 1.04, Math.PI * 1.05, Math.PI * 1.95); ctx.closePath(); ctx.fill();
      if (ch.style === 'bun') { ctx.beginPath(); ctx.arc(-hr * 0.2, hy - hr * 1.05, hr * 0.38, 0, 6.283); ctx.fill(); }
      if (ch.style === 'twin') { for (const sd of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sd * hr * 1.0, hy + hr * 0.1, hr * 0.22, hr * 0.42, sd * 0.3, 0, 6.283); ctx.fill(); } }
      if (ch.style === 'cap') { ctx.fillStyle = ch.scarf; rr(-hr * 0.2, hy - hr * 0.62, hr * 1.4, hr * 0.22, 4); ctx.fill(); }
      if (ch.style === 'curl') { for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(i * hr * 0.4, hy - hr * 0.8, hr * 0.28, 0, 6.283); ctx.fill(); } }
      /* 臉 */
      const blink = (t % 3.2) < 0.12;
      const hurt = s.time - p.lastHurt < 0.4;
      ctx.fillStyle = '#1D2B3A';
      if (hurt) {
        ctx.strokeStyle = '#1D2B3A'; ctx.lineWidth = 2;
        for (const ex of [hr * 0.15, hr * 0.55]) { ctx.beginPath(); ctx.moveTo(ex - 3, hy - 3); ctx.lineTo(ex + 3, hy + 3); ctx.moveTo(ex + 3, hy - 3); ctx.lineTo(ex - 3, hy + 3); ctx.stroke(); }
      } else {
        for (const ex of [hr * 0.15, hr * 0.55]) {
          if (blink) ctx.fillRect(ex - 3, hy, 6, 1.5);
          else { ctx.beginPath(); ctx.ellipse(ex, hy, hr * 0.1, hr * 0.15, 0, 0, 6.283); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + 1, hy - 2, 1.3, 0, 6.283); ctx.fill(); ctx.fillStyle = '#1D2B3A'; }
        }
      }
      ctx.fillStyle = 'rgba(255,122,107,0.5)';
      ctx.beginPath(); ctx.ellipse(hr * 0.75, hy + hr * 0.32, hr * 0.14, hr * 0.08, 0, 0, 6.283); ctx.fill();
      ctx.restore();
    }

    /* ---------- AI 生成的黏土角色（sk_assets/<id>/*.png，idle 高度 256 為基準） ---------- */
    const SK_RUN_FPS = 12;
    function pickFrame(s, p, t) {
      if (s.time - p.lastHurt < 0.4) return 'hurt';
      if (!p.onStep) return p.vy < 0 ? 'run3' : 'fall';
      if (t - (p.landT || -9) < 0.12) return 'land';
      if (p.moving) return 'run' + (Math.floor(t * SK_RUN_FPS) % 4);
      return 'idle';
    }
    function drawSpriteKid(s, ch, t) {
      const p = s.player;
      const name = pickFrame(s, p, t);
      const img = ch.sk_sprites.frames[name] || ch.sk_sprites.frames.idle;
      const target = C.PLAYER_H * scale * 1.35;             /* idle 的畫面高度：比判定框略高，頭大比較可愛 */
      const k = target / 256;
      let dw = img.naturalWidth * k, dh = img.naturalHeight * k;
      /* 擠壓拉伸：落地壓扁、彈起拉長；站著時微微呼吸 */
      let sq = 1;
      if (!p.onStep) sq = 1 + Math.max(-0.08, Math.min(0.1, -p.vy * 0.008));
      sq -= Math.max(0, 0.16 - (t - (p.landT || -9))) * 0.9;
      if (name === 'idle') sq += Math.sin(t * 3) * 0.015;
      dw *= 2 - sq; dh *= sq;
      const running = name.indexOf('run') === 0 && p.onStep;
      const bob = running ? Math.abs(Math.sin(t * SK_RUN_FPS * Math.PI / 2)) * scale * 0.1 : 0;
      ctx.save();
      ctx.translate(sx(p.x), sy(p.y, s));
      if (p.onStep) {
        ctx.fillStyle = 'rgba(0,20,40,0.3)';
        ctx.beginPath(); ctx.ellipse(0, 2, (running ? 0.55 : 0.6) * scale, scale * 0.13, 0, 0, 6.283); ctx.fill();
      }
      ctx.translate(0, -bob);
      if (p.dir < 0) ctx.scale(-1, 1);
      if (running) ctx.rotate(0.07);                        /* 跑步前傾 */
      ctx.drawImage(img, -dw / 2, -dh, dw, dh);
      ctx.restore();
    }

    /* ---------- 粒子 ---------- */
    function burst(x, y, n, color, opt) {
      opt = opt || {};
      for (let i = 0; i < n; i++) {
        const a = opt.up ? -Math.PI / 2 + (Math.random() - 0.5) * 2.4 : Math.random() * 6.283;
        const sp = (opt.speed || 3) * (0.4 + Math.random());
        particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: opt.life || 0.6, max: opt.life || 0.6,
          r: (opt.size || 0.12) * (0.6 + Math.random()), color, g: opt.g != null ? opt.g : 8, shape: opt.shape || 'dot' });
      }
    }
    function onEvents(evs, s, t) {
      for (const e of evs) {
        if (e.type === 'land') { burst(e.x, e.y, 8, 'rgba(255,255,255,0.8)', { up: true, speed: 2.5, life: 0.4 }); s.player.landT = t; }
        else if (e.type === 'heal') burst(e.x, e.y - 2.4, 1, '#FF8FA3', { up: true, speed: 1, life: 0.9, g: -1, size: 0.35, shape: 'heart' });
        else if (e.type === 'spring') { burst(e.x, e.y, 14, '#FFE1DC', { up: true, speed: 5, life: 0.5 }); }
        else if (e.type === 'spikeLand' || e.type === 'ceiling') { burst(e.x, e.y, 6, '#FF7A6B', { speed: 4, life: 0.35, g: 0 }); }
        else if (e.type === 'hurt') { shake = 0.25; flash = 0.25; burst(e.x, e.y - 1, 16, '#FF5E57', { speed: 5, life: 0.5 }); }
        else if (e.type === 'crumble') {
          for (let x = e.x0; x < e.x1; x += 0.4) burst(x, e.y + 0.2, 1, 'rgba(255,255,255,0.7)', { speed: 1.5, life: 0.9, size: 0.2, shape: 'shard' });
        } else if (e.type === 'world') { worldFade = 1; }
      }
    }
    function drawParticles(s, dt) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const q = particles[i];
        q.life -= dt;
        if (q.life <= 0) { particles.splice(i, 1); continue; }
        q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt;
        ctx.globalAlpha = Math.max(0, q.life / q.max);
        ctx.fillStyle = q.color;
        const x = sx(q.x), y = sy(q.y, s), r = q.r * scale;
        if (q.shape === 'heart') { ctx.font = `${r * 2}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('♥', x, y); }
        else if (q.shape === 'shard') { ctx.save(); ctx.translate(x, y); ctx.rotate(q.life * 8); ctx.fillRect(-r, -r / 2, r * 2, r); ctx.restore(); }
        else { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }

    function draw(s, ch, t, dt) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layout(s);
      if (s.world !== prevWorld) { prevWorld = s.world; }
      drawBg(s, t);
      ctx.save();
      if (shake > 0) { shake -= dt; ctx.translate((Math.random() - 0.5) * 10 * shake * 4, (Math.random() - 0.5) * 10 * shake * 4); }
      drawField(s, t);
      ctx.save();
      ctx.beginPath(); ctx.rect(sx(0) - 2, oy, C.FIELD_W * scale + 4, viewH * scale); ctx.clip();
      for (const st of s.steps) drawStep(st, s, t);
      if (s.player.alive || s.cause !== 'fall') drawKid(s, ch, t);
      drawParticles(s, dt);
      ctx.restore();
      ctx.restore();
      if (flash > 0) { flash -= dt; ctx.fillStyle = `rgba(255,94,87,${flash * 0.9})`; ctx.fillRect(0, 0, W, H); }
      if (worldFade > 0) { worldFade -= dt * 0.8; ctx.fillStyle = `rgba(255,255,255,${Math.max(0, worldFade) * 0.35})`; ctx.fillRect(0, 0, W, H); }
    }

    /* 選角畫面的小預覽 */
    function preview(ch, t, moving) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      scale = H / 2.9; ox = W / 2; oy = H - 4;
      const fake = { cameraTop: 0, time: 0, player: { x: 0, y: 0, dir: 1, onStep: {}, vx: 0, vy: 0, invuln: 0, lastHurt: -9, moving: !!moving } };
      drawKid(fake, ch, t);
    }

    resize();
    return { resize, draw, onEvents, preview, sk_viewHFor, size: () => ({ w: W, h: H }), worldName: s => worldOf(s).name };
  }

  root.sk_Render = { sk_createRenderer, sk_WORLDS };
})(typeof self !== 'undefined' ? self : this);
