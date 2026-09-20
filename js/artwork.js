// Artwork: the illustrated layers (background, pan, record, inner windows, tonearm).
// Geometry is expressed in a fixed 2000x1125 "design space" that matches the source files,
// and window/arm positions are kept in record-radius units so everything scales together.
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const A = (DG.artwork = {
    ready: false,
    missing: [],
    images: {},
    design: { w: 2000, h: 1125 },
    disc: { x: 967, y: 587.25, r: 422.75 },
    panRect: { x: 414, y: 87.5, w: 1203.75, h: 1019.5 },
    view: { scale: 1, ox: 0, oy: 0, dpr: 1 },
    bgView: { scale: 1, ox: 0, oy: 0 },
    colors: { beige: '#cfccc2', green: '#013e1f', red: '#bc2d0b', mint: '#73ba9c', vinyl: '#120306' },

    // Circles inside the record, in record-radius units relative to the record centre.
    windows: [
      { id: 'cells', src: 'cells', ox: -0.36193, oy: -0.22648, r: 0.49261, kind: 'heart', energy: 0, clock: 0, pulse: 0, leanX: 0, leanY: 0 },
      { id: 'noise', src: 'noise', ox: 0.37494, oy: 0.35247, r: 0.32052, kind: 'drift', dx: 0, dy: 0, vx: 0, vy: 0, spin: 0, spinV: 0 },
      { id: 'blank', ox: 0.49438, oy: -0.38497, r: 0.28622, kind: 'iris', irisX: 0, irisY: 0, targetX: 0, targetY: 0, energy: 0, rings: [] },
    ],
    arc: { ox: 0.47487, oy: -0.40509, half: 0.30574 },
    arm: {
      pivot: { x: 1.24304, y: -0.77410 }, // offset from the record centre, in radii
      length: 1.47393,                    // pivot → stylus, in radii
      sprite: { pivot: { x: 685, y: 500 }, needle: { x: 248, y: 1667 }, len: 1246.2, angle: 1.92933, w: 820, h: 1720 },
    },

    ambient: false,      // true while the record is playing: the heart keeps a baseline beat
    onBeat: null,        // (strong, intensity) — hook used for the heartbeat sound

    // Hook for the animation that will live in the white window (added later).
    // Signature: function (ctx, cx, cy, r, time) — already clipped to the circle.
    renderBlankWindow: null,
  });

  const FILES = {
    background: 'assets/background.png',
    pan: 'assets/pan.png',
    disc: 'assets/disc.png',
    arc: 'assets/arc.png',
    cells: 'assets/cells.png',
    noise: 'assets/noise.png',
    tonearm: 'assets/tonearm.png',
  };

  const sprites = {};
  const BEAT_PERIOD = 0.95;
  const BEAT_OFFSETS = [0, 0.24];
  let time = 0;

  A.load = function () {
    const jobs = Object.keys(FILES).map((key) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { A.images[key] = img; resolve(); };
      img.onerror = () => { A.missing.push(FILES[key]); resolve(); };
      img.src = FILES[key];
    }));
    return Promise.all(jobs).then(() => {
      A.ready = A.missing.length === 0;
      return A.ready;
    });
  };

  // ---- view mapping (design space → canvas) ----
  // The turntable is fitted to the stage with a margin (so it stays large on a phone),
  // while the background fills the canvas. On a 16:9 stage the two line up as drawn.
  A.setView = function (W, H, dpr) {
    const p = A.panRect, margin = 105;
    const scale = Math.min(W / (p.w + margin), H / (p.h + margin));
    A.view = {
      scale,
      ox: W / 2 - (p.x + p.w / 2) * scale,
      oy: H / 2 - (p.y + p.h / 2) * scale,
      dpr,
    };
    const bgScale = Math.max(W / A.design.w, H / A.design.h);
    A.bgView = { scale: bgScale, ox: (W - A.design.w * bgScale) / 2, oy: (H - A.design.h * bgScale) / 2 };
    sprites.disc = sprites.arm = sprites.arc = sprites.cells = sprites.noise = null;
    return { scale, radius: A.disc.r * scale, cx: A.view.ox + A.disc.x * scale, cy: A.view.oy + A.disc.y * scale };
  };

  function makeSprite(img, w, h) {
    const dpr = A.view.dpr;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    const c = cv.getContext('2d');
    if (img) c.drawImage(img, 0, 0, cv.width, cv.height);
    return cv;
  }

  // ---- static layers ----
  A.drawStage = function (ctx, W, H) {
    ctx.fillStyle = A.colors.beige;
    ctx.fillRect(0, 0, W, H);
    const v = A.view, b = A.bgView;
    if (A.images.background) {
      ctx.drawImage(A.images.background, b.ox, b.oy, A.design.w * b.scale, A.design.h * b.scale);
    }
    if (A.images.pan) {
      const p = A.panRect;
      ctx.drawImage(A.images.pan, v.ox + p.x * v.scale, v.oy + p.y * v.scale, p.w * v.scale, p.h * v.scale);
    }
  };

  // ---- record ----
  A.discSprite = function (R) {
    if (!sprites.disc) sprites.disc = makeSprite(A.images.disc, R * 2, R * 2);
    return sprites.disc;
  };

  // two beats per cycle, like a heart
  function heartbeat(t) {
    const c = ((t % BEAT_PERIOD) + BEAT_PERIOD) % BEAT_PERIOD;
    return Math.exp(-Math.pow(c / 0.055, 2)) + 0.6 * Math.exp(-Math.pow((c - 0.24) / 0.07, 2));
  }

  A.update = function (dt) {
    time += dt;
    for (const w of A.windows) {
      if (w.kind === 'heart') {
        const prev = w.clock;
        w.clock += dt;
        w.energy *= Math.exp(-dt / 2.6);
        if (A.ambient) w.energy = Math.max(w.energy, 0.18);
        if (w.energy < 0.002) w.energy = 0;
        w.pulse = w.energy * heartbeat(w.clock);
        w.leanX *= Math.exp(-dt * 2.4);
        w.leanY *= Math.exp(-dt * 2.4);
        if (A.onBeat && w.energy > 0.05) {
          for (const o of BEAT_OFFSETS) {
            const k0 = Math.ceil((prev - o) / BEAT_PERIOD), k1 = Math.floor((w.clock - o) / BEAT_PERIOD);
            for (let k = k0; k <= k1; k++) A.onBeat(o === 0, Math.min(1, w.energy));
          }
        }
      } else if (w.kind === 'drift') {
        const k = 42, damp = 5.5;
        w.vx += (-k * w.dx - damp * w.vx) * dt;
        w.vy += (-k * w.dy - damp * w.vy) * dt;
        w.dx += w.vx * dt;
        w.dy += w.vy * dt;
        w.spinV += (-k * w.spin - damp * w.spinV) * dt;
        w.spin += w.spinV * dt;
        const max = 0.14;
        const len = Math.hypot(w.dx, w.dy);
        if (len > max) { w.dx *= max / len; w.dy *= max / len; }
        w.spin = clamp(w.spin, -0.32, 0.32);
      } else if (w.kind === 'iris') {
        w.irisX += (w.targetX - w.irisX) * (1 - Math.exp(-dt * 7));
        w.irisY += (w.targetY - w.irisY) * (1 - Math.exp(-dt * 7));
        w.energy *= Math.exp(-dt / 0.8);
        for (const ring of w.rings) ring.age += dt;
        w.rings = w.rings.filter((ring) => ring.age < ring.life);
      }
    }
  };

  // Energy of the noise window, used to drive its background sound.
  A.noiseEnergy = function () {
    const w = A.windows[1];
    return clamp(Math.hypot(w.vx, w.vy) * 0.6 + Math.hypot(w.dx, w.dy) * 2.2, 0, 1);
  };

  // ---- pointer reactions ----
  // Everything reacts to every pointer event, wherever it lands: the closer the pointer,
  // the stronger the response, but nothing is limited to the inside of a circle.
  A.react = function (rn, t, strength, click) {
    const px = rn * Math.cos(t), py = rn * Math.sin(t);
    for (const w of A.windows) {
      const dx = px - w.ox, dy = py - w.oy;
      const dist = Math.hypot(dx, dy);
      const near = clamp(1 - (dist - w.r) / 1.5, 0.12, 1); // 1 inside the circle, fading outwards
      const s = strength * near;

      if (w.kind === 'heart') {
        w.energy = Math.min(1, w.energy + (click ? 0.5 * near + 0.12 : 0.24 * s));
        if (click) w.clock = 0;
        const lean = (click ? 0.028 : 0.012) * near;
        if (dist > 0.001) {
          w.leanX = clamp(w.leanX + (dx / dist) * lean, -0.04, 0.04);
          w.leanY = clamp(w.leanY + (dy / dist) * lean, -0.04, 0.04);
        }
      } else if (w.kind === 'drift') {
        const push = (click ? 3.4 : 1.6) * s;
        if (dist > 0.001) {
          w.vx -= (dx / dist) * push;
          w.vy -= (dy / dist) * push;
        }
        w.spinV += (dx * w.vy - dy * w.vx) * 0.5 * near;
      } else if (w.kind === 'iris') {
        const reach = 0.3;
        const d = Math.max(dist, 0.001);
        const pull = Math.min(1, dist / w.r);
        w.targetX = (dx / d) * reach * pull;
        w.targetY = (dy / d) * reach * pull;
        w.energy = Math.min(1, w.energy + (click ? 0.9 : 0.25 * s));
        if (click && w.rings.length < 6) w.rings.push({ age: 0, life: 1.1 });
      }
    }
  };

  A.windowAt = function (rn, t) {
    const x = rn * Math.cos(t), y = rn * Math.sin(t);
    for (const w of A.windows) {
      if (Math.hypot(x - w.ox, y - w.oy) <= w.r) return { win: w, lx: x - w.ox, ly: y - w.oy };
    }
    return null;
  };

  // ---- inner windows (drawn in record space: origin at the record centre, unrotated) ----
  A.renderWindows = function (c, R) {
    // The arc artwork carries its own white disc, so it goes down first and the white
    // window is drawn over it — otherwise it would hide what happens inside that circle.
    if (A.images.arc) {
      const size = A.arc.half * 2 * R;
      if (!sprites.arc) sprites.arc = makeSprite(A.images.arc, size, size);
      c.drawImage(sprites.arc, A.arc.ox * R - size / 2, A.arc.oy * R - size / 2, size, size);
    }

    for (const w of A.windows) {
      const wx = w.ox * R, wy = w.oy * R, wr = w.r * R;
      c.save();
      c.beginPath();
      c.arc(wx, wy, wr, 0, TAU);
      c.clip();

      if (w.kind === 'heart') {
        const img = A.images[w.src];
        if (img) {
          if (!sprites.cells) {
            const h = wr * 2 * 1.5;
            sprites.cells = makeSprite(img, h * (img.width / img.height), h);
          }
          const sp = sprites.cells;
          const dw = sp.width / A.view.dpr, dh = sp.height / A.view.dpr;
          const s = 1 + 0.09 * w.pulse;
          c.translate(wx + w.leanX * R, wy + w.leanY * R);
          c.scale(s, s);
          c.drawImage(sp, -dw / 2, -dh / 2, dw, dh);
        }
      } else if (w.kind === 'drift') {
        const img = A.images[w.src];
        if (img) {
          if (!sprites.noise) {
            const h = wr * 2 * 1.8;
            sprites.noise = makeSprite(img, h * (img.width / img.height), h);
          }
          const sp = sprites.noise;
          const dw = sp.width / A.view.dpr, dh = sp.height / A.view.dpr;
          c.translate(wx + w.dx * R, wy + w.dy * R);
          c.rotate(w.spin);
          c.drawImage(sp, -dw / 2, -dh / 2, dw, dh);
        }
      } else {
        // white window: an iris that follows the pointer, plus rings when tapped
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.arc(wx, wy, wr, 0, TAU);
        c.fill();
        c.translate(wx, wy);
        const irisR = wr * (0.3 + 0.06 * w.energy);
        c.fillStyle = A.colors.green;
        c.beginPath();
        c.arc(w.irisX * wr, w.irisY * wr, irisR, 0, TAU);
        c.fill();
        c.fillStyle = A.colors.mint;
        c.beginPath();
        c.arc(w.irisX * wr * 1.12, w.irisY * wr * 1.12, irisR * 0.42, 0, TAU);
        c.fill();
        c.lineWidth = Math.max(1, wr * 0.03);
        for (const ring of w.rings) {
          const k = ring.age / ring.life;
          c.globalAlpha = (1 - k) * 0.7;
          c.strokeStyle = A.colors.green;
          c.beginPath();
          c.arc(0, 0, wr * (0.15 + 0.95 * k), 0, TAU);
          c.stroke();
        }
        c.globalAlpha = 1;
        if (A.renderBlankWindow) A.renderBlankWindow(c, 0, 0, wr, time);
      }
      c.restore();
    }
  };

  // ---- tonearm ----
  A.armSprite = function (length) {
    const s = A.arm.sprite;
    if (!sprites.arm) {
      const img = A.images.tonearm;
      const scale = length / s.len;
      sprites.arm = makeSprite(img, img ? img.width * scale : 1, img ? img.height * scale : 1);
      sprites.arm.pivotX = s.pivot.x * scale;
      sprites.arm.pivotY = s.pivot.y * scale;
      sprites.arm.scale = scale;
    }
    return sprites.arm;
  };
})();
