// cb-draw.js — Canvas 繪圖(配色 C:糖果夢幻)
(function (cb_root) {
  const { CB_COLS, CB_ROWS, CB_T } = cb_root.CB_ENGINE;
  const CB_COLOR = {
    bg: '#FFF5E1', dot: '#FFE4C7', wall: '#FFC8D6', wallEdge: '#FF8FAB',
    water: '#9BF6FF', waterDeep: '#5FD8EA', lava: '#FF7A59', lavaHot: '#FFC15E',
    rock: '#C9B8DA', rockEdge: '#A894C0', pin: '#FFD86B', pinEdge: '#E0A83A',
    box: '#E8B87E', boxDark: '#C98F52', tape: '#F6DDB3', cat: '#FFFFFF', catPatch: '#FFB27A',
    line: '#5A4A5E', pink: '#FF8FAB', dog: '#C99266', dogDark: '#8A5A3B',
  };
  const fx = [];
  const SP = () => cb_root.CB_SPRITES;
  let cb_now = 0, cb_shakeUntil = 0;

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function cbDraw(ctx, g, s, now) {
    const W = CB_COLS * s, H = CB_ROWS * s;
    cb_now = now;
    ctx.fillStyle = CB_COLOR.bg; ctx.fillRect(0, 0, W, H);
    const sp = SP() && SP().CB_SP;
    if (sp && sp.bg) {   // 背景圖 cover 鋪滿
      const k = Math.max(W / sp.bg.width, H / sp.bg.height), bw = sp.bg.width * k, bh = sp.bg.height * k;
      ctx.drawImage(sp.bg, (W - bw) / 2, (H - bh) / 2, bw, bh);
    }
    ctx.save();
    if (now < cb_shakeUntil) ctx.translate((Math.random() - 0.5) * s * 0.9, (Math.random() - 0.5) * s * 0.9);
    if (!(sp && sp.bg)) {
      ctx.fillStyle = CB_COLOR.dot;
      for (let y = 2; y < CB_ROWS; y += 4) for (let x = (y % 8 ? 2 : 4); x < CB_COLS; x += 4) {
        ctx.beginPath(); ctx.arc(x * s, y * s, s * 0.25, 0, 7); ctx.fill();
      }
    }
    const wallFill = cbWallPattern(ctx, sp, s);
    drawParticles(ctx, g, s, now);
    g.wallRects.forEach(([x, y, w, h]) => {
      rr(ctx, x * s, y * s, w * s, h * s, Math.min(w, h) * s * 0.45);
      ctx.fillStyle = wallFill; ctx.fill();
      ctx.lineWidth = Math.max(1, s * 0.18); ctx.strokeStyle = CB_COLOR.wallEdge; ctx.stroke();
    });
    g.pins.forEach((p) => drawPin(ctx, p, s));
    g.ents.forEach((e) => {
      e.rx = e.rx == null ? e.x : e.rx + (e.x - e.rx) * 0.45;
      e.ry = e.ry == null ? e.y : e.ry + (e.y - e.ry) * 0.45;
    });
    const box = g.box, cat = g.cat;
    g.ents.filter((e) => e.kind === 'dog').forEach((e) => drawDog(ctx, e, s, now, g));
    const hiding = g.state === 'win' ? Math.min(1, (g.tick - g.winTick) / 25) : 0;
    if (g.state === 'win' && SP() && SP().CB_SP.ready) { drawBox(ctx, box, s, true); drawCat(ctx, cat, s, now, g, hiding, box); }
    else if (g.state === 'win') { drawCat(ctx, cat, s, now, g, hiding, box); drawBox(ctx, box, s, true); }
    else { drawBox(ctx, box, s, false); drawCat(ctx, cat, s, now, g, 0, box); }
    while (g.events.length) {
      const ev = g.events.shift();
      if (ev.type === 'dogdie') cb_shakeUntil = now + 320;
      fx.push({ ...ev, born: now });
    }
    if (SP()) SP().cbSpriteDust(ctx, s, now);
    drawFx(ctx, s, now);
    ctx.restore();
    if (g.state === 'win' && hiding >= 1) drawHearts(ctx, box, s, now - (g.winAt || (g.winAt = now)));
  }

  // 磚牆貼圖:一排磚約 0.9 格高;沒圖就用純色
  let cb_pat = null, cb_patS = 0;
  function cbWallPattern(ctx, sp, s) {
    if (!sp || !sp.wall || typeof DOMMatrix === 'undefined') return CB_COLOR.wall;
    if (!cb_pat || cb_patS !== s) {
      cb_pat = ctx.createPattern(sp.wall, 'repeat');
      const k = (s * 0.9) / (sp.wall.height / 10);
      if (cb_pat.setTransform) cb_pat.setTransform(new DOMMatrix().scaleSelf(k, k));
      cb_patS = s;
    }
    return cb_pat;
  }

  function drawParticles(ctx, g, s, now) {
    const { grid } = g, k = s * 1.3, off = (k - s) / 2;
    ctx.fillStyle = 'rgba(255,170,90,.18)';   // 岩漿光暈
    for (let y = 1; y < CB_ROWS - 1; y++) for (let x = 1; x < CB_COLS - 1; x++) {
      if (grid[y * CB_COLS + x] !== CB_T.LAVA || (x + y) % 2) continue;
      ctx.beginPath(); ctx.arc((x + 0.5) * s, (y + 0.5) * s, s * (1.6 + Math.sin(now / 300 + x) * 0.3), 0, 7); ctx.fill();
    }
    for (let y = 1; y < CB_ROWS - 1; y++) for (let x = 1; x < CB_COLS - 1; x++) {
      const t = grid[y * CB_COLS + x];
      if (t !== CB_T.WATER && t !== CB_T.LAVA && t !== CB_T.ROCK) continue;
      if (t === CB_T.WATER) ctx.fillStyle = (x + y) % 3 ? CB_COLOR.water : CB_COLOR.waterDeep;
      else if (t === CB_T.LAVA) ctx.fillStyle = Math.sin(now / 180 + x * 0.9 + y * 0.6) > 0.3 ? CB_COLOR.lavaHot : CB_COLOR.lava;
      else ctx.fillStyle = (x * 7 + y * 3) % 5 ? CB_COLOR.rock : CB_COLOR.rockEdge;
      rr(ctx, x * s - off, y * s - off, k, k, k * (t === CB_T.ROCK ? 0.3 : 0.5));
      ctx.fill();
    }
  }

  function drawPin(ctx, p, s) {
    if (p.anim >= 1) return;
    const slide = p.anim * (p.len + 4) * s;
    const dx = p.handle === 'r' ? slide : p.handle === 'l' ? -slide : 0;
    const dy = p.handle === 'b' ? slide : p.handle === 't' ? -slide : 0;
    ctx.save(); ctx.globalAlpha = 1 - p.anim; ctx.translate(dx, dy);
    const th = s * 1.2, horiz = p.dir === 'h';
    const x = p.x * s, y = p.y * s, w = horiz ? p.len * s : s, h = horiz ? s : p.len * s;
    const bx = horiz ? x : x + (s - th) / 2, by = horiz ? y + (s - th) / 2 : y;
    rr(ctx, bx, by, horiz ? w : th, horiz ? th : h, th / 2);
    ctx.fillStyle = CB_COLOR.pin; ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.2); ctx.strokeStyle = CB_COLOR.pinEdge; ctx.stroke();
    const [hcx, hcy] = cb_root.CB_ENGINE.cbPinHandle(p), hx = hcx * s, hy = hcy * s;
    ctx.beginPath(); ctx.arc(hx, hy, s * 1.4, 0, 7);
    ctx.fillStyle = CB_COLOR.pin; ctx.fill(); ctx.lineWidth = s * 0.45; ctx.strokeStyle = CB_COLOR.pinEdge; ctx.stroke();
    ctx.beginPath(); ctx.arc(hx, hy, s * 0.6, 0, 7); ctx.fillStyle = CB_COLOR.bg; ctx.fill();
    ctx.restore();
  }

  function drawBox(ctx, e, s, front) {
    if (SP() && SP().cbSpriteBox(ctx, e, s, cb_now)) return;
    if (!e.alive && !e.burnt) return;
    const x = e.rx * s, y = e.ry * s, w = e.w * s, h = e.h * s;
    const body = e.burnt ? '#6B4A3A' : CB_COLOR.box, dark = e.burnt ? '#3E2A22' : CB_COLOR.boxDark;
    if (!front) {   // 後面的翻蓋
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - s, y - s * 1.2); ctx.lineTo(x + w * 0.4, y - s * 1.2); ctx.lineTo(x + w * 0.45, y); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w + s, y - s * 1.2); ctx.lineTo(x + w * 0.6, y - s * 1.2); ctx.lineTo(x + w * 0.55, y); ctx.fill();
    }
    rr(ctx, x, y + s * 0.2, w, h - s * 0.2, s * 0.35);
    ctx.fillStyle = body; ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.2); ctx.strokeStyle = dark; ctx.stroke();
    ctx.fillStyle = e.burnt ? dark : CB_COLOR.tape; ctx.fillRect(x + w * 0.42, y + s * 0.2, w * 0.16, h - s * 0.2);
    if (!e.burnt) {   // 小愛心貼紙
      ctx.fillStyle = CB_COLOR.pink; heart(ctx, x + w * 0.22, y + h * 0.58, s * 0.9);
    }
  }

  function drawCat(ctx, e, s, now, g, hiding, box) {
    if (SP() && SP().cbSpriteCat(ctx, e, s, now, g, hiding, box)) return;
    if (!e.alive) return;
    let cx = (e.rx + e.w / 2) * s, cy = (e.ry + e.h / 2) * s + s * 0.3;
    let sc = 1;
    if (hiding > 0) {
      const bx = (box.rx + box.w / 2) * s, by = (box.ry + box.h / 2) * s;
      cx += (bx - cx) * hiding; cy += (by - s - cy) * hiding + Math.sin(hiding * Math.PI) * -s * 3;
      sc = 1 - hiding * 0.15;
      if (hiding >= 1) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 1e4, box.ry * s + s * 0.6); ctx.clip(); }
    }
    const lost = g.state === 'lose' && (g.reason === 'cat_burn' || g.reason === 'dog');
    const bob = e.walking ? Math.sin(now / 70) * s * 0.25 : Math.sin(now / 400) * s * 0.1;
    const r = s * 2.3 * sc;
    ctx.save(); ctx.translate(cx, cy + bob); ctx.scale(e.face, 1);
    ctx.lineWidth = Math.max(1, s * 0.22); ctx.strokeStyle = CB_COLOR.line;
    ctx.beginPath(); ctx.moveTo(-r * 0.8, r * 0.5); ctx.quadraticCurveTo(-r * 1.6, r * 0.2, -r * 1.3, -r * 0.6 + Math.sin(now / 250) * r * 0.15);
    ctx.lineWidth = s * 0.7; ctx.strokeStyle = CB_COLOR.catPatch; ctx.stroke();
    ctx.lineWidth = Math.max(1, s * 0.22); ctx.strokeStyle = CB_COLOR.line;
    [[-0.75, -0.55], [0.75, -0.55]].forEach(([ex], idx) => {
      ctx.beginPath(); ctx.moveTo(ex * r - r * 0.35, -r * 0.45); ctx.lineTo(ex * r + (idx ? 0.15 : -0.15) * r, -r * 1.15); ctx.lineTo(ex * r + r * 0.35, -r * 0.6); ctx.closePath();
      ctx.fillStyle = idx ? CB_COLOR.cat : CB_COLOR.catPatch; ctx.fill(); ctx.stroke();
    });
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.85, 0, 0, 7); ctx.fillStyle = CB_COLOR.cat; ctx.fill(); ctx.stroke();
    ctx.save(); ctx.clip(); ctx.beginPath(); ctx.ellipse(-r * 0.75, -r * 0.5, r * 0.6, r * 0.5, 0.3, 0, 7); ctx.fillStyle = CB_COLOR.catPatch; ctx.fill(); ctx.restore();
    ctx.fillStyle = CB_COLOR.line;
    if (lost) {
      [-0.38, 0.38].forEach((ex) => { ctx.font = `bold ${r * 0.55}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('x', ex * r, r * 0.05); });
    } else {
      const blink = (now % 3200) < 120 ? 0.15 : 1;
      [-0.38, 0.38].forEach((ex) => { ctx.beginPath(); ctx.ellipse(ex * r, -r * 0.08, r * 0.11, r * 0.16 * blink, 0, 0, 7); ctx.fill(); });
    }
    ctx.fillStyle = CB_COLOR.pink; ctx.beginPath(); ctx.ellipse(0, r * 0.15, r * 0.1, r * 0.07, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,143,171,.45)';
    [-0.6, 0.6].forEach((ex) => { ctx.beginPath(); ctx.ellipse(ex * r, r * 0.25, r * 0.16, r * 0.1, 0, 0, 7); ctx.fill(); });
    ctx.strokeStyle = CB_COLOR.line; ctx.lineWidth = Math.max(1, s * 0.12);
    [-1, 1].forEach((side) => [-0.05, 0.1].forEach((dy) => {
      ctx.beginPath(); ctx.moveTo(side * r * 0.45, r * (0.22 + dy)); ctx.lineTo(side * r * 1.05, r * (0.15 + dy * 2)); ctx.stroke();
    }));
    ctx.restore();
    if (hiding >= 1) ctx.restore();
  }

  function drawDog(ctx, e, s, now, g) {
    if (SP() && SP().cbSpriteDog(ctx, e, s, now)) return;
    if (!e.alive) return;
    const cx = (e.rx + e.w / 2) * s, cy = (e.ry + e.h / 2) * s + s * 0.3;
    const r = s * 2.4, bob = e.walking ? Math.sin(now / 60) * s * 0.3 : 0;
    ctx.save(); ctx.translate(cx, cy + bob); ctx.scale(e.face, 1);
    ctx.lineWidth = Math.max(1, s * 0.22); ctx.strokeStyle = CB_COLOR.line;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 1.05, r * 0.85, 0, 0, 7); ctx.fillStyle = CB_COLOR.dog; ctx.fill(); ctx.stroke();
    [-1, 1].forEach((side) => {
      ctx.beginPath(); ctx.ellipse(side * r * 0.95, -r * 0.2, r * 0.28, r * 0.55, side * 0.35, 0, 7);
      ctx.fillStyle = CB_COLOR.dogDark; ctx.fill(); ctx.stroke();
    });
    ctx.beginPath(); ctx.ellipse(r * 0.35, r * 0.3, r * 0.5, r * 0.35, 0, 0, 7); ctx.fillStyle = '#F2D2B0'; ctx.fill();
    ctx.fillStyle = CB_COLOR.line;
    ctx.beginPath(); ctx.ellipse(r * 0.6, r * 0.18, r * 0.16, r * 0.11, 0, 0, 7); ctx.fill();
    [-0.15, 0.45].forEach((ex) => { ctx.beginPath(); ctx.arc(ex * r, -r * 0.2, r * 0.1, 0, 7); ctx.fill(); });
    ctx.lineWidth = Math.max(1, s * 0.25);   // 生氣的眉毛
    ctx.beginPath(); ctx.moveTo(-r * 0.32, -r * 0.48); ctx.lineTo(r * 0.0, -r * 0.36); ctx.moveTo(r * 0.62, -r * 0.48); ctx.lineTo(r * 0.3, -r * 0.36); ctx.stroke();
    ctx.restore();
  }

  function heart(ctx, x, y, size) {
    ctx.beginPath(); ctx.moveTo(x, y + size * 0.35);
    ctx.bezierCurveTo(x - size, y - size * 0.3, x - size * 0.4, y - size * 0.9, x, y - size * 0.35);
    ctx.bezierCurveTo(x + size * 0.4, y - size * 0.9, x + size, y - size * 0.3, x, y + size * 0.35);
    ctx.fill();
  }

  function drawHearts(ctx, box, s, dt) {
    const bx = (box.rx + box.w / 2) * s, by = box.ry * s;
    ctx.fillStyle = CB_COLOR.pink;
    for (let k = 0; k < 4; k++) {
      const t = ((dt / 1000) + k * 0.25) % 1;
      ctx.globalAlpha = 1 - t;
      heart(ctx, bx + Math.sin(k * 2 + t * 4) * s * 2.5, by - t * s * 8, s * (1 + k % 2 * 0.4));
    }
    ctx.globalAlpha = 1;
    if (SP() && SP().CB_SP.ready) return;   // 有圖片時貓頭本身會露出來
    ctx.fillStyle = CB_COLOR.catPatch;   // 箱子裡露出的耳朵
    [-0.9, 0.9].forEach((ex) => {
      ctx.beginPath(); ctx.moveTo(bx + ex * s - s * 0.7, by + s * 0.3); ctx.lineTo(bx + ex * s, by - s * 0.9); ctx.lineTo(bx + ex * s + s * 0.7, by + s * 0.3); ctx.fill();
    });
  }

  function drawFx(ctx, s, now) {
    for (let k = fx.length - 1; k >= 0; k--) {
      const f = fx[k], t = (now - f.born) / 700;
      if (t >= 1) { fx.splice(k, 1); continue; }
      ctx.globalAlpha = 1 - t;
      if (f.type === 'steam') {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath(); ctx.arc(f.x * s, (f.y - t * 4) * s, s * (0.8 + t * 1.5), 0, 7); ctx.fill();
      } else {
        ctx.fillStyle = '#FFE066';
        for (let a = 0; a < 6; a++) {
          const ang = a * 1.047 + t;
          ctx.beginPath(); ctx.arc((f.x + Math.cos(ang) * t * 5) * s, (f.y + Math.sin(ang) * t * 5) * s, s * 0.7, 0, 7); ctx.fill();
        }
        ctx.fillStyle = 'rgba(200,190,210,.8)';
        ctx.beginPath(); ctx.arc(f.x * s, f.y * s, s * (1 + t * 3), 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  cb_root.CB_DRAW = { cbDraw, CB_COLOR };
})(window);
