/* ===== sk_game.js — 規則核心：樓梯生成＋物理（純邏輯、無 DOM） =====
 * 數值照原作 stair-kids：場地 16 格、角色 1.25×2 格、1 格 = 1 公尺，y 往下為正、玩家 y 是腳底。
 */
(function (root) {
  'use strict';

  const sk_C = {
    STEP: 1 / 60,
    FIELD_W: 16, PLAYER_W: 1.25, PLAYER_H: 2.0,
    MOVE_SPEED: 6, GRAVITY: 30, MAX_FALL: 18,
    BELT_SPEED: 3, SPRING_VY: 9, CEIL_PUSH: 14,
    INVULN: 0.6, FAKE_DELAY: 0.25,
    CAMERA_LEAD: 8.5, CAMERA_CATCHUP: 8,
    MILESTONE: 100, WORLD_COUNT: 6,
    GAP_MIN: 2.6, GAP_MAX: 3.6, WIDTH_MIN: 3.2, WIDTH_MAX: 5.0,
    SPAWN_WIDTH: 8, WIDE_WIDTH: 6.2, WIDE_EVERY: 12, SAFE_WINDOW: 4,
    MIN_PASS: 2.5, TWO_STEP_CHANCE: 0.18, TWO_STEP_MAX_SEP: 6.4,
    BELT_RATE: 0.14, SPRING_RATE: 0.10,
    KEEP_ABOVE: 30, KEEP_BELOW: 30, COUNTDOWN: 2.0
  };

  const sk_DIFF = {
    baby:   { id: 'baby', name: '幼幼班', scroll: 1.2, every: 30, rate: 0.05, cap: 1.5, hp: 20, ceil: null, spike: 0, fake: 0, dmg: null, endless: true },
    easy:   { id: 'easy', name: '簡單', scroll: 1.8, every: 22, rate: 0.08, cap: 1.8, hp: 14, ceil: 1.2, spike: 0.06, fake: 0.06, dmg: { base: [1, 2], deep: [1, 3] } },
    normal: { id: 'normal', name: '普通', scroll: 2.8, every: 20, rate: 0.12, cap: 2.2, hp: 10, ceil: 0.6, spike: 0.15, fake: 0.14, dmg: { base: [1, 3], deep: [2, 4] } },
    hard:   { id: 'hard', name: '困難', scroll: 3.6, every: 18, rate: 0.15, cap: 2.6, hp: 9, ceil: 0.4, spike: 0.24, fake: 0.20, dmg: { base: [2, 3], deep: [3, 5] } }
  };

  const sk_clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /* mulberry32：可重現的亂數 */
  function sk_rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return { next, range: (lo, hi) => lo + (hi - lo) * next(), int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)) };
  }

  /* ---------- 樓梯生成：先算出可達的 x 範圍再抽，保證每層都走得到 ---------- */
  function sk_reachSpan(gap) {
    return Math.sqrt(2 * gap / sk_C.GRAVITY) * sk_C.MOVE_SPEED * 0.8;
  }

  function sk_createGen(seed, diff) {
    return { rng: sk_rng(seed), diff, layer: 0, depth: 0, prev: null, nextId: 1,
      run: { belt: 0, spring: 0, spike: 0, fake: 0 }, unsafeRun: 0 };
  }

  function sk_pickKind(gen, isWide, mustSafe) {
    if (isWide) return 'normal';
    const prevKinds = gen.prev ? gen.prev.steps.map(s => s.kind) : [];
    const items = [];
    const w = { belt: sk_C.BELT_RATE, spring: sk_C.SPRING_RATE, spike: gen.diff.spike, fake: gen.diff.fake };
    let special = 0;
    for (const k of ['belt', 'spring', 'spike', 'fake']) {
      if (mustSafe && k !== 'belt') continue;
      if (gen.run[k] >= 2 || w[k] <= 0) continue;
      if (k === 'spike' && prevKinds.indexOf('spike') >= 0) continue;
      items.push([k, w[k]]); special += w[k];
    }
    items.push(['normal', Math.max(0.02, 1 - special)]);
    let total = 0;
    for (const it of items) total += it[1];
    let r = gen.rng.next() * total;
    for (const it of items) { r -= it[1]; if (r <= 0) return it[0]; }
    return 'normal';
  }

  function sk_x0Range(prevSteps, width, span) {
    let lo = 0, hi = sk_C.FIELD_W - width;
    for (const p of prevSteps) {
      lo = Math.max(lo, p.x0 - span - width);
      hi = Math.min(hi, p.x1 + span);
    }
    if (lo > hi) { const x = sk_clamp(prevSteps[0].x0, 0, sk_C.FIELD_W - width); return { lo: x, hi: x }; }
    return { lo, hi };
  }

  /* 空隙不能是「看起來過得去其實過不去」的細縫：要嘛 0，要嘛 ≥ MIN_PASS */
  function sk_snapWall(x0, width) {
    const W = sk_C.FIELD_W;
    if (x0 > 0 && x0 < sk_C.MIN_PASS) x0 = x0 < sk_C.MIN_PASS / 2 ? 0 : sk_C.MIN_PASS;
    const right = W - (x0 + width);
    if (right > 0 && right < sk_C.MIN_PASS) x0 = right < sk_C.MIN_PASS / 2 ? W - width : W - width - sk_C.MIN_PASS;
    return sk_clamp(x0, 0, W - width);
  }

  function sk_makeStep(gen, depth, x0, width, kind) {
    const st = { id: gen.nextId++, layer: gen.layer, depth, x0, x1: x0 + width, kind,
      belt: 0, fakeT: -1, gone: false, flash: 0, squish: 0 };
    if (kind === 'belt') st.belt = gen.rng.next() < 0.5 ? -1 : 1;
    return st;
  }

  function sk_nextLayer(gen) {
    const rng = gen.rng;
    let steps;
    if (gen.layer === 0) {
      const x0 = (sk_C.FIELD_W - sk_C.SPAWN_WIDTH) / 2;
      steps = [sk_makeStep(gen, 0, x0, sk_C.SPAWN_WIDTH, 'normal')];
      steps[0].spawn = true;
      gen.depth = 0;
    } else {
      const gap = rng.range(sk_C.GAP_MIN, sk_C.GAP_MAX);
      const depth = gen.depth + gap;
      const span = sk_reachSpan(gap);
      const isWide = gen.layer % sk_C.WIDE_EVERY === 0;
      const mustSafe = gen.unsafeRun >= sk_C.SAFE_WINDOW - 1;
      const width = isWide ? sk_C.WIDE_WIDTH : rng.range(sk_C.WIDTH_MIN, sk_C.WIDTH_MAX);
      const r = sk_x0Range(gen.prev.steps, width, span);
      const x0 = sk_snapWall(rng.range(r.lo, r.hi), width);
      const kind = sk_pickKind(gen, isWide, mustSafe);
      steps = [sk_makeStep(gen, depth, x0, width, kind)];
      /* 偶爾同層兩階：空隙一定 ≥ MIN_PASS */
      if (!isWide && rng.next() < sk_C.TWO_STEP_CHANCE) {
        const w2 = rng.range(sk_C.WIDTH_MIN, sk_C.WIDTH_MAX);
        const sep = rng.range(sk_C.MIN_PASS, sk_C.TWO_STEP_MAX_SEP);
        const right = x0 + width + sep;
        const left = x0 - sep - w2;
        let nx = null;
        if (right + w2 <= sk_C.FIELD_W && (sk_C.FIELD_W - right - w2 === 0 || sk_C.FIELD_W - right - w2 >= sk_C.MIN_PASS)) nx = right;
        else if (left >= 0 && (left === 0 || left >= sk_C.MIN_PASS)) nx = left;
        if (nx != null) steps.push(sk_makeStep(gen, depth, nx, w2, kind === 'spike' ? 'normal' : sk_pickKind(gen, false, mustSafe)));
      }
      gen.depth = depth;
      const kinds = steps.map(s => s.kind);
      for (const k of Object.keys(gen.run)) gen.run[k] = kinds.indexOf(k) >= 0 ? gen.run[k] + 1 : 0;
      const safe = kinds.some(k => k === 'normal' || k === 'belt');
      gen.unsafeRun = safe ? 0 : gen.unsafeRun + 1;
    }
    gen.prev = { depth: gen.depth, steps };
    gen.layer++;
    return steps;
  }

  /* ---------- 對局 ---------- */
  function sk_createMatch(cfg) {
    const diff = sk_DIFF[cfg.difficulty] || sk_DIFF.normal;
    const seed = cfg.seed != null ? cfg.seed : (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    const gen = sk_createGen(seed, diff);
    const viewH = sk_clamp(cfg.viewH || 16, 16, 24);
    const s = {
      diff, gen, viewH, steps: [], time: 0, countdown: sk_C.COUNTDOWN, phase: 'countdown',
      cameraTop: -sk_C.CAMERA_LEAD, scrollSpeed: diff.scroll, world: 0, seed,
      dmgRng: sk_rng(seed ^ 0x5bd1e995),
      player: {
        x: sk_C.FIELD_W / 2, y: 0, vx: 0, vy: 0, dir: 1, onStep: null, ignoreStep: 0,
        hp: diff.hp, maxHp: diff.hp, invuln: 0, ceilCool: 0, deepest: 0, alive: true,
        lastHurt: -9, stats: { spikes: 0, springs: 0, fakes: 0, heals: 0 }
      }
    };
    sk_fill(s);
    s.player.onStep = s.steps[0];
    return s;
  }

  function sk_fill(s) {
    const need = s.cameraTop + s.viewH + sk_C.KEEP_BELOW;
    while (s.gen.depth < need || s.gen.layer === 0) s.steps.push.apply(s.steps, sk_nextLayer(s.gen));
    const cut = s.cameraTop - sk_C.KEEP_ABOVE;
    if (s.steps.length && s.steps[0].depth < cut) s.steps = s.steps.filter(st => st.depth >= cut);
  }

  function sk_rollDamage(s) {
    const d = s.diff.dmg;
    if (!d) return 1;
    const t = sk_clamp(s.player.deepest / (sk_C.MILESTONE * 3), 0, 1);
    const lo = Math.round(d.base[0] + (d.deep[0] - d.base[0]) * t);
    const hi = Math.round(d.base[1] + (d.deep[1] - d.base[1]) * t);
    return s.dmgRng.int(lo, hi);
  }

  function sk_damage(s, amount, cause, ev) {
    const p = s.player;
    p.hp = Math.max(0, p.hp - amount);
    p.lastHurt = s.time;
    ev.push({ type: 'hurt', cause, amount, x: p.x, y: p.y });
    if (p.hp <= 0 && !s.diff.endless) sk_kill(s, cause, ev);
    if (s.diff.endless && p.hp <= 0) p.hp = 1;
  }

  function sk_kill(s, cause, ev) {
    if (!s.player.alive) return;
    s.player.alive = false;
    s.phase = 'over';
    s.cause = cause;
    ev.push({ type: 'dead', cause });
  }

  const sk_overlapX = (p, st) => p.x + sk_C.PLAYER_W / 2 > st.x0 && p.x - sk_C.PLAYER_W / 2 < st.x1;

  function sk_land(s, st, ev) {
    const p = s.player;
    p.onStep = st; p.y = st.depth; p.vy = 0;
    if (st.kind === 'spring') {
      p.onStep = null; p.vy = -sk_C.SPRING_VY; st.squish = 1;
      p.stats.springs++;
      ev.push({ type: 'spring', x: p.x, y: st.depth });
    } else if (st.kind === 'spike') {
      st.flash = 0.22;
      if (p.invuln <= 0) { p.stats.spikes++; p.invuln = sk_C.INVULN; sk_damage(s, sk_rollDamage(s), 'spike', ev); }
      ev.push({ type: 'spikeLand', x: p.x, y: st.depth });
    } else {
      if (st.kind === 'fake' && st.fakeT < 0) { st.fakeT = 0; p.stats.fakes++; ev.push({ type: 'fakeStep', x: p.x, y: st.depth }); }
      if (p.hp < p.maxHp) { p.hp++; p.stats.heals++; ev.push({ type: 'heal', x: p.x, y: st.depth }); }
      ev.push({ type: 'land', x: p.x, y: st.depth, kind: st.kind });
    }
  }

  /* 推進一個固定步長；dir = -1 | 0 | 1。回傳本 tick 的事件清單（給畫面與音效用） */
  function sk_step(s, dir) {
    const ev = [];
    const dt = sk_C.STEP;
    if (s.phase === 'countdown') {
      s.countdown -= dt;
      if (s.countdown <= 0) { s.phase = 'play'; ev.push({ type: 'go' }); }
      return ev;
    }
    if (s.phase !== 'play') return ev;
    const p = s.player;
    const d = s.diff;
    s.time += dt;
    p.invuln = Math.max(0, p.invuln - dt);
    p.ceilCool = Math.max(0, p.ceilCool - dt);
    if (dir) p.dir = dir;
    p.moving = dir !== 0;

    /* 假階崩解 */
    for (const st of s.steps) {
      if (st.flash > 0) st.flash -= dt;
      if (st.squish > 0) st.squish = Math.max(0, st.squish - dt * 4);
      if (st.fakeT >= 0 && !st.gone) {
        st.fakeT += dt;
        if (st.fakeT >= sk_C.FAKE_DELAY) {
          st.gone = true;
          ev.push({ type: 'crumble', x0: st.x0, x1: st.x1, y: st.depth });
          if (p.onStep === st) p.onStep = null;
        }
      }
    }

    /* 水平 */
    let vx = dir * sk_C.MOVE_SPEED;
    if (p.onStep && p.onStep.kind === 'belt') vx += p.onStep.belt * sk_C.BELT_SPEED;
    p.vx = vx;
    p.x = sk_clamp(p.x + vx * dt, sk_C.PLAYER_W / 2, sk_C.FIELD_W - sk_C.PLAYER_W / 2);

    /* 走出階梯邊緣 */
    if (p.onStep && (!sk_overlapX(p, p.onStep) || p.onStep.gone)) p.onStep = null;

    /* 垂直 */
    if (!p.onStep) {
      const prevY = p.y;
      p.vy = Math.min(sk_C.MAX_FALL, p.vy + sk_C.GRAVITY * dt);
      p.y += p.vy * dt;
      if (p.vy > 0) {
        let best = null;
        for (const st of s.steps) {
          if (st.gone || st.id === p.ignoreStep) continue;
          if (st.depth >= prevY - 1e-6 && st.depth <= p.y && sk_overlapX(p, st)) {
            if (!best || st.depth < best.depth) best = st;
          }
        }
        if (best) sk_land(s, best, ev);
      }
    }
    if (p.ignoreStep && p.onStep == null && p.y > p.ignoreDepth + 0.05) p.ignoreStep = 0;

    /* 鏡頭與天花板 */
    const steps = Math.floor(s.time / d.every);
    s.scrollSpeed = d.scroll * Math.min(d.cap, Math.pow(1 + d.rate, steps));
    const follow = p.y - sk_C.CAMERA_LEAD;
    const want = Math.max(s.cameraTop + s.scrollSpeed * dt, follow);
    const limit = d.endless ? Infinity : Math.max(s.scrollSpeed, sk_C.CAMERA_CATCHUP) * dt;
    s.cameraTop = Math.min(want, s.cameraTop + limit);

    if (p.y - sk_C.PLAYER_H < s.cameraTop) {
      if (p.onStep) { p.ignoreStep = p.onStep.id; p.ignoreDepth = p.onStep.depth; p.onStep = null; }
      p.y = s.cameraTop + sk_C.PLAYER_H;
      p.vy = sk_C.CEIL_PUSH;
      ev.push({ type: 'ceiling', x: p.x, y: s.cameraTop });
      if (d.ceil != null && p.ceilCool <= 0) { p.ceilCool = d.ceil; sk_damage(s, sk_rollDamage(s), 'ceiling', ev); }
    }

    /* 深度、世界、死亡線 */
    if (p.onStep && p.y > p.deepest) p.deepest = p.y;
    const world = Math.floor(p.deepest / sk_C.MILESTONE);
    if (world > s.world) { s.world = world; ev.push({ type: 'world', world }); }
    if (!d.endless && p.y - sk_C.PLAYER_H > s.cameraTop + s.viewH) sk_kill(s, 'fall', ev);
    if (d.endless && p.y - sk_C.PLAYER_H > s.cameraTop + s.viewH) { p.y = s.cameraTop + s.viewH - 1; p.vy = 0; }

    sk_fill(s);
    return ev;
  }

  root.sk_Game = { sk_C, sk_DIFF, sk_createMatch, sk_step, sk_kill, sk_fill };
})(typeof self !== 'undefined' ? self : this);
