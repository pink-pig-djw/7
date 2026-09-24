// Small reusable props assembled through the Batcher.
import * as THREE from 'three';
import { mat4, boxGeo, cylGeo, latheGeo, mergeGroup } from './geom.js';
import { toonMat, defineMaterial, M } from '../gfx/materials.js';
import { makeSignTexture, getTex } from '../gfx/textures.js';
import { PAL } from './kit.js';
import { RNG } from '../core/util.js';

// shared lantern glass whose glow is raised when the city wakes up
defineMaterial('lantern', () => toonMat({ color: 0xffe6a8, emissive: 0xffc860, emissiveIntensity: 0.25, rim: 0.2, variation: [0, 1] }));

const tmp = new THREE.Matrix4();
function L(W, x, y, z, rx = 0, ry = 0, rz = 0) { return tmp.copy(W).multiply(mat4(x, y, z, rx, ry, rz)).clone(); }
function lb(B, W, mat, x, y, z, w, h, d, c, o = {}) { B.add(mat, boxGeo(w, h, d), L(W, x, y, z, o.rx || 0, o.ry || 0, o.rz || 0), c, o); }

export function lampPost(B, phys, x, z, ry = 0, { y = 0, h = 3.8 } = {}) {
  const W = mat4(x, y, z, 0, ry, 0);
  B.add('metal', cylGeo(0.07, 0.09, h, 8), L(W, 0, h / 2, 0), 0x3a3d44);
  B.add('metal', cylGeo(0.18, 0.22, 0.35, 8), L(W, 0, 0.17, 0), 0x3a3d44);
  lb(B, W, 'metal', 0.35, h - 0.1, 0, 0.75, 0.07, 0.07, 0x3a3d44);
  // lantern hanging from the arm
  lb(B, W, 'lantern', 0.68, h - 0.55, 0, 0.3, 0.42, 0.3, 0xffffff);
  lb(B, W, 'metal', 0.68, h - 0.3, 0, 0.4, 0.06, 0.4, 0x2d3036);
  lb(B, W, 'metal', 0.68, h - 0.79, 0, 0.36, 0.05, 0.36, 0x2d3036);
  B.add('metal', new THREE.ConeGeometry(0.28, 0.25, 4), L(W, 0.68, h - 0.14, 0, 0, Math.PI / 4, 0), 0x2d3036);
  if (phys) phys.addCyl(x, z, 0.2, y, y + h, { blockCam: false });
  // return the lantern world position (for wind chimes / lights)
  const p = new THREE.Vector3(0.68, h - 0.9, 0).applyMatrix4(W);
  return p;
}

export function bench(B, phys, x, z, ry = 0, y = 0) {
  const W = mat4(x, y, z, 0, ry, 0);
  lb(B, W, 'wood', 0, 0.45, 0, 1.8, 0.08, 0.5, 0x8a5e3c);
  lb(B, W, 'wood', 0, 0.85, -0.22, 1.8, 0.35, 0.06, 0x8a5e3c, { rx: -0.12 });
  for (const s of [-1, 1]) {
    lb(B, W, 'metal', s * 0.75, 0.22, 0, 0.08, 0.44, 0.45, 0x3a3d44);
    lb(B, W, 'metal', s * 0.75, 0.66, -0.2, 0.08, 0.5, 0.06, 0x3a3d44);
  }
  if (phys) {
    phys.addBox(x, y + 0.25, z, 0.9, 0.25, 0.27, ry);
    // backrest (local z = -0.22)
    phys.addBox(x - Math.sin(ry) * 0.22, y + 0.78, z - Math.cos(ry) * 0.22, 0.9, 0.28, 0.07, ry, { walkable: false, blockCam: false });
  }
}

export function barrel(B, phys, x, z, y = 0, color = 0x8a5a36) {
  const W = mat4(x, y, z);
  B.add('wood', latheGeo([[0.001, 0], [0.34, 0], [0.4, 0.2], [0.42, 0.45], [0.4, 0.7], [0.34, 0.9], [0.001, 0.9]], 12), W, color);
  for (const yy of [0.15, 0.75]) B.add('metal', new THREE.TorusGeometry(0.4, 0.025, 4, 16), L(W, 0, yy, 0, Math.PI / 2), 0x4a4540);
  if (phys) phys.addCyl(x, z, 0.4, y, y + 0.9);
}

export function crate(B, phys, x, z, ry = 0, s = 1, y = 0) {
  const W = mat4(x, y, z, 0, ry, 0);
  lb(B, W, 'wood', 0, s / 2, 0, s, s, s, 0xb88a5a);
  for (const a of [-1, 1]) {
    lb(B, W, 'wood', a * (s / 2 - 0.05), s / 2, s / 2 + 0.01, 0.1, s, 0.04, 0x8a5e3c);
    lb(B, W, 'wood', 0, s / 2 + a * (s / 2 - 0.05), s / 2 + 0.01, s, 0.1, 0.04, 0x8a5e3c);
  }
  if (phys) phys.addBox(x, y + s / 2, z, s / 2, s / 2, s / 2, ry);
}

export function planter(B, phys, x, z, w, d, ry = 0, y = 0, seed = 1) {
  const r = new RNG(seed);
  const W = mat4(x, y, z, 0, ry, 0);
  lb(B, W, 'stone', 0, 0.3, 0, w, 0.6, d, 0xd8d0bf, { ao: 0.6 });
  lb(B, W, 'plain', 0, 0.58, 0, w - 0.2, 0.06, d - 0.2, 0x5a4030);
  const n = Math.floor(w * d * 3);
  for (let i = 0; i < n; i++) {
    const fx = r.range(-w / 2 + 0.2, w / 2 - 0.2), fz = r.range(-d / 2 + 0.2, d / 2 - 0.2);
    B.add('plain', new THREE.IcosahedronGeometry(r.range(0.14, 0.24), 0), L(W, fx, 0.68 + r.range(0, 0.1), fz), r.chance(0.5) ? 0x4f8f3f : 0x6aa848);
    if (r.chance(0.6)) B.add('plain', new THREE.IcosahedronGeometry(r.range(0.07, 0.1), 0), L(W, fx + r.range(-0.1, 0.1), 0.85 + r.range(0, 0.1), fz + r.range(-0.1, 0.1)), r.pick(PAL.flower));
  }
  // not a platform: the plants would poke through the player's legs
  if (phys) phys.addBox(x, y + 0.45, z, w / 2, 0.45, d / 2, ry, { walkable: false, blockCam: false });
}

// Japanese stone lantern (toro)
export function stoneLantern(B, phys, x, z, y = 0, s = 1) {
  const W = mat4(x, y, z, 0, Math.PI / 4, 0);
  const c = 0xc8c4b4;
  lb(B, W, 'stone', 0, 0.12 * s, 0, 0.9 * s, 0.24 * s, 0.9 * s, c);
  B.add('stone', cylGeo(0.14 * s, 0.18 * s, 1.1 * s, 8), L(W, 0, 0.8 * s, 0), c);
  lb(B, W, 'stone', 0, 1.42 * s, 0, 0.7 * s, 0.16 * s, 0.7 * s, c);
  lb(B, W, 'lantern', 0, 1.72 * s, 0, 0.42 * s, 0.42 * s, 0.42 * s, 0xffffff);
  for (const a of [-1, 1]) for (const b of [-1, 1]) lb(B, W, 'stone', a * 0.24 * s, 1.72 * s, b * 0.24 * s, 0.08 * s, 0.44 * s, 0.08 * s, c);
  B.add('stone', new THREE.ConeGeometry(0.62 * s, 0.4 * s, 4), L(W, 0, 2.13 * s, 0, 0, Math.PI / 4, 0), c);
  B.add('stone', new THREE.SphereGeometry(0.1 * s, 8, 6), L(W, 0, 2.4 * s, 0), c);
  if (phys) phys.addCyl(x, z, 0.45 * s, y, y + 2.4 * s);
}

export function well(B, phys, x, z, y = 0) {
  const W = mat4(x, y, z);
  B.add('stone', latheGeo([[1.0, 0], [1.05, 0.9], [0.8, 0.9], [0.8, 0.2], [0.001, 0.2]], 16), W, 0xd0c8b4);
  B.add('glass', new THREE.CircleGeometry(0.8, 16).rotateX(-Math.PI / 2), L(W, 0, 0.35, 0), 0xffffff);
  for (const s of [-1, 1]) lb(B, W, 'wood', s * 0.9, 1.4, 0, 0.14, 1.4, 0.14, 0x6b4a33);
  lb(B, W, 'wood', 0, 2.1, 0, 2.0, 0.12, 0.12, 0x6b4a33);
  B.add('roof', new THREE.ConeGeometry(1.5, 0.8, 4).rotateY(Math.PI / 4), L(W, 0, 2.5, 0), 0xc9573e);
  if (phys) phys.addCyl(x, z, 1.05, y, y + 1);
}

export function fence(B, phys, pts, { y = null, h = 1.0, heightFn = null, color = 0x8a6a48 } = {}) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(1, Math.round(len / 2.2));
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      const yy = heightFn ? heightFn(x, z) : y || 0;
      B.box('wood', x, yy + h / 2, z, 0.14, h, 0.14, 0, color);
    }
    // local +x along the segment a->b so a positive pitch rises toward b
    const ry = Math.atan2(-(z2 - z1), x2 - x1);
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const xa = x1 + (x2 - x1) * t0, za = z1 + (z2 - z1) * t0, xb = x1 + (x2 - x1) * t1, zb = z1 + (z2 - z1) * t1;
      const ya = heightFn ? heightFn(xa, za) : y || 0, yb = heightFn ? heightFn(xb, zb) : y || 0;
      const sl = Math.hypot(xb - xa, zb - za);
      const pitch = Math.atan2(yb - ya, sl);
      for (const hh of [0.4, 0.8]) B.add('wood', boxGeo(sl, 0.08, 0.06), mat4((xa + xb) / 2, (ya + yb) / 2 + hh * h, (za + zb) / 2, 0, ry, pitch), color);
      if (phys) phys.addBox((xa + xb) / 2, (ya + yb) / 2 + h / 2, (za + zb) / 2, sl / 2, h / 2 + 0.3, 0.12, ry, { walkable: false, blockCam: false });
    }
  }
}

export function signpost(zone, x, y, z, ry, boards) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  const wood = toonMat({ color: 0x7a5236, map: getTex('wood'), rim: 0.2 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.6, 8), wood);
  post.position.y = 1.3; post.castShadow = true;
  g.add(post);
  boards.forEach((b, i) => {
    const tex = makeSignTexture([b.text], { w: 256, h: 64 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.36, 0.06), [wood, wood, wood, wood, toonMat({ map: tex, rim: 0.1 }), toonMat({ map: tex, rim: 0.1 })]);
    m.position.set(b.dir * 0.55, 2.2 - i * 0.45, 0);
    m.rotation.y = b.ry || 0;
    m.castShadow = true;
    g.add(m);
  });
  zone.add(g);
  if (zone.physics) {
    zone.physics.addCyl(x, z, 0.15, y, y + 2.6, { blockCam: false });
    // boards hang at chest-to-head height out to either side of the post
    zone.physics.addBox(x, y + 1.75, z, 1.32, 0.66, 0.08, ry, { walkable: false, blockCam: false });
  }
  return g;
}

// sacred rope with paper streamers between two points
export function shimenawa(zone, a, b, sag = 0.6, thick = 0.14) {
  const g = new THREE.Group();
  const mid = a.clone().lerp(b, 0.5); mid.y -= sag;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, thick, 6, false), toonMat({ color: 0xe0c98a, rim: 0.3 }));
  rope.castShadow = true;
  g.add(rope);
  const rope2 = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, thick * 0.55, 5, false), toonMat({ color: 0xc8ae6a, rim: 0.2 }));
  rope2.position.y = -thick * 0.2;
  g.add(rope2);
  const paper = M('paper');
  for (let i = 1; i < 6; i++) {
    const p = curve.getPoint(i / 6);
    const s = new THREE.Group();
    s.position.copy(p);
    for (let k = 0; k < 4; k++) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.18), paper);
      q.position.set((k % 2) * 0.08 - 0.04, -0.12 - k * 0.16, 0);
      q.rotation.y = Math.PI / 2 * 0;
      s.add(q);
    }
    s.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
    g.add(s);
  }
  mergeGroup(g);
  zone.add(g);
  return g;
}

export function cart(B, phys, x, z, ry = 0, y = 0) {
  const W = mat4(x, y, z, 0, ry, 0);
  lb(B, W, 'wood', 0, 0.8, 0, 1.6, 0.12, 2.4, 0x9a6a44);
  for (const s of [-1, 1]) lb(B, W, 'wood', s * 0.78, 1.05, 0, 0.08, 0.45, 2.4, 0x8a5e3c);
  lb(B, W, 'wood', 0, 1.05, 1.18, 1.6, 0.45, 0.08, 0x8a5e3c);
  for (const s of [-1, 1]) {
    B.add('wood', cylGeo(0.5, 0.5, 0.1, 12), L(W, s * 0.9, 0.5, -0.3, 0, 0, Math.PI / 2), 0x6b4a33);
    lb(B, W, 'wood', s * 0.4, 0.75, -1.9, 0.08, 0.08, 1.6, 0x6b4a33, { rx: 0.25 });
  }
  for (let i = 0; i < 5; i++) B.add('plain', new THREE.IcosahedronGeometry(0.12, 1), L(W, (i % 3) * 0.3 - 0.3, 1.0, (i - 2) * 0.35), [0xe8453a, 0xf29a2e, 0x8cc84b][i % 3]);
  if (phys) {
    phys.addBox(x, y + 0.6, z, 0.95, 0.6, 1.3, ry);
    // shafts sticking out behind (local z -1.1 .. -2.7)
    phys.addBox(x - Math.sin(ry) * 1.9, y + 0.55, z - Math.cos(ry) * 1.9, 0.48, 0.45, 0.8, ry, { walkable: false, blockCam: false });
  }
}

export function boat(B, x, y, z, ry = 0) {
  const W = mat4(x, y, z, 0, ry, 0);
  B.add('wood', latheGeo([[0.001, -0.3], [0.5, -0.25], [0.7, 0.05], [0.72, 0.2], [0.001, 0.2]], 10), L(W, 0, 0, 0, 0, 0, 0).multiply(new THREE.Matrix4().makeScale(1, 1, 3.2)), 0x8a5a36);
  lb(B, W, 'wood', 0, 0.05, 0, 1.1, 0.06, 0.3, 0xa87a50);
}
