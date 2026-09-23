// Modular architecture kit. Everything is assembled from a few reusable pieces
// (wall box, timber beams, window, door, balcony, roof slab, gable, chimney,
// arch, column, crenellation) and merged by the Batcher.
import * as THREE from 'three';
import { RNG } from '../core/util.js';
import { mat4, boxGeo, prismGeo, cylGeo, latheGeo, archRingGeo, archWallGeo } from './geom.js';

export const PAL = {
  plaster: [0xf6eedb, 0xf3e3c3, 0xf5dccb, 0xe6efe9, 0xf1e8d2, 0xeadcc0, 0xf7e9d9, 0xe3e8f0],
  timber: [0x5e4130, 0x6b4a33, 0x4f3829],
  roof: [0xc9573e, 0xd2693f, 0xb94c3a, 0xc9573e, 0xd97a4a, 0x4d6b95, 0x3f8a8a],
  shutter: [0x3d6b8f, 0x4f8a5a, 0xa8483c, 0x2f6d73, 0xc9a44a, 0x7a5aa0],
  stone: [0xe4dccb, 0xd8d0bf, 0xd0c7b3, 0xe8e2d4],
  flower: [0xe8445a, 0xf07aa0, 0xf5d547, 0xffffff, 0x9d6ee8, 0xf08a3c],
};

const tmpM = new THREE.Matrix4();
// compose world matrix W with a local transform
function L(W, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return tmpM.copy(W).multiply(mat4(x, y, z, rx, ry, rz, sx, sy, sz)).clone();
}
function lbox(B, W, mat, x, y, z, w, h, d, color, opts = {}) {
  B.add(mat, boxGeo(w, h, d, { uvOff: opts.uvOff || [x * 0.31, y * 0.17] }), L(W, x, y, z, opts.rx || 0, opts.ry || 0, opts.rz || 0), color, opts);
}

// ---------------------------------------------------------------------------
// Window on a wall face. W = face frame (z=0 plane, +z out of wall), u = centre x, v = sill height
export function windowPiece(B, W, u, v, { w = 0.95, h = 1.3, shutter = 0x3d6b8f, frame = 0xf2ece0, flowers = false, arch = false, rng = null } = {}) {
  const r = rng || new RNG(7);
  // glass
  lbox(B, W, 'glass', u, v + h / 2, 0.035, w, h, 0.05, 0xffffff);
  // frame bars
  lbox(B, W, 'wood', u, v + h + 0.04, 0.06, w + 0.2, 0.11, 0.1, frame);
  lbox(B, W, 'wood', u, v - 0.02, 0.07, w + 0.3, 0.1, 0.18, frame);
  lbox(B, W, 'wood', u - w / 2 - 0.05, v + h / 2, 0.06, 0.1, h, 0.1, frame);
  lbox(B, W, 'wood', u + w / 2 + 0.05, v + h / 2, 0.06, 0.1, h, 0.1, frame);
  lbox(B, W, 'wood', u, v + h * 0.58, 0.07, w, 0.06, 0.06, frame);
  lbox(B, W, 'wood', u, v + h / 2, 0.07, 0.06, h, 0.06, frame);
  if (arch) {
    B.add('stone', archRingGeo(w / 2 + 0.05, w / 2 + 0.28, 0.14, 8), L(W, u, v + h, 0.06), 0xe8e0cc);
    B.add('glass', new THREE.CircleGeometry(w / 2 + 0.05, 10, 0, Math.PI), L(W, u, v + h, 0.04), 0xffffff);
  }
  if (shutter !== null) {
    for (const s of [-1, 1]) {
      const a = s * (0.35 + r.range(0, 0.4));
      const sx = u + s * (w / 2 + 0.33);
      lbox(B, W, 'wood', sx, v + h / 2, 0.14, w * 0.52, h + 0.05, 0.05, shutter, { ry: a });
      lbox(B, W, 'wood', sx, v + h * 0.3, 0.17, w * 0.44, 0.05, 0.03, 0x000000 + (shutter & 0x7f7f7f), { ry: a });
      lbox(B, W, 'wood', sx, v + h * 0.72, 0.17, w * 0.44, 0.05, 0.03, 0x000000 + (shutter & 0x7f7f7f), { ry: a });
    }
  }
  if (flowers) {
    lbox(B, W, 'wood', u, v - 0.16, 0.2, w + 0.1, 0.24, 0.3, 0x8a5a3a);
    const n = 5 + r.int(0, 3);
    for (let i = 0; i < n; i++) {
      const fx = u - w / 2 + 0.1 + (w - 0.2) * (i / (n - 1));
      const col = r.pick(PAL.flower);
      B.add('plain', new THREE.IcosahedronGeometry(0.13 + r.range(0, 0.06), 0), L(W, fx, v - 0.02 + r.range(0, 0.06), 0.22 + r.range(-0.05, 0.05)), 0x4f8f3f);
      B.add('plain', new THREE.IcosahedronGeometry(0.08 + r.range(0, 0.04), 0), L(W, fx + r.range(-0.05, 0.05), v + 0.08 + r.range(0, 0.06), 0.26), col);
    }
  }
}

export function doorPiece(B, W, u, { w = 1.35, h = 2.4, color = 0x6b4630, stone = 0xe6dfcf, step = true } = {}) {
  lbox(B, W, 'wood', u, h / 2, 0.04, w, h, 0.08, color);
  lbox(B, W, 'wood', u - w * 0.22, h / 2, 0.09, 0.05, h * 0.95, 0.03, 0x3a261a);
  lbox(B, W, 'wood', u + w * 0.22, h / 2, 0.09, 0.05, h * 0.95, 0.03, 0x3a261a);
  lbox(B, W, 'metal', u + w * 0.3, h * 0.48, 0.12, 0.08, 0.08, 0.06, 0x4a4540);
  // stone surround + arch top
  lbox(B, W, 'stone', u - w / 2 - 0.16, h / 2, 0.08, 0.3, h, 0.18, stone);
  lbox(B, W, 'stone', u + w / 2 + 0.16, h / 2, 0.08, 0.3, h, 0.18, stone);
  B.add('stone', archRingGeo(w / 2, w / 2 + 0.32, 0.18, 8), L(W, u, h, 0.08), stone);
  B.add('wood', new THREE.CircleGeometry(w / 2 + 0.02, 10, 0, Math.PI), L(W, u, h, 0.05), color);
  if (step) lbox(B, W, 'stone', u, 0.08, 0.35, w + 0.6, 0.16, 0.6, stone);
}

// sloped roof slab. ridge line along local x at height yR (z=0), slopes toward +z (side=1) or -z (side=-1)
function roofSlab(B, W, len, half, yR, pitchAng, side, color, { t = 0.2, over = 0.55, ox = 0, oz = 0 } = {}) {
  const Lr = half / Math.cos(pitchAng) + over;
  const a = pitchAng;
  // top-ridge point (0, t/2, -Lr/2) rotated by a about x
  const ly = (t / 2) * Math.cos(a) + (Lr / 2) * Math.sin(a);
  const lz = (t / 2) * Math.sin(a) - (Lr / 2) * Math.cos(a);
  const cy = yR + 0.04 - ly;
  const cz = -lz;
  B.add('roof', boxGeo(len, t, Lr), L(W, ox, cy, oz + side * cz, side * a, 0, 0), color);
}

/**
 * Gable roof on a rectangular block. W = building frame (origin at ground centre)
 * axis 'x' => ridge along x.
 */
export function gableRoof(B, W, w, d, y0, { pitch = 0.95, axis = 'x', roofColor = 0xc9573e, gable = 0xf3e8d3, timber = null, overGable = 0.35, over = 0.55 } = {}) {
  const Wl = axis === 'x' ? W : L(W, 0, 0, 0, 0, Math.PI / 2, 0);
  const len = axis === 'x' ? w : d;
  const span = axis === 'x' ? d : w;
  const half = span / 2;
  const a = Math.atan(pitch);
  const rise = half * pitch;
  const yR = y0 + rise;
  // gable volume (prism with ridge along local x)
  B.add('plaster', prismGeo(span, rise, len), L(Wl, 0, y0, 0, 0, Math.PI / 2, 0), gable);
  roofSlab(B, Wl, len + overGable * 2, half, yR, a, 1, roofColor, { over });
  roofSlab(B, Wl, len + overGable * 2, half, yR, a, -1, roofColor, { over });
  B.add('roof', boxGeo(len + overGable * 2 + 0.1, 0.16, 0.3), L(Wl, 0, yR + 0.12, 0), new THREE.Color(roofColor).multiplyScalar(0.7));
  if (timber !== null) {
    // king post + struts on both gable ends
    for (const s of [-1, 1]) {
      const gx = s * (len / 2 + 0.035);
      lbox(B, Wl, 'wood', gx, y0 + rise * 0.5, 0, 0.07, rise, 0.16, timber);
      lbox(B, Wl, 'wood', gx, y0 + 0.08, 0, 0.08, 0.16, span, timber);
      const sl = Math.hypot(half * 0.6, rise * 0.55);
      for (const k of [-1, 1]) {
        lbox(B, Wl, 'wood', gx, y0 + rise * 0.3, k * half * 0.3, 0.07, sl, 0.14, timber, { rx: -k * Math.atan2(half * 0.6, rise * 0.55) });
      }
    }
  }
  return yR;
}

export function hipRoof(B, W, w, d, y0, { h = 3, color = 0xc9573e, over = 0.5 } = {}) {
  const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  g.rotateY(Math.PI / 4);
  g.translate(0, 0.5, 0);
  B.add('roof', g, L(W, 0, y0, 0, 0, 0, 0, w + over * 2, h, d + over * 2), color);
  return y0 + h;
}

// ---------------------------------------------------------------------------
/**
 * Timber-frame house. Local frame: front face at +z. Origin at ground centre.
 * spec: x,z,ry,w,d,floors,seed,roofAxis,style('timber'|'stone'|'plaster'),balcony,door,chimney,
 *       baseY (ground height)
 */
export function house(B, phys, spec) {
  const r = new RNG(spec.seed || 1);
  const x = spec.x, z = spec.z, ry = spec.ry || 0, by = spec.baseY || 0;
  const w = spec.w || 8, d = spec.d || 7;
  const floors = spec.floors || 2;
  const gH = 3.2, fH = 2.9;
  const W = mat4(x, by, z, 0, ry, 0);
  const plaster = spec.plaster !== undefined ? spec.plaster : r.pick(PAL.plaster);
  const timber = spec.timber !== undefined ? spec.timber : r.pick(PAL.timber);
  const roofC = spec.roof !== undefined ? spec.roof : r.pick(PAL.roof);
  const shutter = spec.shutter !== undefined ? spec.shutter : r.pick(PAL.shutter);
  const stoneC = r.pick(PAL.stone);
  const style = spec.style || (r.chance(0.7) ? 'timber' : 'plaster');
  const jet = style === 'timber' ? 0.22 : 0.0;

  // ground floor (stone)
  lbox(B, W, 'stone', 0, gH / 2, 0, w, gH, d, stoneC, { ao: 1.2 });
  lbox(B, W, 'stone', 0, 0.25, 0, w + 0.12, 0.5, d + 0.12, new THREE.Color(stoneC).multiplyScalar(0.86));
  // upper floors
  let y = gH;
  for (let f = 1; f < floors; f++) {
    const fw = w + jet * 2 * f * 0.5, fd = d + jet * 2;
    lbox(B, W, 'plaster', 0, y + fH / 2, 0, fw, fH, fd, plaster);
    lbox(B, W, 'wood', 0, y + 0.1, 0, fw + 0.08, 0.22, fd + 0.08, timber);
    if (style === 'timber') timberFaces(B, W, fw, fd, y, fH, timber, r, spec.lite);
    y += fH;
  }
  const eave = y;
  lbox(B, W, 'wood', 0, eave - 0.06, 0, w + jet * floors + 0.1, 0.16, d + jet * 2 + 0.1, timber);

  // windows & door on front (+z) and back (-z); lite houses only detail the front
  const bays = Math.max(2, Math.round(w / 2.4));
  const bayW = w / bays;
  const doorBay = spec.doorBay !== undefined ? spec.doorBay : Math.floor(bays / 2);
  for (const side of spec.lite ? [1] : [1, -1]) {
    const Fz = mat4(0, 0, side * (d / 2), 0, side === 1 ? 0 : Math.PI, 0);
    const F0 = tmpM.copy(W).multiply(Fz).clone();
    for (let b = 0; b < bays; b++) {
      const u = -w / 2 + bayW * (b + 0.5);
      if (side === 1 && b === doorBay && spec.door !== false) {
        doorPiece(B, F0, u, { color: r.pick([0x6b4630, 0x5a3a28, 0x3d5a6b, 0x7a3a2a]) });
      } else if (r.chance(0.8)) {
        windowPiece(B, F0, u, 0.95, { w: 0.9, h: 1.2, shutter: null, frame: stoneC, arch: true, rng: r });
      }
    }
    let yy = gH;
    for (let f = 1; f < floors; f++) {
      const Fu = tmpM.copy(W).multiply(mat4(0, 0, side * (d / 2 + jet), 0, side === 1 ? 0 : Math.PI, 0)).clone();
      for (let b = 0; b < bays; b++) {
        const u = -w / 2 + bayW * (b + 0.5);
        if (r.chance(0.88)) windowPiece(B, Fu, u, yy + 0.75, { w: 0.9, h: 1.25, shutter, flowers: !spec.lite && side === 1 && r.chance(0.45), rng: r });
      }
      yy += fH;
    }
  }
  // side windows on upper floors
  for (const side of spec.lite ? [] : [1, -1]) {
    let yy = gH;
    for (let f = 1; f < floors; f++) {
      const Fs = tmpM.copy(W).multiply(mat4(side * (w / 2 + jet * f * 0.5), 0, 0, 0, side * Math.PI / 2, 0)).clone();
      if (d > 5 && r.chance(0.7)) windowPiece(B, Fs, 0, yy + 0.75, { w: 0.85, h: 1.15, shutter, rng: r });
      yy += fH;
    }
  }
  // balcony
  if (spec.balcony && floors > 1) {
    const F = tmpM.copy(W).multiply(mat4(0, 0, d / 2 + jet, 0, 0, 0)).clone();
    const bw = Math.min(w * 0.6, 4.2);
    const bx = spec.balconyX !== undefined ? spec.balconyX : 0;
    lbox(B, F, 'wood', bx, gH + 0.05, 0.55, bw, 0.14, 1.1, timber);
    for (let i = 0; i <= 6; i++) lbox(B, F, 'wood', bx - bw / 2 + (bw * i) / 6, gH + 0.55, 1.05, 0.07, 0.9, 0.07, timber);
    lbox(B, F, 'wood', bx, gH + 1.02, 1.05, bw + 0.08, 0.1, 0.12, timber);
    for (const s of [-1, 1]) {
      lbox(B, F, 'wood', bx + s * (bw / 2 - 0.1), gH + 0.55, 0.55, 0.07, 0.9, 1.0, timber, { ry: 0 });
      lbox(B, F, 'wood', bx + s * (bw / 2 - 0.3), gH - 0.35, 0.35, 0.12, 0.8, 0.12, timber, { rx: 0.7 });
    }
  }
  // roof
  const axis = spec.roofAxis || (w >= d ? 'x' : 'z');
  const pitch = spec.pitch || r.range(0.85, 1.15);
  const rw = w + jet * floors, rd = d + jet * 2;
  const yR = gableRoof(B, W, rw, rd, eave, { pitch, axis, roofColor: roofC, gable: plaster, timber: style === 'timber' ? timber : null });
  // chimney
  if (spec.chimney !== false && r.chance(0.65)) {
    const cx = (r.next() - 0.5) * rw * 0.5, cz = (r.next() - 0.5) * rd * 0.3;
    lbox(B, W, 'stone', cx, (eave + yR) / 2 + 0.9, cz, 0.7, yR - eave + 1.8, 0.7, stoneC);
    lbox(B, W, 'stone', cx, yR + 1.85, cz, 0.9, 0.2, 0.9, new THREE.Color(stoneC).multiplyScalar(0.8));
  }
  // colliders
  if (phys) {
    const hw = (w + jet * floors) / 2 + 0.05, hd = (d + jet * 2) / 2 + 0.05;
    phys.addBox(x, by + eave / 2, z, w / 2 + 0.05, eave / 2, d / 2 + 0.05, ry);
    phys.addBox(x, by + (eave + yR) / 2, z, hw * 0.85, (yR - eave) / 2, hd * 0.85, ry, { walkable: false });
  }
  return { eave, ridge: yR, W };
}

function timberFaces(B, W, fw, fd, y, fH, timber, r, lite = false) {
  const faces = [
    [0, 0, fd / 2, 0, fw], [0, 0, -fd / 2, Math.PI, fw],
    [fw / 2, 0, 0, Math.PI / 2, fd], [-fw / 2, 0, 0, -Math.PI / 2, fd],
  ];
  if (lite) faces.length = 1;
  for (const [fx, , fz, rot, len] of faces) {
    const F = tmpM.copy(W).multiply(mat4(fx, 0, fz, 0, rot, 0)).clone();
    const posts = Math.max(2, Math.round(len / 1.7));
    for (let i = 0; i <= posts; i++) {
      const u = -len / 2 + (len * i) / posts;
      lbox(B, F, 'wood', u, y + fH / 2, 0.04, 0.18, fH, 0.1, timber);
    }
    lbox(B, F, 'wood', 0, y + fH - 0.1, 0.04, len, 0.16, 0.1, timber);
    lbox(B, F, 'wood', 0, y + 0.62, 0.05, len, 0.12, 0.08, timber);
    // diagonal braces in outer bays
    const bw = len / posts;
    const diag = Math.hypot(bw, fH * 0.55);
    const ang = Math.atan2(fH * 0.55, bw);
    for (const k of [0, posts - 1]) {
      const u = -len / 2 + bw * (k + 0.5);
      const s = k === 0 ? 1 : -1;
      lbox(B, F, 'wood', u, y + 0.62 + fH * 0.27, 0.05, diag * 0.95, 0.12, 0.08, timber, { rz: s * ang });
    }
    void r;
  }
}

// ---------------------------------------------------------------------------
// Round tower with conical roof (towers, wall towers, bell towers)
export function roundTower(B, phys, { x, z, baseY = 0, r = 4, h = 18, roof = 0x4d6b95, stone = 0xddd5c3, crenel = false, roofH = null, windows = 3, band = true, finial = true }) {
  const W = mat4(x, baseY, z);
  B.add('stone', cylGeo(r, r * 1.06, h, 20), L(W, 0, h / 2, 0), stone, { ao: 3 });
  B.add('stone', cylGeo(r * 1.1, r * 1.12, 0.8, 20), L(W, 0, 0.4, 0), new THREE.Color(stone).multiplyScalar(0.85));
  if (band) for (let k = 1; k <= 2; k++) B.add('stone', cylGeo(r * 1.04, r * 1.04, 0.3, 20), L(W, 0, (h * k) / 3, 0), new THREE.Color(stone).multiplyScalar(0.9));
  // windows around
  for (let k = 0; k < windows; k++) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + k * 0.7;
      const F = tmpM.copy(W).multiply(mat4(Math.sin(a) * (r + 0.02), 0, Math.cos(a) * (r + 0.02), 0, a, 0)).clone();
      const vy = 3 + (k * (h - 6)) / Math.max(1, windows);
      lbox(B, F, 'glass', 0, vy + 0.7, 0.02, 0.7, 1.4, 0.1, 0xffffff);
      B.add('stone', archRingGeo(0.35, 0.6, 0.16, 7), L(F, 0, vy + 1.4, 0.04), 0xece6d8);
      lbox(B, F, 'stone', 0, vy - 0.05, 0.08, 1.0, 0.12, 0.2, 0xece6d8);
    }
  }
  let top = h;
  if (crenel) {
    B.add('stone', cylGeo(r * 1.15, r * 1.02, 1.0, 20), L(W, 0, h + 0.5, 0), stone);
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      lbox(B, W, 'stone', Math.sin(a) * r * 1.08, h + 1.5, Math.cos(a) * r * 1.08, 1.0, 1.0, 0.6, stone, { ry: a });
    }
    top = h + 2;
  }
  if (roof !== null) {
    const rh = roofH || r * 2.6;
    const R = r * 1.28;
    const prof = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      prof.push([R * Math.pow(1 - t, 1.35) + 0.02, rh * t]);
    }
    prof.unshift([R * 0.9, -0.3]);
    B.add('roof', latheGeo(prof.map(([a, b]) => [a, b]), 20, 0.5), L(W, 0, top, 0), roof);
    if (finial) {
      B.add('gold', new THREE.SphereGeometry(0.28, 10, 8), L(W, 0, top + rh + 0.2, 0), 0xffffff);
      B.add('metal', cylGeo(0.05, 0.05, 1.6, 6), L(W, 0, top + rh + 0.9, 0), 0x5a5550);
    }
    top += rh;
  }
  if (phys) phys.addCyl(x, z, r * 1.08, baseY, baseY + h + 1);
  return top;
}

// Crenellated wall segment between two points
export function wallSegment(B, phys, x1, z1, x2, z2, { h = 10, t = 4, baseY = 0, stone = 0xd9d1bf, merlons = true, walk = false } = {}) {
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const ry = Math.atan2(dx, dz) - Math.PI / 2;
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
  const W = mat4(cx, baseY, cz, 0, ry, 0);
  lbox(B, W, 'stone', 0, h / 2, 0, len, h, t, stone, { ao: 3 });
  lbox(B, W, 'stone', 0, 0.6, 0, len + 0.01, 1.2, t + 0.5, new THREE.Color(stone).multiplyScalar(0.84));
  lbox(B, W, 'stone', 0, h - 0.2, 0, len, 0.4, t + 0.4, new THREE.Color(stone).multiplyScalar(0.92));
  if (merlons) {
    const n = Math.max(1, Math.floor(len / 2.2));
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (len * (i + 0.5)) / n;
      for (const s of [-1, 1]) lbox(B, W, 'stone', u, h + 0.55, s * (t / 2 - 0.3), 1.2, 1.1, 0.6, stone);
    }
  }
  if (phys) phys.addBox(cx, baseY + h / 2 + 0.6, cz, len / 2, h / 2 + 0.6, t / 2 + 0.25, ry, { walkable: walk });
  return { len, ry };
}

export function stairs(B, phys, { x, z, ry = 0, y0 = 0, w = 6, steps = 8, rise = 0.25, run = 0.5, mat = 'stone', color = 0xe2dac8, sides = true }) {
  const W = mat4(x, y0, z, 0, ry, 0);
  for (let i = 0; i < steps; i++) {
    const hh = rise * (i + 1);
    const zc = -run * i - run / 2;
    lbox(B, W, mat, 0, hh / 2, zc, w, hh, run, color);
  }
  if (sides) {
    for (const s of [-1, 1]) {
      const len = run * steps;
      const hh = rise * steps;
      const ang = Math.atan2(hh, len);
      const sl = Math.hypot(hh, len);
      lbox(B, W, 'stone', s * (w / 2 + 0.25), hh / 2 + 0.2, -len / 2, 0.5, 0.5, sl, new THREE.Color(color).multiplyScalar(0.9), { rx: ang });
      lbox(B, W, 'stone', s * (w / 2 + 0.25), hh / 2 - 0.1, -len / 2, 0.5, hh - 0.2, len - 0.2, new THREE.Color(color).multiplyScalar(0.85));
    }
  }
  if (phys) {
    // a ramp collider is smoother than per-step boxes; it rises toward local -z
    const len = run * steps, top = rise * steps;
    const c = Math.cos(ry), s = Math.sin(ry);
    const lz = -len / 2;
    const wx = x + lz * s, wz = z + lz * c;
    phys.addRamp(wx, wz, w / 2, len / 2, ry, y0 + top, y0 + rise * 0.5, y0 - 0.5);
    if (sides) {
      for (const sd of [-1, 1]) {
        const ox = sd * (w / 2 + 0.25);
        phys.addBox(x + ox * c + lz * s, y0 + top / 2 + 0.3, z - ox * s + lz * c, 0.25, top / 2 + 0.3, len / 2, ry, { walkable: false });
      }
    }
  }
}

// Classical column with base and capital
export function column(B, x, y, z, { r = 0.45, h = 6, color = 0xf0ebe0, mat = 'marble', fluted = true, broken = 0 } = {}) {
  const W = mat4(x, y, z);
  const hh = broken > 0 ? h * (1 - broken) : h;
  B.add(mat, boxGeo(r * 2.6, 0.35, r * 2.6), L(W, 0, 0.175, 0), color);
  B.add(mat, cylGeo(r * 1.15, r * 1.25, 0.3, 16), L(W, 0, 0.5, 0), color);
  B.add(mat, cylGeo(r * 0.92, r, hh - 0.65 - (broken ? 0 : 0.6), fluted ? 12 : 16), L(W, 0, 0.65 + (hh - 0.65 - (broken ? 0 : 0.6)) / 2, 0), color);
  if (!broken) {
    B.add(mat, cylGeo(r * 1.25, r * 0.92, 0.35, 16), L(W, 0, h - 0.42, 0), color);
    B.add(mat, boxGeo(r * 2.7, 0.28, r * 2.7), L(W, 0, h - 0.12, 0), color);
  }
}

// Market stall with striped awning
export function stall(B, phys, { x, z, ry = 0, w = 3.2, d = 2.2, awning = 'awningRed', wood = 0x7a5236, goods = 'fruit', seed = 1 }) {
  const r = new RNG(seed);
  const W = mat4(x, 0, z, 0, ry, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const ph = sz > 0 ? 2.45 : 3.1;
    lbox(B, W, 'wood', sx * (w / 2 - 0.1), ph / 2, sz * (d / 2 - 0.1), 0.12, ph, 0.12, wood);
  }
  lbox(B, W, 'wood', 0, 0.9, 0.2, w - 0.1, 0.1, d * 0.62, wood);
  lbox(B, W, 'wood', 0, 0.45, 0.45, w - 0.2, 0.8, 0.08, new THREE.Color(wood).multiplyScalar(0.8));
  // awning (sloped toward the front)
  const aLen = d + 0.8, aAng = 0.3;
  const aY = 2.95;
  B.add(awning, boxGeo(w + 0.5, 0.05, aLen), L(W, 0, aY, 0.2, aAng, 0, 0), 0xffffff);
  const fz = 0.2 + (aLen / 2) * Math.cos(aAng), fy = aY - (aLen / 2) * Math.sin(aAng);
  // scalloped front edge
  for (let i = 0; i < 7; i++) {
    B.add(awning, boxGeo((w + 0.5) / 7 - 0.02, 0.3, 0.03), L(W, -(w + 0.5) / 2 + (w + 0.5) * (i + 0.5) / 7, fy - 0.15, fz), 0xffffff);
  }
  // goods
  const cols = goods === 'fruit' ? [0xe8453a, 0xf29a2e, 0xf5d547, 0x8cc84b, 0xb14fc4] : goods === 'pottery' ? [0xc27a50, 0xd9a066, 0x7a9ab0, 0xeae0d0] : [0x5a8fc4, 0xc44a5a, 0xe8c85a, 0x6ab07a];
  for (let i = 0; i < 4; i++) {
    const gx = -w / 2 + 0.5 + (w - 1) * (i / 3);
    lbox(B, W, 'wood', gx, 1.05, 0.2, 0.62, 0.2, 0.5, 0x9a6a44);
    const c = r.pick(cols);
    for (let k = 0; k < 5; k++) {
      if (goods === 'pottery') {
        B.add('plain', latheGeo([[0, 0], [0.12, 0.02], [0.16, 0.14], [0.1, 0.28], [0.08, 0.32], [0.1, 0.36]], 8), L(W, gx + r.range(-0.2, 0.2), 1.15, 0.2 + r.range(-0.15, 0.15)), c);
        break;
      }
      B.add('plain', new THREE.IcosahedronGeometry(0.09, 1), L(W, gx + r.range(-0.22, 0.22), 1.22 + r.range(0, 0.08), 0.2 + r.range(-0.15, 0.15)), c);
    }
  }
  if (phys) phys.addBox(x + Math.sin(ry) * 0.2, 0.5, z + Math.cos(ry) * 0.2, w / 2, 0.5, d * 0.35, ry, {});
}

// arched stone bridge along local z
export function bridge(B, phys, { x, z, ry = 0, len = 10, w = 5, deckY = 0.6, archR = 3.4, baseY = -3, color = 0xd9d1bf, parapet = 0.9 }) {
  const W = mat4(x, 0, z, 0, ry, 0);
  // arch sides (in local x = ±w/2 planes, arch along z)
  const Wa = L(W, 0, 0, 0, 0, Math.PI / 2, 0);
  const sideH = deckY - baseY;
  const archH = sideH - 0.8;
  const rr = Math.max(0.6, Math.min(archR, archH - 0.2, len / 2 - 0.8));
  for (const s of [-1, 1]) {
    B.add('stone', archWallGeo(len, sideH + 0.3, 0.6, rr * 2, archH, { segs: 14 }), L(Wa, 0, baseY, s * (w / 2 - 0.3)), color);
  }
  // deck + underside vault
  lbox(B, W, 'stone', 0, deckY - 0.2, 0, w, 0.4, len, new THREE.Color(color).multiplyScalar(0.95));
  B.add('stone', archRingGeo(rr, rr + 0.35, w - 0.6, 12), L(Wa, 0, baseY + archH - rr, 0), new THREE.Color(color).multiplyScalar(0.8));
  // parapets
  for (const s of [-1, 1]) {
    lbox(B, W, 'stone', s * (w / 2 - 0.25), deckY + parapet / 2, 0, 0.5, parapet, len, color);
    lbox(B, W, 'stone', s * (w / 2 - 0.25), deckY + parapet + 0.08, 0, 0.62, 0.16, len + 0.1, new THREE.Color(color).multiplyScalar(0.9));
  }
  if (phys) {
    const c = Math.cos(ry), sn = Math.sin(ry);
    phys.addBox(x, deckY - 0.4, z, w / 2, 0.4, len / 2, ry);
    for (const s of [-1, 1]) {
      const ox = s * (w / 2 - 0.25);
      phys.addBox(x + ox * c, deckY + parapet / 2, z - ox * sn, 0.25, parapet / 2, len / 2, ry, { walkable: false });
    }
  }
}

// Archway spanning a street (wall with arch opening)
export function archway(B, phys, { x, z, ry = 0, w = 8, h = 7, t = 1.6, aw = 4.5, ah = 5, color = 0xe0d8c6, roof = null }) {
  const W = mat4(x, 0, z, 0, ry, 0);
  B.add('stone', archWallGeo(w, h, t, aw, ah), W.clone(), color, { ao: 2 });
  lbox(B, W, 'stone', 0, h + 0.2, 0, w + 0.3, 0.4, t + 0.3, new THREE.Color(color).multiplyScalar(0.9));
  B.add('stone', archRingGeo(aw / 2, aw / 2 + 0.45, t + 0.12, 12), L(W, 0, ah - aw / 2, 0), new THREE.Color(color).multiplyScalar(1.03));
  if (roof !== null) gableRoof(B, W, w + 0.2, t + 1.2, h + 0.4, { pitch: 0.8, axis: 'x', roofColor: roof, gable: color });
  if (phys) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const pw = (w - aw) / 2;
    for (const sd of [-1, 1]) {
      const ox = sd * (aw / 2 + pw / 2);
      phys.addBox(x + ox * c, h / 2, z - ox * s, pw / 2, h / 2, t / 2, ry);
    }
    phys.addBox(x, (ah + h) / 2 + 0.2, z, aw / 2, (h - ah) / 2 + 0.2, t / 2, ry, { walkable: false });
  }
}
