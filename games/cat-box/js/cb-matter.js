// cb-matter.js — 水 / 岩漿 / 石頭 質感繪製(連續液面、深度漸層、波光、氣泡、火星、石塊光影)
(function (cb_root) {
  const { CB_COLS, CB_ROWS, CB_T } = cb_root.CB_ENGINE;
  const CB_WATER = ['#D6FDFF', '#A8F4FC', '#86E6F4', '#6AD6EA', '#55C5DE'];   // 表面 → 深處
  const CB_LAVA = ['#FFF1A8', '#FFD25E', '#FFA445', '#FF7A3D', '#E5532F'];
  const CB_ROCK = ['#CDBEDD', '#BFAED3', '#D8CCE6', '#C4B4D8'];
  const CB_ROCK_WET = ['#AF9CC7', '#A28EBD', '#B9A8D0', '#A996C2'];
  const bubbles = [], embers = [];
  let depth = null;

  const hash = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

  // 每格往上數同種物質的格數 = 深度(0 = 表面)
  function cbDepth(grid) {
    depth = depth || new Uint8Array(grid.length);
    for (let x = 0; x < CB_COLS; x++) {
      let run = 0, prev = -1;
      for (let y = 0; y < CB_ROWS; y++) {
        const i = y * CB_COLS + x, t = grid[i];
        run = t === prev ? Math.min(run + 1, 255) : 0;
        depth[i] = run; prev = t;
      }
    }
    return depth;
  }

  function cbDrawMatter(ctx, g, s, now) {
    const grid = g.grid, d = cbDepth(grid), wet = g.wet, ov = s * 0.08;

    // ---- 岩漿光暈(畫在最底下) ----
    ctx.fillStyle = 'rgba(255,150,70,.16)';
    for (let i = CB_COLS; i < grid.length - CB_COLS; i += 2) {
      if (grid[i] !== CB_T.LAVA || d[i] > 1) continue;
      const x = i % CB_COLS, y = (i / CB_COLS) | 0;
      ctx.beginPath(); ctx.arc((x + 0.5) * s, (y + 0.5) * s, s * (2 + Math.sin(now / 280 + x) * 0.4), 0, 7); ctx.fill();
    }

    for (let y = 1; y < CB_ROWS - 1; y++) for (let x = 1; x < CB_COLS - 1; x++) {
      const i = y * CB_COLS + x, t = grid[i];
      if (t === CB_T.WATER) {
        ctx.fillStyle = CB_WATER[Math.min(d[i], 4)];
        cbCell(ctx, grid, i, x, y, s, ov, t);
        if (d[i] >= 2 && (hash(x, y) + (now / 400 | 0)) % 23 === 0) {   // 水底光斑
          ctx.fillStyle = 'rgba(255,255,255,.55)';
          ctx.fillRect(x * s + s * 0.2, y * s + s * 0.4, s * 0.6, s * 0.15);
        }
        if (Math.random() < 0.0015 && d[i] >= 3) bubbles.push({ x: x + 0.5, y: y + 0.5, born: now, r: 0.18 + Math.random() * 0.2 });
      } else if (t === CB_T.LAVA) {
        ctx.fillStyle = CB_LAVA[Math.min(d[i], 4)];
        cbCell(ctx, grid, i, x, y, s, ov, t);
        const n = Math.sin(x * 1.7 + now / 520) + Math.sin(y * 2.3 - now / 610) + Math.sin((x + y) * 0.9 + now / 800);
        if (d[i] >= 2 && n > 1.5) {   // 冷卻中的暗色硬殼,緩慢流動
          ctx.fillStyle = 'rgba(150,45,25,.3)';
          ctx.beginPath(); ctx.arc((x + 0.5) * s, (y + 0.5) * s, s * (0.35 + (n - 1.5) * 0.4), 0, 7); ctx.fill();
        }
        if (d[i] === 0 && Math.random() < 0.012) embers.push({ x: x + Math.random(), y, born: now, vx: (Math.random() - 0.5) * 1.5 });
      } else if (t === CB_T.ROCK) {
        cbRock(ctx, grid, x, y, i, s, wet && wet[i]);
      }
    }

    // ---- 液面:波浪亮線 ----
    for (let y = 1; y < CB_ROWS - 1; y++) for (let x = 1; x < CB_COLS - 1; x++) {
      const i = y * CB_COLS + x, t = grid[i];
      if ((t !== CB_T.WATER && t !== CB_T.LAVA) || d[i] !== 0 || grid[i - CB_COLS] === t) continue;
      const wav = Math.sin(now / (t === CB_T.WATER ? 260 : 520) + x * 0.9) * 0.25;
      ctx.strokeStyle = t === CB_T.WATER ? 'rgba(255,255,255,.9)' : 'rgba(255,250,210,.95)';
      ctx.lineWidth = s * 0.16;
      ctx.beginPath(); ctx.arc((x + 0.5) * s, (y + 0.55) * s, s * 0.4, Math.PI * (1.2 + wav * 0.2), Math.PI * (1.75 + wav * 0.2)); ctx.stroke();
    }

    cbBubbles(ctx, g, s, now);
    cbEmbers(ctx, s, now);
  }

  // 石塊:圓角方塊 + 左上受光 + 右下陰影;泡到水的變深色、有反光
  function cbRock(ctx, grid, x, y, i, s, isWet) {
    const h = hash(x, y), pal = isWet ? CB_ROCK_WET : CB_ROCK;
    const jx = ((h >> 3) % 7 - 3) * s * 0.025, jy = ((h >> 6) % 5 - 2) * s * 0.02;
    const px = x * s + jx, py = y * s + jy, k = s * (1.02 + (h % 5) * 0.035), r = k * 0.42, o = (k - s) / 2;
    ctx.fillStyle = pal[h % 4];
    ctx.beginPath();
    ctx.moveTo(px - o + r, py - o); ctx.arcTo(px - o + k, py - o, px - o + k, py - o + k, r);
    ctx.arcTo(px - o + k, py - o + k, px - o, py - o + k, r); ctx.arcTo(px - o, py - o + k, px - o, py - o, r);
    ctx.arcTo(px - o, py - o, px - o + k, py - o, r); ctx.fill();
    ctx.fillStyle = 'rgba(90,60,110,.25)';   // 右下陰影
    ctx.beginPath(); ctx.ellipse(px + s * 0.6, py + s * 0.7, s * 0.36, s * 0.22, 0, 0, 7); ctx.fill();
    ctx.fillStyle = isWet ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.5)';   // 左上受光(泡水的更亮)
    ctx.beginPath(); ctx.ellipse(px + s * 0.34, py + s * 0.28, s * 0.17, s * 0.1, -0.5, 0, 7); ctx.fill();
    if (grid[i - CB_COLS] !== CB_T.ROCK) {   // 露在最上面的石頭:亮邊
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.fillRect(px, py, s, s * 0.12);
    }
  }

  // 液體格:內部方塊互相重疊成連續一片;表面格頂端做成圓弧,相鄰的連成波浪
  function cbCell(ctx, grid, i, x, y, s, ov, t) {
    if (grid[i - CB_COLS] === t) { ctx.fillRect(x * s - ov, y * s - ov, s + ov * 2, s + ov * 2); return; }
    const alone = grid[i - 1] !== t && grid[i + 1] !== t && grid[i + CB_COLS] !== t;
    ctx.beginPath(); ctx.arc((x + 0.5) * s, (y + 0.5) * s, s * (alone ? 0.5 : 0.56), 0, 7); ctx.fill();
    if (!alone) ctx.fillRect(x * s - ov, (y + 0.5) * s, s + ov * 2, s * 0.5 + ov);
  }

  function cbBubbles(ctx, g, s, now) {
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(1, s * 0.08);
    for (let k = bubbles.length - 1; k >= 0; k--) {
      const b = bubbles[k], t = (now - b.born) / 1000;
      const by = b.y - t * 4, bx = b.x + Math.sin(t * 6 + b.r * 10) * 0.2;
      const cell = g.grid[Math.floor(by) * CB_COLS + Math.floor(bx)];
      if (t > 3 || cell !== CB_T.WATER) { bubbles.splice(k, 1); continue; }
      ctx.beginPath(); ctx.arc(bx * s, by * s, b.r * s, 0, 7); ctx.stroke();
    }
    if (bubbles.length > 40) bubbles.splice(0, bubbles.length - 40);
  }

  function cbEmbers(ctx, s, now) {
    for (let k = embers.length - 1; k >= 0; k--) {
      const e = embers[k], t = (now - e.born) / 900;
      if (t >= 1) { embers.splice(k, 1); continue; }
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = t < 0.4 ? '#FFF1A8' : '#FF9A4A';
      ctx.beginPath(); ctx.arc((e.x + e.vx * t) * s, (e.y - t * 3) * s, s * (0.22 - t * 0.12), 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (embers.length > 60) embers.splice(0, embers.length - 60);
  }

  cb_root.CB_MATTER = { cbDrawMatter };
})(window);
