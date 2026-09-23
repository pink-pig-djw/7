// Procedural "painterly" canvas textures. Most are near-neutral so that vertex
// colours can tint modular pieces (one material → many house colours).
import * as THREE from 'three';
import { RNG } from '../core/util.js';

const cache = new Map();
let maxAniso = 4;
export function setMaxAnisotropy(n) { maxAniso = Math.min(8, n || 4); }

function mk(size, h = size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = h;
  return [c, c.getContext('2d')];
}

function toTex(c, { repeat = true, srgb = true, mip = true, aniso = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = mip;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.anisotropy = aniso ? maxAniso : 1;
  t.needsUpdate = true;
  return t;
}

// draw fn at (x,y) plus wrapped copies so the texture tiles seamlessly
function wrap(size, x, y, r, fn, h = size) {
  for (let ox = -size; ox <= size; ox += size) {
    for (let oy = -h; oy <= h; oy += h) {
      const px = x + ox, py = y + oy;
      if (px + r < 0 || px - r > size || py + r < 0 || py - r > h) continue;
      fn(px, py);
    }
  }
}

const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
// mostly-luminance jitter so tinted textures don't turn into pastel confetti
function jit(rng, c, j) {
  const d = rng.range(-j, j);
  return c.map((v) => Math.max(0, Math.min(255, v + d + rng.range(-j, j) * 0.18)));
}

function blots(ctx, rng, size, n, rmin, rmax, cols, amin, amax) {
  for (let i = 0; i < n; i++) {
    const x = rng.range(0, size), y = rng.range(0, size), r = rng.range(rmin, rmax);
    const c = rng.pick(cols), a = rng.range(amin, amax);
    wrap(size, x, y, r, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, rgb(c[0], c[1], c[2], a));
      g.addColorStop(1, rgb(c[0], c[1], c[2], 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    });
  }
}

function strokes(ctx, rng, size, n, lmin, lmax, wmin, wmax, cols, amin, amax, angle = null, angJ = Math.PI) {
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = rng.range(0, size), y = rng.range(0, size);
    const len = rng.range(lmin, lmax), w = rng.range(wmin, wmax);
    const a = angle === null ? rng.range(0, Math.PI * 2) : angle + rng.range(-angJ, angJ);
    const c = rng.pick(cols);
    ctx.strokeStyle = rgb(c[0], c[1], c[2], rng.range(amin, amax));
    ctx.lineWidth = w;
    const dx = Math.cos(a) * len * 0.5, dy = Math.sin(a) * len * 0.5;
    wrap(size, x, y, len, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px - dx, py - dy);
      ctx.quadraticCurveTo(px + rng.range(-2, 2), py + rng.range(-2, 2), px + dx, py + dy);
      ctx.stroke();
    });
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
const GEN = {
  cobble() {
    const S = 512, [c, ctx] = mk(S), rng = new RNG(11);
    ctx.fillStyle = rgb(150, 142, 126); ctx.fillRect(0, 0, S, S);
    blots(ctx, rng, S, 60, 20, 60, [[120, 112, 98], [170, 160, 140]], 0.2, 0.4);
    const N = 9, cell = S / N;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const cx = (i + 0.5 + (j % 2) * 0.5) * cell + rng.range(-5, 5);
        const cy = (j + 0.5) * cell + rng.range(-5, 5);
        const rx = cell * rng.range(0.4, 0.47), ry = cell * rng.range(0.38, 0.46);
        const base = jit(rng, [214, 206, 190], 14);
        wrap(S, cx, cy, cell, (px, py) => {
          ctx.save(); ctx.translate(px, py); ctx.rotate(rng.range(-0.3, 0.3));
          ctx.fillStyle = rgb(base[0] - 40, base[1] - 40, base[2] - 38, 0.55);
          ctx.beginPath(); ctx.ellipse(2, 3, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = rgb(...base);
          ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
          const g = ctx.createRadialGradient(-rx * 0.35, -ry * 0.4, 1, 0, 0, rx * 1.1);
          g.addColorStop(0, 'rgba(255,252,240,0.45)'); g.addColorStop(1, 'rgba(255,252,240,0)');
          ctx.fillStyle = g; ctx.fill();
          ctx.restore();
        });
      }
    }
    strokes(ctx, rng, S, 500, 4, 12, 1, 3, [[250, 245, 230], [120, 110, 95]], 0.05, 0.14);
    return toTex(c);
  },

  flag() {
    const S = 512, [c, ctx] = mk(S), rng = new RNG(21);
    ctx.fillStyle = rgb(160, 150, 132); ctx.fillRect(0, 0, S, S);
    const rowH = 64;
    for (let y = 0; y < S; y += rowH) {
      let x = rng.range(0, 60);
      const start = x;
      while (x < S + start) {
        const w = rng.range(70, 150);
        const base = jit(rng, [222, 214, 198], 12);
        wrap(S, x + w / 2, y + rowH / 2, w, (px, py) => {
          ctx.fillStyle = rgb(...base);
          roundRect(ctx, px - w / 2 + 3, py - rowH / 2 + 3, w - 6, rowH - 6, 7); ctx.fill();
          const g = ctx.createLinearGradient(0, py - rowH / 2, 0, py + rowH / 2);
          g.addColorStop(0, 'rgba(255,250,235,0.35)'); g.addColorStop(0.5, 'rgba(255,250,235,0)'); g.addColorStop(1, 'rgba(90,80,60,0.18)');
          ctx.fillStyle = g; ctx.fill();
        });
        x += w;
      }
    }
    blots(ctx, rng, S, 90, 10, 40, [[200, 190, 170], [240, 234, 220], [170, 175, 150]], 0.08, 0.2);
    strokes(ctx, rng, S, 600, 5, 16, 1, 3, [[255, 250, 238], [140, 128, 110]], 0.04, 0.12);
    return toTex(c);
  },

  plaster() {
    const S = 256, [c, ctx] = mk(S), rng = new RNG(31);
    ctx.fillStyle = rgb(240, 234, 222); ctx.fillRect(0, 0, S, S);
    blots(ctx, rng, S, 160, 8, 34, [[255, 252, 244], [222, 212, 196], [232, 226, 214]], 0.12, 0.3);
    strokes(ctx, rng, S, 260, 6, 18, 2, 5, [[255, 253, 247], [214, 204, 188]], 0.05, 0.13, 0.2, 0.5);
    return toTex(c);
  },

  wood() {
    const S = 256, [c, ctx] = mk(S), rng = new RNG(41);
    ctx.fillStyle = rgb(176, 138, 102); ctx.fillRect(0, 0, S, S);
    ctx.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      const x = rng.range(0, S), w = rng.range(1, 4);
      const col = rng.chance(0.5) ? [120, 88, 62] : [204, 168, 128];
      ctx.strokeStyle = rgb(...col, rng.range(0.15, 0.4)); ctx.lineWidth = w;
      for (const ox of [-S, 0, S]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, -10);
        for (let y = 0; y <= S + 10; y += 16) ctx.lineTo(x + ox + Math.sin(y * 0.03 + i) * 3, y);
        ctx.stroke();
      }
    }
    for (let i = 0; i < 5; i++) {
      const x = rng.range(20, S - 20), y = rng.range(20, S - 20);
      ctx.strokeStyle = rgb(110, 80, 56, 0.4); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y, 4, 9, 0, 0, Math.PI * 2); ctx.stroke();
    }
    return toTex(c);
  },

  roof() {
    const S = 512, [c, ctx] = mk(S), rng = new RNG(51);
    ctx.fillStyle = rgb(120, 110, 104); ctx.fillRect(0, 0, S, S);
    const rowH = 64, tileW = 52;
    for (let y = -rowH; y < S + rowH; y += rowH) {
      const off = ((y / rowH) & 1) * tileW * 0.5;
      for (let x = -tileW; x < S + tileW; x += tileW) {
        const base = jit(rng, [236, 228, 222], 16);
        const tx = x + off, ty = y;
        wrap(S, tx + tileW / 2, ty + rowH / 2, tileW, (px, py) => {
          const l = px - tileW / 2 + 2, t = py - rowH / 2, w = tileW - 4, h = rowH + 10;
          ctx.fillStyle = 'rgba(40,30,28,0.35)';
          roundRect(ctx, l + 2, t + 8, w, h, 16); ctx.fill();
          const g = ctx.createLinearGradient(0, t, 0, t + h);
          g.addColorStop(0, rgb(base[0] - 30, base[1] - 30, base[2] - 30));
          g.addColorStop(0.55, rgb(...base));
          g.addColorStop(1, rgb(Math.min(255, base[0] + 12), Math.min(255, base[1] + 12), Math.min(255, base[2] + 12)));
          ctx.fillStyle = g;
          roundRect(ctx, l, t, w, h, 16); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillRect(l + w * 0.25, t + 6, w * 0.16, h - 22);
        });
      }
    }
    blots(ctx, rng, S, 50, 12, 40, [[90, 80, 70], [255, 250, 240]], 0.05, 0.12);
    return toTex(c);
  },

  stoneWall() {
    const S = 512, [c, ctx] = mk(S), rng = new RNG(61);
    ctx.fillStyle = rgb(146, 138, 124); ctx.fillRect(0, 0, S, S);
    let y = 0;
    const rows = [64, 56, 72, 60, 68, 56, 72, 64];
    for (const h of rows) {
      let x = rng.range(0, 80); const start = x;
      while (x < S + start) {
        const w = rng.range(80, 170);
        const base = jit(rng, [214, 206, 192], 14);
        wrap(S, x + w / 2, y + h / 2, w, (px, py) => {
          const l = px - w / 2 + 3, t = py - h / 2 + 3;
          ctx.fillStyle = rgb(...base);
          roundRect(ctx, l, t, w - 6, h - 6, 6); ctx.fill();
          const g = ctx.createLinearGradient(l, t, l, t + h);
          g.addColorStop(0, 'rgba(255,250,240,0.35)'); g.addColorStop(0.3, 'rgba(255,250,240,0)'); g.addColorStop(1, 'rgba(70,60,50,0.25)');
          ctx.fillStyle = g; ctx.fill();
        });
        x += w;
      }
      y += h;
    }
    blots(ctx, rng, S, 70, 10, 50, [[180, 172, 156], [236, 230, 218], [160, 170, 140]], 0.07, 0.18);
    strokes(ctx, rng, S, 500, 5, 14, 1, 3, [[255, 250, 238], [130, 120, 105]], 0.04, 0.12);
    return toTex(c);
  },

  ruin() {
    const S = 512, [c, ctx] = mk(S), rng = new RNG(71);
    ctx.fillStyle = rgb(120, 124, 110); ctx.fillRect(0, 0, S, S);
    let y = 0;
    const rows = [96, 80, 112, 96, 128];
    for (const h of rows) {
      let x = rng.range(0, 100); const start = x;
      while (x < S + start) {
        const w = rng.range(120, 220);
        const base = jit(rng, [196, 198, 184], 14);
        wrap(S, x + w / 2, y + h / 2, w, (px, py) => {
          const l = px - w / 2 + 4, t = py - h / 2 + 4;
          ctx.fillStyle = rgb(...base);
          roundRect(ctx, l, t, w - 8, h - 8, 14); ctx.fill();
          const g = ctx.createLinearGradient(l, t, l, t + h);
          g.addColorStop(0, 'rgba(255,255,245,0.3)'); g.addColorStop(0.35, 'rgba(255,255,245,0)'); g.addColorStop(1, 'rgba(60,64,50,0.3)');
          ctx.fillStyle = g; ctx.fill();
        });
        x += w;
      }
      y += h;
    }
    // cracks
    ctx.strokeStyle = 'rgba(70,70,60,0.5)'; ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      let x = rng.range(0, S), yy = rng.range(0, S);
      ctx.beginPath(); ctx.moveTo(x, yy);
      for (let k = 0; k < 6; k++) { x += rng.range(-14, 14); yy += rng.range(4, 16); ctx.lineTo(x, yy); }
      ctx.stroke();
    }
    blots(ctx, rng, S, 70, 10, 44, [[112, 150, 80], [140, 170, 96], [96, 128, 70]], 0.15, 0.4);
    strokes(ctx, rng, S, 500, 4, 12, 1, 3, [[250, 250, 240], [90, 100, 80]], 0.05, 0.14);
    return toTex(c);
  },

  marble() {
    const S = 512, [c, ctx] = mk(S), rng = new RNG(81);
    ctx.fillStyle = rgb(206, 200, 190); ctx.fillRect(0, 0, S, S);
    const T = 128;
    for (let y = 0; y < S; y += T) for (let x = 0; x < S; x += T) {
      const base = ((x + y) / T) % 2 === 0 ? [244, 240, 232] : [226, 222, 214];
      ctx.fillStyle = rgb(...jit(rng, base, 6));
      ctx.fillRect(x + 2, y + 2, T - 4, T - 4);
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      ctx.strokeStyle = rgb(170, 165, 170, rng.range(0.12, 0.3)); ctx.lineWidth = rng.range(0.8, 2.5);
      let x = rng.range(0, S), y = rng.range(0, S);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) { const nx = x + rng.range(-60, 60), ny = y + rng.range(-60, 60); ctx.quadraticCurveTo((x + nx) / 2 + rng.range(-20, 20), (y + ny) / 2 + rng.range(-20, 20), nx, ny); x = nx; y = ny; }
      ctx.stroke();
    }
    blots(ctx, rng, S, 60, 10, 40, [[255, 255, 255], [210, 205, 200]], 0.06, 0.14);
    return toTex(c);
  },

  terrain() {
    const S = 512, [c, ctx] = mk(S), rng = new RNG(91);
    ctx.fillStyle = rgb(232, 232, 232); ctx.fillRect(0, 0, S, S);
    blots(ctx, rng, S, 120, 14, 50, [[255, 255, 255], [205, 205, 205]], 0.12, 0.3);
    strokes(ctx, rng, S, 2600, 5, 13, 1.5, 3.5, [[255, 255, 255], [196, 196, 196], [214, 214, 214]], 0.25, 0.55, -Math.PI / 2, 0.6);
    return toTex(c);
  },

  bark() {
    const S = 256, [c, ctx] = mk(S), rng = new RNG(101);
    ctx.fillStyle = rgb(200, 190, 180); ctx.fillRect(0, 0, S, S);
    strokes(ctx, rng, S, 500, 14, 46, 2, 6, [[150, 138, 126], [236, 228, 218], [170, 160, 150]], 0.25, 0.55, Math.PI / 2, 0.12);
    return toTex(c);
  },

  ivy() {
    const S = 256, [c, ctx] = mk(S), rng = new RNG(111);
    ctx.clearRect(0, 0, S, S);
    ctx.lineCap = 'round';
    for (let v = 0; v < 7; v++) {
      let x = rng.range(0, S);
      ctx.strokeStyle = rgb(92, 70, 48, 0.95); ctx.lineWidth = rng.range(2, 4);
      const pts = [];
      for (let y = -20; y <= S + 20; y += 12) { x += rng.range(-6, 6); pts.push([x, y]); }
      for (const ox of [-S, 0, S]) {
        ctx.beginPath(); ctx.moveTo(pts[0][0] + ox, pts[0][1]);
        for (const p of pts) ctx.lineTo(p[0] + ox, p[1]);
        ctx.stroke();
      }
    }
    for (let i = 0; i < 420; i++) {
      const x = rng.range(0, S), y = rng.range(0, S), r = rng.range(6, 12);
      const base = rng.pick([[74, 140, 62], [98, 164, 70], [60, 118, 56], [126, 184, 84]]);
      const a = rng.range(0, Math.PI * 2);
      wrap(S, x, y, r * 2, (px, py) => {
        ctx.save(); ctx.translate(px, py); ctx.rotate(a);
        ctx.fillStyle = rgb(base[0] * 0.6, base[1] * 0.6, base[2] * 0.6, 1);
        ctx.beginPath(); ctx.ellipse(1, 1.5, r, r * 0.62, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgb(...base);
        ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.62, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,220,0.25)';
        ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.2, r * 0.45, r * 0.22, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });
    }
    return toTex(c);
  },

  // emissive glyph atlas: 4x4 cells, white strokes on black
  runes() {
    const S = 512, [c, ctx] = mk(S);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
    const cell = S / 4;
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const draw = (i, fn) => {
      const cx = (i % 4) * cell + cell / 2, cy = Math.floor(i / 4) * cell + cell / 2;
      ctx.save(); ctx.translate(cx, cy);
      ctx.shadowColor = '#fff'; ctx.shadowBlur = 8; ctx.lineWidth = 7;
      fn(cell * 0.36);
      ctx.restore();
    };
    // 0 circle rune
    draw(0, (r) => { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2); ctx.fill(); });
    // 1 triangle rune
    draw(1, (r) => { ctx.beginPath(); for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + k * Math.PI * 2 / 3; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r + r * 0.15); } ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, -r * 0.2); ctx.lineTo(0, r * 0.45); ctx.stroke(); });
    // 2 spiral rune
    draw(2, (r) => { ctx.beginPath(); for (let t = 0; t < 1; t += 0.01) { const a = t * Math.PI * 4.2, rr = r * (0.1 + 0.9 * t); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.stroke(); });
    // 3 wind crest
    draw(3, (r) => {
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.stroke(); ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(-r * 0.75, r * 0.1); ctx.bezierCurveTo(-r * 0.3, -r * 0.7, r * 0.8, -r * 0.6, r * 0.45, r * 0.05); ctx.bezierCurveTo(r * 0.25, r * 0.4, -r * 0.2, r * 0.2, 0, -r * 0.05); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r * 0.7, r * 0.45); ctx.lineTo(r * 0.2, r * 0.45); ctx.stroke();
    });
    // 4 dots I
    draw(4, (r) => { ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.stroke(); });
    // 5 dots II
    draw(5, (r) => { for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * r * 0.4, 0, r * 0.2, 0, Math.PI * 2); ctx.fill(); } ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.stroke(); });
    // 6 dots III
    draw(6, (r) => { for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + k * Math.PI * 2 / 3; ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, r * 0.18, 0, Math.PI * 2); ctx.fill(); } ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.stroke(); });
    // 7 eye rune
    draw(7, (r) => { ctx.beginPath(); ctx.moveTo(-r, 0); ctx.quadraticCurveTo(0, -r * 0.9, r, 0); ctx.quadraticCurveTo(0, r * 0.9, -r, 0); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2); ctx.fill(); });
    // 8 plate ring (pressure plate marker)
    draw(8, (r) => { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r * 0.65, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.stroke(); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.65, Math.sin(a) * r * 0.65); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.lineWidth = 5; ctx.stroke(); } });
    // 9 arrow down (hint)
    draw(9, (r) => { ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r * 0.6); ctx.moveTo(-r * 0.5, r * 0.1); ctx.lineTo(0, r * 0.7); ctx.lineTo(r * 0.5, r * 0.1); ctx.stroke(); });
    // 10 decorative band
    draw(10, (r) => { ctx.lineWidth = 4; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(k * r * 0.4 - r * 0.15, -r); ctx.lineTo(k * r * 0.4 + r * 0.15, 0); ctx.lineTo(k * r * 0.4 - r * 0.15, r); ctx.stroke(); } });
    // 11 bird / wind spirit
    draw(11, (r) => { ctx.beginPath(); ctx.moveTo(-r, -r * 0.1); ctx.quadraticCurveTo(-r * 0.4, -r * 0.7, 0, 0); ctx.quadraticCurveTo(r * 0.4, -r * 0.7, r, -r * 0.1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, r * 0.8); ctx.stroke(); });
    // 12 full circle glow (for sockets)
    draw(12, (r) => { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.2); g.addColorStop(0, '#fff'); g.addColorStop(0.5, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.shadowBlur = 0; ctx.beginPath(); ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2); ctx.fill(); });
    // 13 square rune
    draw(13, (r) => { ctx.strokeRect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5); ctx.beginPath(); ctx.moveTo(-r * 0.75, 0); ctx.lineTo(r * 0.75, 0); ctx.moveTo(0, -r * 0.75); ctx.lineTo(0, r * 0.75); ctx.lineWidth = 3; ctx.stroke(); });
    // 14 line pattern (for pillars)
    draw(14, (r) => { ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-r, -r); ctx.lineTo(-r * 0.3, -r); ctx.lineTo(-r * 0.3, r * 0.3); ctx.lineTo(r * 0.4, r * 0.3); ctx.lineTo(r * 0.4, -r * 0.5); ctx.lineTo(r, -r * 0.5); ctx.moveTo(-r, r); ctx.lineTo(r, r); ctx.stroke(); });
    // 15 star
    draw(15, (r) => { ctx.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.42 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); });
    return toTex(c, { repeat: false });
  },

  // particle atlas 4x2 cells of 64px: 0 soft, 1 leaf, 2 petal, 3 star, 4 smoke, 5 ring, 6 streak, 7 drop
  particles() {
    const C = 64, [c, ctx] = mk(C * 4, C * 2);
    ctx.clearRect(0, 0, C * 4, C * 2);
    const at = (i, fn) => { ctx.save(); ctx.translate((i % 4) * C + C / 2, Math.floor(i / 4) * C + C / 2); fn(); ctx.restore(); };
    at(0, () => { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 30); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(-32, -32, 64, 64); });
    at(1, () => { ctx.rotate(0.6); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -26); ctx.quadraticCurveTo(18, -4, 0, 26); ctx.quadraticCurveTo(-18, -4, 0, -26); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(0, 22); ctx.stroke(); });
    at(2, () => { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, 22); ctx.bezierCurveTo(-22, 4, -14, -20, -4, -22); ctx.lineTo(0, -14); ctx.lineTo(4, -22); ctx.bezierCurveTo(14, -20, 22, 4, 0, 22); ctx.fill(); });
    at(3, () => { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 30); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(-32, -32, 64, 64); ctx.fillStyle = '#fff'; ctx.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, r = k % 2 ? 5 : 29; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.fill(); });
    at(4, () => { for (let k = 0; k < 7; k++) { const a = k * 0.9, r = 9 + (k % 3) * 3; const x = Math.cos(a) * 11, y = Math.sin(a) * 9; const g = ctx.createRadialGradient(x, y, 0, x, y, r + 6); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.7, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r + 6, 0, Math.PI * 2); ctx.fill(); } });
    at(5, () => { ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.shadowColor = '#fff'; ctx.shadowBlur = 6; ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.stroke(); });
    at(6, () => { const g = ctx.createLinearGradient(-30, 0, 30, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, 30, 4, 0, 0, Math.PI * 2); ctx.fill(); });
    at(7, () => { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -24); ctx.quadraticCurveTo(16, 6, 0, 20); ctx.quadraticCurveTo(-16, 6, 0, -24); ctx.fill(); });
    return toTex(c, { repeat: false, mip: true });
  },

  awningRed() { return stripes([214, 72, 60], [246, 238, 222]); },
  awningBlue() { return stripes([58, 110, 176], [246, 238, 222]); },
  awningGreen() { return stripes([70, 150, 104], [246, 238, 222]); },
  awningGold() { return stripes([222, 170, 60], [250, 242, 222]); },

  bannerBlue() { return banner([34, 78, 132], [233, 204, 126]); },
  bannerRed() { return banner([150, 44, 44], [240, 220, 160]); },
  bannerTeal() { return banner([30, 110, 110], [210, 250, 240]); },

  // soft vertical gradient used for light beams / waterfalls
  beam() {
    const [c, ctx] = mk(64, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.25, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 256);
    const h = ctx.createLinearGradient(0, 0, 64, 0);
    h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = h; ctx.fillRect(0, 0, 64, 256);
    return toTex(c, { repeat: false, mip: false });
  },

  // cloth / paper strip for shide & ribbons
  paper() {
    const S = 128, [c, ctx] = mk(S), rng = new RNG(141);
    ctx.fillStyle = rgb(250, 248, 240); ctx.fillRect(0, 0, S, S);
    strokes(ctx, rng, S, 120, 4, 12, 1, 2, [[230, 226, 214]], 0.2, 0.4);
    return toTex(c);
  },
};

function stripes(a, b) {
  const S = 128, [c, ctx] = mk(S), rng = new RNG(a[0] + a[1]);
  const n = 8;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = rgb(...(i % 2 ? b : a));
    ctx.fillRect(i * S / n, 0, S / n, S);
  }
  strokes(ctx, rng, S, 200, 6, 16, 1, 3, [[255, 255, 255], [0, 0, 0]], 0.03, 0.08, Math.PI / 2, 0.2);
  return toTex(c);
}

function banner(bg, fg) {
  const W = 128, H = 256, [c, ctx] = mk(W, H);
  ctx.fillStyle = rgb(...bg); ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = rgb(...fg); ctx.lineWidth = 5; ctx.strokeRect(10, 10, W - 20, H - 40);
  ctx.fillStyle = rgb(...fg);
  ctx.beginPath(); ctx.moveTo(0, H - 30); ctx.lineTo(W / 2, H); ctx.lineTo(W, H - 30); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
  ctx.clearRect(0, 0, 0, 0);
  // wind crest
  ctx.save(); ctx.translate(W / 2, H * 0.42); ctx.strokeStyle = rgb(...fg); ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, 0, 38, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.stroke(); ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(-28, 4); ctx.bezierCurveTo(-12, -28, 32, -24, 18, 2); ctx.bezierCurveTo(10, 16, -8, 8, 0, -2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-26, 18); ctx.lineTo(8, 18); ctx.stroke();
  ctx.restore();
  const t = toTex(c, { repeat: false });
  return t;
}

export function getTex(name) {
  if (!cache.has(name)) {
    const fn = GEN[name];
    if (!fn) throw new Error('unknown texture ' + name);
    cache.set(name, fn());
  }
  return cache.get(name);
}

export function pregenTextures() {
  for (const k of Object.keys(GEN)) getTex(k);
}

// ---------------------------------------------------------------------------
// Character face decal: big anime eyes. Two frames stacked vertically (open / closed).
export function makeFaceTexture({ iris = [70, 120, 160], brow = [70, 50, 40], lash = [30, 22, 20], mouth = [150, 70, 70], blush = true, eyeScale = 1.32 } = {}) {
  const W = 256, H = 256, [c, ctx] = mk(W, H);
  ctx.clearRect(0, 0, W, H);
  const drawFrame = (oy, closed) => {
    const cy = oy + 60;
    for (const s of [-1, 1]) {
      const cx = W / 2 + s * 42;
      if (!closed) {
        ctx.fillStyle = '#fffdf8';
        ctx.beginPath(); ctx.ellipse(cx, cy, 17 * eyeScale, 22 * eyeScale, 0, 0, Math.PI * 2); ctx.fill();
        const g = ctx.createLinearGradient(0, cy - 20, 0, cy + 20);
        g.addColorStop(0, rgb(iris[0] * 0.45, iris[1] * 0.45, iris[2] * 0.45));
        g.addColorStop(1, rgb(Math.min(255, iris[0] * 1.3), Math.min(255, iris[1] * 1.3), Math.min(255, iris[2] * 1.3)));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(cx + s * 1, cy + 2, 13 * eyeScale, 18 * eyeScale, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgb(20, 16, 20);
        ctx.beginPath(); ctx.ellipse(cx + s * 1, cy + 3, 6 * eyeScale, 9 * eyeScale, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(cx - 6, cy - 9, 6.5, 8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + 6, cy + 10, 3.2, 0, Math.PI * 2); ctx.fill();
        // upper lash line
        ctx.strokeStyle = rgb(...lash); ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.ellipse(cx, cy + 2, 19 * eyeScale, 24 * eyeScale, 0, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + s * 21, cy - 15); ctx.lineTo(cx + s * 30, cy - 20); ctx.stroke();
      } else {
        ctx.strokeStyle = rgb(...lash); ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.ellipse(cx, cy - 2, 17, 9, 0, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
      }
      // brow
      ctx.strokeStyle = rgb(...brow); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(cx - s * 15, cy - 42); ctx.quadraticCurveTo(cx + s * 2, cy - 50, cx + s * 19, cy - 44); ctx.stroke();
      if (blush) {
        const g = ctx.createRadialGradient(cx + s * 8, cy + 30, 0, cx + s * 8, cy + 30, 16);
        g.addColorStop(0, 'rgba(255,140,140,0.45)'); g.addColorStop(1, 'rgba(255,140,140,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx + s * 8, cy + 30, 16, 0, Math.PI * 2); ctx.fill();
      }
    }
    // mouth
    ctx.strokeStyle = rgb(...mouth); ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(W / 2 - 8, cy + 44); ctx.quadraticCurveTo(W / 2, cy + 49, W / 2 + 8, cy + 44); ctx.stroke();
  };
  drawFrame(0, false);
  drawFrame(128, true);
  const t = toTex(c, { repeat: false });
  return t;
}

// Wisp mask texture (white oni-style mask with red markings)
export function makeMaskTexture() {
  const S = 256, [c, ctx] = mk(S);
  ctx.fillStyle = '#f4efe6'; ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#b3242a';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(S / 2 + s * 20, 70); ctx.quadraticCurveTo(S / 2 + s * 70, 40, S / 2 + s * 100, 80); ctx.quadraticCurveTo(S / 2 + s * 60, 70, S / 2 + s * 24, 90); ctx.fill();
    ctx.beginPath(); ctx.moveTo(S / 2 + s * 40, 150); ctx.lineTo(S / 2 + s * 95, 170); ctx.lineTo(S / 2 + s * 42, 162); ctx.fill();
  }
  ctx.fillStyle = '#140c16';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(S / 2 + s * 44, 112, 22, 11, s * 0.35, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#ffd36b';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(S / 2 + s * 44, 112, 5, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#140c16'; ctx.beginPath(); ctx.moveTo(S / 2 - 34, 196); ctx.quadraticCurveTo(S / 2, 222, S / 2 + 34, 196); ctx.quadraticCurveTo(S / 2, 208, S / 2 - 34, 196); ctx.fill();
  return toTex(c, { repeat: false });
}

// Wooden sign board with Chinese text
export function makeSignTexture(lines, { w = 256, h = 96, bg = [150, 110, 72] } = {}) {
  const [c, ctx] = mk(w, h), rng = new RNG(lines.join('').length + 7);
  ctx.fillStyle = rgb(...bg); ctx.fillRect(0, 0, w, h);
  strokes(ctx, rng, w, 140, 20, 60, 1, 3, [[110, 76, 48], [190, 150, 110]], 0.2, 0.4, 0, 0.05);
  ctx.strokeStyle = rgb(90, 60, 38); ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6);
  ctx.fillStyle = '#2b1d10';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const fs = Math.floor(h / (lines.length + 0.6) * 0.78);
  ctx.font = `${fs}px KaiTi, STKaiti, "楷体", serif`;
  lines.forEach((ln, i) => ctx.fillText(ln, w / 2, h * (i + 1) / (lines.length + 1)));
  return toTex(c, { repeat: false });
}
