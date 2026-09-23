// Small math / noise / geometry helpers shared across the game.

export const PI2 = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function wrapAngle(a) {
  a = (a + Math.PI) % PI2;
  if (a < 0) a += PI2;
  return a - Math.PI;
}
export const dampAngle = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));

export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed = 1) { this.r = mulberry32(seed); }
  next() { return this.r(); }
  range(a, b) { return a + (b - a) * this.r(); }
  int(a, b) { return Math.floor(a + (b - a + 1) * this.r()); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length) % arr.length]; }
  chance(p) { return this.r() < p; }
  sign() { return this.r() < 0.5 ? -1 : 1; }
}

// Hash of integer coords -> [0,1)
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// 2D simplex noise, returns [-1, 1]
export function makeNoise2D(seed = 1) {
  const rng = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = [1, -1, 1, -1, 1, -1, 0, 0];
  const gy = [1, 1, -1, -1, 0, 0, 1, -1];
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  return function noise(xin, yin) {
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = perm[ii + perm[jj]] & 7; t0 *= t0; n0 = t0 * t0 * (gx[g] * x0 + gy[g] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = perm[ii + i1 + perm[jj + j1]] & 7; t1 *= t1; n1 = t1 * t1 * (gx[g] * x1 + gy[g] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = perm[ii + 1 + perm[jj + 1]] & 7; t2 *= t2; n2 = t2 * t2 * (gx[g] * x2 + gy[g] * y2); }
    return 70 * (n0 + n1 + n2);
  };
}

export function fbm(noise, x, y, oct = 4, lac = 2.0, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise(x * f, y * f);
    n += a;
    a *= gain;
    f *= lac;
  }
  return s / n;
}

// Polyline in the XZ plane with closest-point queries (used for roads and rivers).
export class Polyline {
  constructor(points) {
    this.p = points.map((q) => [q[0], q[1]]);
    this.seg = [];
    let acc = 0;
    for (let i = 0; i < this.p.length - 1; i++) {
      const [ax, az] = this.p[i], [bx, bz] = this.p[i + 1];
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      this.seg.push({ ax, az, dx, dz, len, s0: acc });
      acc += len;
    }
    this.length = acc;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of this.p) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    this.bounds = { minX, minZ, maxX, maxZ };
  }
  // returns {d, s, x, z, tx, tz} distance, arc length, closest point, tangent
  closest(x, z, out = {}) {
    let best = Infinity, bs = 0, bx = 0, bz = 0, btx = 1, btz = 0;
    for (const g of this.seg) {
      let t = ((x - g.ax) * g.dx + (z - g.az) * g.dz) / (g.len * g.len);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = g.ax + g.dx * t, pz = g.az + g.dz * t;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < best) {
        best = d2; bs = g.s0 + g.len * t; bx = px; bz = pz;
        btx = g.dx / g.len; btz = g.dz / g.len;
      }
    }
    out.d = Math.sqrt(best); out.s = bs; out.x = bx; out.z = bz; out.tx = btx; out.tz = btz;
    return out;
  }
  pointAt(s, out = {}) {
    s = clamp(s, 0, this.length);
    for (const g of this.seg) {
      if (s <= g.s0 + g.len || g === this.seg[this.seg.length - 1]) {
        const t = g.len > 0 ? (s - g.s0) / g.len : 0;
        out.x = g.ax + g.dx * t; out.z = g.az + g.dz * t;
        out.tx = g.dx / g.len; out.tz = g.dz / g.len;
        return out;
      }
    }
    return out;
  }
  // Catmull-Rom resample for smoother curves
  static smooth(points, stepsPerSeg = 6) {
    const out = [];
    const n = points.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(n - 1, i + 2)];
      for (let k = 0; k < stepsPerSeg; k++) {
        const t = k / stepsPerSeg, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    out.push(points[n - 1]);
    return out;
  }
}

// yields to the browser; falls back to a timeout when rAF is paused (hidden tab)
export const nextFrame = () => new Promise((r) => {
  let done = false;
  const fin = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(fin);
  setTimeout(fin, 60);
});
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
