// cb-engine.js — 貓咪紙箱 物理/規則引擎(不碰 DOM,Node 也能跑)
(function (cb_root) {
  const CB_COLS = 36, CB_ROWS = 60;
  const CB_T = { EMPTY: 0, WALL: 1, WATER: 2, LAVA: 3, ROCK: 4, PIN: 5 };
  const CB_SIZE = { cat: [5, 5], box: [6, 4], dog: [6, 5] };
  const CB_ROCK_KILL_FALL = 3;   // 石頭至少掉 3 格才砸得死狗
  const CB_IDLE_LIMIT = 75;      // 全部插銷拔完後靜止 2.5 秒 → 卡關

  function cbRng(cb_seed) {
    let s = cb_seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  function cbCreateGame(cb_level) {
    const n = CB_COLS * CB_ROWS;
    const g = {
      grid: new Uint8Array(n), fall: new Uint8Array(n), upd: new Uint8Array(n), flow: new Int8Array(n),
      pinAt: new Int16Array(n).fill(-1), occ: new Int16Array(n).fill(-1),
      wallRects: [], pins: [], ents: [], events: [],
      tick: 0, idle: 0, state: 'play', reason: '', pulls: 0, rand: cbRng(cb_level.seed || 7),
    };
    const fill = (rects, t) => (rects || []).forEach(([x, y, w, h]) => {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        if (xx >= 0 && yy >= 0 && xx < CB_COLS && yy < CB_ROWS) g.grid[yy * CB_COLS + xx] = t;
      }
    });
    const walls = [[0, 0, CB_COLS, 1], [0, CB_ROWS - 1, CB_COLS, 1], [0, 0, 1, CB_ROWS], [CB_COLS - 1, 0, 1, CB_ROWS]]
      .concat(cb_level.walls || []);
    g.wallRects = walls;
    fill(walls, CB_T.WALL);
    fill(cb_level.water, CB_T.WATER);
    fill(cb_level.lava, CB_T.LAVA);
    fill(cb_level.rock, CB_T.ROCK);
    (cb_level.pins || []).forEach((p, id) => {
      const pin = { id, x: p.x, y: p.y, len: p.len, dir: p.dir || 'h', handle: p.handle || (p.dir === 'v' ? 't' : 'r'), pulled: false, anim: 0 };
      cbPinCells(pin).forEach((i) => { g.grid[i] = CB_T.PIN; g.pinAt[i] = id; });
      g.pins.push(pin);
    });
    const addEnt = (kind, [x, y]) => {
      const [w, h] = CB_SIZE[kind];
      g.ents.push({ id: g.ents.length, kind, x, y, w, h, alive: true, grounded: false, face: kind === 'dog' ? -1 : 1, walking: false, fallDist: 0 });
    };
    addEnt('box', cb_level.box);
    (cb_level.dogs || []).forEach((d) => addEnt('dog', d));
    addEnt('cat', cb_level.cat);
    g.cat = g.ents[g.ents.length - 1];
    g.box = g.ents[0];
    return g;
  }

  function cbPinCells(pin) {
    const out = [];
    for (let k = 0; k < pin.len; k++) {
      const x = pin.dir === 'h' ? pin.x + k : pin.x, y = pin.dir === 'h' ? pin.y : pin.y + k;
      out.push(y * CB_COLS + x);
    }
    return out;
  }

  // 拉環中心(格子座標),夾在畫面內避免被切掉
  function cbPinHandle(pin) {
    const horiz = pin.dir === 'h', x1 = horiz ? pin.x + pin.len : pin.x + 1, y1 = horiz ? pin.y + 1 : pin.y + pin.len;
    let hx = pin.handle === 'r' ? x1 + 1.3 : pin.handle === 'l' ? pin.x - 1.3 : pin.x + 0.5;
    let hy = pin.handle === 't' ? pin.y - 1.3 : pin.handle === 'b' ? y1 + 1.3 : pin.y + 0.5;
    hx = Math.max(1.6, Math.min(CB_COLS - 1.6, hx));
    hy = Math.max(1.6, Math.min(CB_ROWS - 1.6, hy));
    return [hx, hy];
  }

  function cbPull(g, cb_id) {
    const pin = g.pins[cb_id];
    if (!pin || pin.pulled || g.state !== 'play') return false;
    pin.pulled = true;
    cbPinCells(pin).forEach((i) => { if (g.grid[i] === CB_T.PIN) g.grid[i] = CB_T.EMPTY; g.pinAt[i] = -1; });
    g.pulls++;
    g.idle = 0;
    return true;
  }

  function cbBuildOcc(g) {
    g.occ.fill(-1);
    g.ents.forEach((e) => {
      if (!e.alive) return;
      for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) {
        if (x >= 0 && y >= 0 && x < CB_COLS && y < CB_ROWS) g.occ[y * CB_COLS + x] = e.id;
      }
    });
  }

  // ---------- 粒子:水 / 岩漿 / 石頭 ----------
  function cbStepParticles(g) {
    const { grid, fall, upd, occ, flow } = g;
    upd.fill(0);
    const free = (x, y) => x > 0 && x < CB_COLS - 1 && y > 0 && y < CB_ROWS - 1 &&
      grid[y * CB_COLS + x] === CB_T.EMPTY && occ[y * CB_COLS + x] < 0;
    const move = (i, j, vertical) => {
      grid[j] = grid[i]; fall[j] = fall[i]; flow[j] = flow[i]; grid[i] = CB_T.EMPTY; fall[i] = 0; flow[i] = 0; upd[j] = 1;
      if (vertical) g.active = true;
    };
    const ltr = g.tick % 2 === 0;
    for (let y = CB_ROWS - 2; y > 0; y--) {
      for (let k = 1; k < CB_COLS - 1; k++) {
        const x = ltr ? k : CB_COLS - 1 - k, i = y * CB_COLS + x, t = grid[i];
        if (upd[i] || (t !== CB_T.WATER && t !== CB_T.LAVA && t !== CB_T.ROCK)) continue;
        if (t === CB_T.LAVA && g.tick % 2) continue;           // 岩漿黏稠:隔 tick 才動
        const below = i + CB_COLS;
        if (free(x, y + 1)) { fall[i] = Math.min(255, fall[i] + 1); move(i, below, true); continue; }
        if (t === CB_T.ROCK && occ[below] < 0 && (grid[below] === CB_T.WATER || grid[below] === CB_T.LAVA) && !upd[below]) {
          const o = grid[below]; grid[below] = CB_T.ROCK; fall[below] = 0; grid[i] = o; fall[i] = 0; upd[below] = 1; g.active = true; continue;
        }
        if (t === CB_T.ROCK && occ[below] >= 0 && fall[i] >= CB_ROCK_KILL_FALL) {
          const e = g.ents[occ[below]];
          if (e.kind === 'dog' && e.alive) cbKill(g, e, 'crush');
        }
        const d = g.rand() < 0.5 ? -1 : 1;
        if (free(x + d, y + 1) && free(x + d, y)) { fall[i] = Math.min(255, fall[i] + 1); move(i, below + d, true); continue; }
        if (free(x - d, y + 1) && free(x - d, y)) { fall[i] = Math.min(255, fall[i] + 1); move(i, below - d, true); continue; }
        fall[i] = 0;
        if (t === CB_T.ROCK) continue;
        const reach = t === CB_T.WATER ? 3 : 1;
        const fd = flow[i] || d;                                 // 流動慣性:沿原方向流,碰壁才回頭
        for (const dd of [fd, -fd]) {
          let tx = x;
          for (let r = 1; r <= reach && free(x + dd * r, y); r++) tx = x + dd * r;
          if (tx !== x) { flow[i] = dd; move(i, y * CB_COLS + tx, false); break; }
        }
      }
    }
  }

  // 濕石頭:跟水相連的石頭群,會讓貼著的岩漿慢慢冷卻(避免岩漿被石頭蓋住永遠不冷)
  function cbWetRock(g) {
    const { grid } = g, wet = g.wet || (g.wet = new Uint8Array(grid.length)), q = [];
    wet.fill(0);
    for (let i = CB_COLS; i < grid.length - CB_COLS; i++) {
      if (grid[i] !== CB_T.ROCK) continue;
      if (grid[i - 1] === CB_T.WATER || grid[i + 1] === CB_T.WATER || grid[i - CB_COLS] === CB_T.WATER || grid[i + CB_COLS] === CB_T.WATER) { wet[i] = 1; q.push(i); }
    }
    while (q.length) {
      const i = q.pop();
      for (const j of [i - 1, i + 1, i - CB_COLS, i + CB_COLS]) if (grid[j] === CB_T.ROCK && !wet[j]) { wet[j] = 1; q.push(j); }
    }
    return wet;
  }

  function cbReact(g) {
    const { grid, occ } = g;
    const wet = cbWetRock(g);
    for (let y = 1; y < CB_ROWS - 1; y++) for (let x = 1; x < CB_COLS - 1; x++) {
      const i = y * CB_COLS + x;
      if (grid[i] !== CB_T.LAVA) continue;
      for (const j of [i - 1, i + 1, i - CB_COLS, i + CB_COLS]) {
        if (wet[j] && g.rand() < 0.08) { grid[i] = CB_T.ROCK; g.fall[i] = 0; g.active = true; break; }
        if (grid[j] === CB_T.WATER) {
          grid[i] = CB_T.ROCK; g.fall[i] = 0; grid[j] = CB_T.EMPTY; g.active = true;
          if (g.rand() < 0.15) g.events.push({ type: 'steam', x, y });
          break;
        }
        if (occ[j] >= 0) {
          const e = g.ents[occ[j]];
          if (!e.alive) continue;
          if (e.kind === 'dog') cbKill(g, e, 'burn');
          else if (e.kind === 'cat') cbLose(g, 'cat_burn');
          else if (e.kind === 'box') { cbLose(g, 'box_burn'); e.burnt = true; }
        }
      }
    }
  }

  function cbKill(g, e, how) {
    e.alive = false; g.active = true;
    g.events.push({ type: 'dogdie', how, x: e.x + e.w / 2, y: e.y + e.h / 2 });
  }

  function cbLose(g, reason) {
    if (g.state !== 'play') return;
    g.state = 'lose'; g.reason = reason;
  }

  // ---------- 角色:掉落 + 走路 ----------
  function cbSolidFor(g, e, x, y) {
    if (x < 0 || y < 0 || x >= CB_COLS || y >= CB_ROWS) return true;
    const i = y * CB_COLS + x, t = g.grid[i];
    if (t === CB_T.WALL || t === CB_T.PIN || t === CB_T.ROCK) return true;
    return g.occ[i] >= 0 && g.occ[i] !== e.id;
  }

  function cbDisplace(g, e) {
    // 角色佔到的格子若有液體,往上推到角色頭頂第一個空格
    for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) {
      const i = y * CB_COLS + x, t = g.grid[i];
      if (t !== CB_T.WATER && t !== CB_T.LAVA) continue;
      g.grid[i] = CB_T.EMPTY;
      for (let yy = e.y - 1; yy > 0; yy--) {
        const j = yy * CB_COLS + x;
        if (g.grid[j] === CB_T.EMPTY && g.occ[j] < 0) { g.grid[j] = t; break; }
        if (g.grid[j] === CB_T.WALL || g.grid[j] === CB_T.PIN) break;
      }
      if (t === CB_T.LAVA) {
        if (e.kind === 'cat') cbLose(g, 'cat_burn');
        else if (e.kind === 'box') { cbLose(g, 'box_burn'); e.burnt = true; }
        else cbKill(g, e, 'burn');
      }
    }
  }

  function cbSetOcc(g, e, val) {
    for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) g.occ[y * CB_COLS + x] = val;
  }

  function cbTryMove(g, e, dx, dy) {
    for (let y = e.y + dy; y < e.y + dy + e.h; y++) for (let x = e.x + dx; x < e.x + dx + e.w; x++) {
      if (cbSolidFor(g, e, x, y)) return false;
    }
    cbSetOcc(g, e, -1);
    e.x += dx; e.y += dy;
    cbSetOcc(g, e, e.id);
    cbDisplace(g, e);
    g.active = true;
    return true;
  }

  function cbStepEntities(g) {
    g.ents.forEach((e) => {
      if (!e.alive) return;
      e.walking = false;
      let grounded = false;
      for (let x = e.x; x < e.x + e.w; x++) if (cbSolidFor(g, e, x, e.y + e.h)) { grounded = true; break; }
      e.grounded = grounded;
      if (!grounded) { cbTryMove(g, e, 0, 1); e.fallDist++; return; }
      e.fallDist = 0;
      if (g.state !== 'play' || e.kind === 'box') return;
      const tgt = e.kind === 'cat' ? g.box : g.cat;
      const tol = e.kind === 'cat' ? 12 : 3;
      if (!tgt.alive || !tgt.grounded || Math.abs((tgt.y + tgt.h) - (e.y + e.h)) > tol) return;
      if (cbNear(e, tgt, 1) || !cbSees(g, e, tgt)) return;
      const every = e.kind === 'cat' ? 2 : 3;
      if (g.tick % every) return;
      const dir = tgt.x + tgt.w / 2 > e.x + e.w / 2 ? 1 : -1;
      e.face = dir;
      const climb = e.kind === 'cat' ? 3 : 1;           // 貓比較會爬
      for (let up = 0; up <= climb; up++) if (cbTryMove(g, e, dir, -up)) { e.walking = true; break; }
    });
  }

  // 視線:兩者之間(腳邊往上 2 格那一列)沒有牆或插銷
  function cbSees(g, a, b) {
    const row = a.y + a.h - 2;
    const x0 = Math.min(a.x + a.w, b.x + b.w), x1 = Math.max(a.x, b.x);
    for (let x = x0; x < x1; x++) {
      const t = g.grid[row * CB_COLS + x];
      if (t === CB_T.WALL || t === CB_T.PIN) return false;
    }
    return true;
  }

  function cbNear(a, b, gap) {
    return a.x - gap < b.x + b.w && b.x - gap < a.x + a.w && a.y - gap < b.y + b.h && b.y - gap < a.y + a.h;
  }

  function cbCheckEnd(g) {
    if (g.state !== 'play') return;
    const cat = g.cat, box = g.box;
    if (cat.alive && box.alive && cbNear(cat, box, 1) && cat.grounded) {
      g.state = 'win'; g.winTick = g.tick; return;
    }
    if (g.ents.some((e) => e.kind === 'dog' && e.alive && cbNear(e, cat, 1))) { cbLose(g, 'dog'); return; }
    g.idle = g.active ? 0 : g.idle + 1;
    if (g.idle > CB_IDLE_LIMIT && g.pins.every((p) => p.pulled)) cbLose(g, 'stuck');
  }

  function cbStep(g) {
    g.tick++;
    g.active = false;
    cbBuildOcc(g);
    cbStepParticles(g);
    cbReact(g);
    cbBuildOcc(g);
    if (g.state === 'play' || g.state === 'win') cbStepEntities(g);
    g.pins.forEach((p) => { if (p.pulled && p.anim < 1) p.anim = Math.min(1, p.anim + 0.12); });
    cbCheckEnd(g);
  }

  const api = { CB_COLS, CB_ROWS, CB_T, CB_SIZE, cbCreateGame, cbPull, cbStep, cbPinCells, cbPinHandle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else cb_root.CB_ENGINE = api;
})(typeof window !== 'undefined' ? window : globalThis);
