// Procedural anime-style characters with a simple joint rig and procedural animation.
import * as THREE from 'three';
import { toonMat, U } from '../gfx/materials.js';
import { makeFaceTexture } from '../gfx/textures.js';
import { damp, clamp, lerp } from '../core/util.js';

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + '|' + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, toonMat({ color, band: [0.0, 0.05], rim: opts.rim !== undefined ? opts.rim : 0.32, variation: [0.02, 1], side: opts.side || THREE.FrontSide, emissive: opts.emissive, emissiveIntensity: opts.ei }));
  return matCache.get(key);
}
// per-avatar material (for hurt flash) — cloned lazily
function capsule(r, len, seg = 10) { return new THREE.CapsuleGeometry(r, len, 4, seg); }
function mesh(geo, m, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.scale.set(sx, sy, sz);
  o.castShadow = true; o.receiveShadow = false;
  parent.add(o);
  return o;
}
function group(parent, x = 0, y = 0, z = 0, order = 'XYZ') {
  // joints are bones so the whole body can be one rigidly-skinned mesh
  const g = new THREE.Bone();
  g.position.set(x, y, z);
  g.rotation.order = order;
  parent.add(g);
  return g;
}
function lathe(points, seg = 14) { return new THREE.LatheGeometry(points.map((p) => new THREE.Vector2(p[0], p[1])), seg); }

// Sword model (blade along -y of its group, tilted forward by caller)
export function buildSword() {
  const g = new THREE.Group();
  const steel = toonMat({ color: 0xdfe8f0, rim: 0.8, rimColor: 0xcff4ff, band: [0.0, 0.05], variation: [0, 1] });
  const shape = new THREE.Shape();
  shape.moveTo(-0.028, 0); shape.lineTo(0.028, 0); shape.lineTo(0.03, 0.62); shape.lineTo(0, 0.72); shape.lineTo(-0.03, 0.62); shape.lineTo(-0.028, 0);
  const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
  blade.translate(0, 0, -0.006);
  const b = mesh(blade, steel, g, 0, 0.1, 0);
  b.name = 'blade';
  mesh(new THREE.BoxGeometry(0.2, 0.035, 0.05), mat(0xd9ad4f, { rim: 0.6 }), g, 0, 0.09, 0);
  mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.13, 8), mat(0x3a5f8f), g, 0, 0.01, 0);
  mesh(new THREE.SphereGeometry(0.032, 8, 6), mat(0xd9ad4f, { rim: 0.6 }), g, 0, -0.07, 0);
  // glowing rune gem on the guard
  mesh(new THREE.SphereGeometry(0.018, 8, 6), toonMat({ color: 0x7fe8d8, emissive: 0x7fe8d8, emissiveIntensity: 1.6 }), g, 0, 0.09, 0.028);
  g.userData.tipLocal = new THREE.Vector3(0, 0.8, 0);
  g.userData.baseLocal = new THREE.Vector3(0, 0.2, 0);
  return g;
}

const DEFAULT_SPEC = {
  skin: 0xf6d6bd, hair: 0x6b3f2a, hairStyle: 'hero', eyes: [60, 120, 150],
  top: 0x2e7fb8, trim: 0xe9cc7e, bottom: 0xe8dcc0, boots: 0x6b4630, belt: 0x5a3a28,
  skirt: 0.36, sleeves: 'short', scarf: null, scale: 1, headScale: 1, build: 1,
  outfit: 'tunic', hat: null, weapon: null, apron: null, bust: 0,
};

export class Avatar {
  constructor(spec = {}) {
    this.spec = Object.assign({}, DEFAULT_SPEC, spec);
    const s = this.spec;
    this.root = new THREE.Group();
    this.root.name = 'avatar';
    this.inner = group(this.root, 0, 0, 0);
    this.inner.scale.setScalar(s.scale);
    this.bodyPivot = group(this.inner, 0, 0.55, 0);
    this.j = {};
    this.meshes = [];
    this.pose = {};
    this.cur = {};
    this.time = Math.random() * 10;
    this.blinkT = 2 + Math.random() * 3;
    this.phase = 0;
    this.statue = !!s.statue;
    this._build();
    this._finalizeSkin();
    this.root.traverse((o) => { if (o.isMesh) this.meshes.push(o); });
    this.flashT = 0;
  }

  // body-part descriptor: colour + sidedness (merged into the skinned body later)
  _m(color, opts = {}) {
    return { color: this.statue ? (this.spec.stoneColor || 0xd8d2c4) : color, double: opts.side === THREE.DoubleSide };
  }

  // add a body part (descriptor) or a real mesh (Material) under a joint
  mesh(geo, m, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    if (m && m.isMaterial) return mesh(geo, m, parent, x, y, z, rx, ry, rz, sx, sy, sz);
    const o = new THREE.Object3D();
    o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.scale.set(sx, sy, sz);
    o.updateMatrix();
    (this.parts || (this.parts = [])).push({ geo, desc: m, parent, local: o.matrix.clone() });
    return o;
  }

  // bake all parts into (up to) two skinned meshes: front-sided and double-sided
  _finalizeSkin() {
    this.root.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const bones = [];
    this.root.traverse((o) => { if (o.isBone) bones.push(o); });
    const boneIndex = new Map(bones.map((b, i) => [b, i]));
    const buckets = { front: [], double: [] };
    const col = new THREE.Color();
    const nm = new THREE.Matrix3();
    for (const part of this.parts || []) {
      const M = new THREE.Matrix4().multiplyMatrices(rootInv, part.parent.matrixWorld).multiply(part.local);
      const g = part.geo;
      const pos = g.attributes.position;
      if (!g.attributes.normal) g.computeVertexNormals();
      const nor = g.attributes.normal;
      nm.getNormalMatrix(M);
      const n = pos.count;
      const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3);
      const SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
      col.set(part.desc.color);
      const bi = boneIndex.get(part.parent) || 0;
      const v = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(M); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
        v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z;
        C[i * 3] = col.r; C[i * 3 + 1] = col.g; C[i * 3 + 2] = col.b;
        SI[i * 4] = bi; SW[i * 4] = 1;
      }
      buckets[part.desc.double ? 'double' : 'front'].push({ P, N, C, SI, SW, n, I: g.index ? g.index.array : null });
    }
    this.mats = [];
    for (const key of ['front', 'double']) {
      const list = buckets[key];
      if (!list.length) continue;
      const total = list.reduce((a, b) => a + b.n, 0);
      const P = new Float32Array(total * 3), N = new Float32Array(total * 3), C = new Float32Array(total * 3);
      const SI = new Uint16Array(total * 4), SW = new Float32Array(total * 4);
      let o = 0;
      const I = [];
      for (const b of list) {
        P.set(b.P, o * 3); N.set(b.N, o * 3); C.set(b.C, o * 3); SI.set(b.SI, o * 4); SW.set(b.SW, o * 4);
        if (b.I) for (let k = 0; k < b.I.length; k++) I.push(b.I[k] + o);
        else for (let k = 0; k < b.n; k++) I.push(o + k);
        o += b.n;
      }
      const g = new THREE.BufferGeometry();
      g.setIndex(total > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      g.setAttribute('color', new THREE.BufferAttribute(C, 3));
      g.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
      const mat = this.statue
        ? toonMat({ vertexColors: true, rim: 0.2, band: [-0.05, 0.12], variation: [0.08, 3], moss: [0.5, 0.62, 0.36, 0.5], side: key === 'double' ? THREE.DoubleSide : THREE.FrontSide })
        : toonMat({ vertexColors: true, band: [0.0, 0.05], rim: 0.32, variation: [0.02, 1], side: key === 'double' ? THREE.DoubleSide : THREE.FrontSide });
      const sm = new THREE.SkinnedMesh(g, mat);
      sm.castShadow = true;
      sm.frustumCulled = false;
      this.root.add(sm);
      sm.bind(new THREE.Skeleton(bones));
      this.mats.push(mat);
    }
    this.parts = null;
  }

  _build() {
    const s = this.spec, j = this.j, m = (c, o) => this._m(c, o);
    const bld = s.build;
    j.hips = group(this.bodyPivot, 0, 0.93 - 0.55, 0);
    // pelvis
    this.mesh(new THREE.SphereGeometry(0.15, 12, 8), m(s.bottom), j.hips, 0, -0.02, 0, 0, 0, 0, 1.12 * bld, 0.8, 0.9 * bld);
    j.spine = group(j.hips, 0, 0.02, 0);
    // torso
    const torsoPts = [[0.0, -0.06], [0.13, -0.04], [0.14, 0.07], [0.16, 0.2], [0.175, 0.28], [0.14, 0.36], [0.06, 0.41], [0.0, 0.42]];
    this.mesh(lathe(torsoPts.map(([r, y]) => [r * bld, y]), 14), m(s.top), j.spine, 0, 0, 0, 0, 0, 0, 1, 1, 0.74);
    if (s.bust) this.mesh(new THREE.SphereGeometry(0.075, 10, 8), m(s.top), j.spine, 0, 0.24, 0.07, 0, 0, 0, 1.9, 0.9, 0.8);
    // belt
    this.mesh(new THREE.TorusGeometry(0.145 * bld, 0.028, 6, 16), m(s.belt), j.spine, 0, 0.02, 0, Math.PI / 2, 0, 0, 1, 0.74, 1);
    this.mesh(new THREE.BoxGeometry(0.07, 0.06, 0.03), mat(0xd9ad4f), j.spine, 0, 0.02, 0.11 * bld);
    j.chest = group(j.spine, 0, 0.26, 0);
    // collar trim
    this.mesh(new THREE.TorusGeometry(0.085, 0.022, 6, 14), m(s.trim), j.chest, 0, 0.12, 0, Math.PI / 2, 0, 0, 1, 0.8, 1);
    j.neck = group(j.chest, 0, 0.15, 0);
    this.mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.12, 10), m(s.skin), j.neck, 0, 0.03, 0);
    j.head = group(j.neck, 0, 0.08, 0);
    const hs = s.headScale;
    j.headMesh = this.mesh(new THREE.SphereGeometry(0.155, 20, 14), m(s.skin), j.head, 0, 0.14, 0.005, 0, 0, 0, 0.98 * hs, 1.02 * hs, 1.0 * hs);
    // chin / jaw softness
    this.mesh(new THREE.SphereGeometry(0.1, 12, 8), m(s.skin), j.head, 0, 0.07, 0.035, 0, 0, 0, 1.0 * hs, 0.9 * hs, 1.0 * hs);
    // face decal
    if (!this.statue) {
      this.faceTex = makeFaceTexture({ iris: s.eyes, brow: s.browColor || [70, 45, 35], lash: [36, 24, 22] });
      this.faceTex.repeat.set(1, 0.5);
      this.faceTex.offset.set(0, 0.5);
      const fmat = toonMat({ map: this.faceTex, alphaTest: 0.5, transparent: false, rim: 0, band: [-0.4, 0.2], outline: false });
      const fg = new THREE.SphereGeometry(0.1575, 20, 12, Math.PI / 2 - 0.72, 1.44, 1.05, 0.95);
      const f = this.mesh(fg, fmat, j.head, 0, 0.14, 0.005, 0, 0, 0, 0.98 * hs, 1.02 * hs, 1.0 * hs);
      f.castShadow = false;
    }
    this._hair();
    // ears
    for (const sx of [-1, 1]) this.mesh(new THREE.SphereGeometry(0.035, 8, 6), m(s.skin), j.head, sx * 0.148 * hs, 0.13, 0.0, 0, 0, 0, 0.6, 1, 0.8);

    // arms
    const armSide = (side) => {
      const sh = group(j.chest, side * 0.2 * bld, 0.1, 0, 'YXZ');
      this.mesh(new THREE.SphereGeometry(0.06, 10, 8), m(s.sleeves === 'none' ? s.skin : s.top), sh, 0, 0, 0);
      const upperCol = s.sleeves === 'long' || s.sleeves === 'wide' ? s.top : s.skin;
      this.mesh(capsule(0.048, 0.2), m(upperCol), sh, 0, -0.14, 0);
      if (s.sleeves === 'short') this.mesh(new THREE.CylinderGeometry(0.066, 0.075, 0.13, 10), m(s.top), sh, 0, -0.06, 0);
      if (s.sleeves === 'wide') {
        const sl = this.mesh(lathe([[0.05, 0.0], [0.08, -0.08], [0.13, -0.24], [0.15, -0.34], [0.0, -0.345]], 12), m(s.top, { side: THREE.DoubleSide }), sh, 0, -0.02, -0.02, 0, 0, 0, 1, 1, 0.85);
        sl.name = 'sleeve';
      }
      const el = group(sh, 0, -0.27, 0);
      const foreCol = s.sleeves === 'long' || s.sleeves === 'wide' ? s.top : s.skin;
      this.mesh(capsule(0.043, 0.18), m(foreCol), el, 0, -0.12, 0);
      if (s.bracer !== null && s.outfit === 'tunic') this.mesh(new THREE.CylinderGeometry(0.05, 0.047, 0.12, 10), m(s.bracer || s.boots), el, 0, -0.17, 0);
      const hand = group(el, 0, -0.25, 0);
      this.mesh(new THREE.SphereGeometry(0.052, 10, 8), m(s.glove || s.skin), hand, 0, -0.035, 0.005, 0, 0, 0, 0.85, 1.1, 0.75);
      return { sh, el, hand };
    };
    const L = armSide(1), R = armSide(-1);
    j.shL = L.sh; j.elL = L.el; j.handL = L.hand;
    j.shR = R.sh; j.elR = R.el; j.handR = R.hand;

    // legs
    const legSide = (side) => {
      const hip = group(j.hips, side * 0.088 * bld, -0.05, 0);
      this.mesh(capsule(0.07 * bld, 0.26), m(s.bottom), hip, 0, -0.2, 0);
      const knee = group(hip, 0, -0.41, 0);
      this.mesh(capsule(0.057, 0.28), m(s.boots), knee, 0, -0.19, 0);
      this.mesh(new THREE.CylinderGeometry(0.07, 0.066, 0.07, 10), m(s.boots), knee, 0, -0.02, 0);
      const foot = group(knee, 0, -0.4, 0);
      this.mesh(new THREE.SphereGeometry(0.065, 10, 8), m(s.boots), foot, 0, -0.025, 0.04, 0, 0, 0, 0.95, 0.75, 1.75);
      return { hip, knee, foot };
    };
    const LL = legSide(1), RL = legSide(-1);
    j.hipL = LL.hip; j.kneeL = LL.knee; j.footL = LL.foot;
    j.hipR = RL.hip; j.kneeR = RL.knee; j.footR = RL.foot;

    // outfit extras
    if (s.outfit === 'tunic' && s.skirt > 0) {
      j.skirt = group(j.hips, 0, 0.0, 0);
      this.mesh(lathe([[0.155 * bld, 0.04], [0.17 * bld, -0.05], [0.22 * bld, -s.skirt * 0.6], [0.25 * bld, -s.skirt], [0.0, -s.skirt - 0.001]].slice(0, 4), 16), m(s.top, { side: THREE.DoubleSide }), j.skirt, 0, 0, 0, 0, 0, 0, 1, 1, 0.8);
      this.mesh(new THREE.TorusGeometry(0.25 * bld, 0.014, 5, 20), m(s.trim), j.skirt, 0, -s.skirt + 0.01, 0, Math.PI / 2, 0, 0, 1, 0.8, 1);
    }
    if (s.outfit === 'hakama') {
      j.skirt = group(j.hips, 0, 0.0, 0);
      this.mesh(lathe([[0.16, 0.06], [0.19, -0.1], [0.27, -0.5], [0.33, -0.86], [0.335, -0.9]], 18), m(s.bottom, { side: THREE.DoubleSide }), j.skirt, 0, 0, 0, 0, 0, 0, 1, 1, 0.82);
      this.mesh(new THREE.BoxGeometry(0.2, 0.05, 0.02), m(s.belt), j.spine, 0, 0.0, 0.11);
    }
    if (s.outfit === 'robe') {
      j.skirt = group(j.hips, 0, 0.0, 0);
      this.mesh(lathe([[0.17 * bld, 0.06], [0.2 * bld, -0.12], [0.26 * bld, -0.55], [0.3 * bld, -0.85], [0.31 * bld, -0.88]], 16), m(s.top, { side: THREE.DoubleSide }), j.skirt, 0, 0, 0, 0, 0, 0, 1, 1, 0.85);
    }
    if (s.apron) {
      this.mesh(new THREE.BoxGeometry(0.26 * bld, 0.5, 0.02), m(s.apron), j.hips, 0, -0.14, 0.14 * bld, -0.08, 0, 0);
    }
    if (s.armor) {
      this.mesh(lathe([[0.0, 0.0], [0.17, 0.02], [0.19, 0.18], [0.185, 0.3], [0.13, 0.38], [0.0, 0.39]], 14), m(s.armor, { rim: 0.7 }), j.spine, 0, 0.0, 0, 0, 0, 0, 1.04 * bld, 1, 0.8);
      for (const sh of [j.shL, j.shR]) this.mesh(new THREE.SphereGeometry(0.085, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), m(s.armor, { rim: 0.7 }), sh, 0, 0.01, 0, 0, 0, 0, 1.1, 0.9, 1.1);
      this.mesh(new THREE.BoxGeometry(0.24, 0.42, 0.02), m(s.tabard || 0x2d5a8a), j.hips, 0, -0.12, 0.13, -0.05, 0, 0);
    }
    if (s.scarf) {
      this.mesh(new THREE.TorusGeometry(0.075, 0.035, 8, 16), m(s.scarf), j.neck, 0, 0.0, 0, Math.PI / 2, 0, 0, 1, 1, 0.9);
      this.scarf = new ScarfSim(s.scarf, s.scarf2 || s.trim);
    }
    if (s.sword) {
      this.sword = buildSword();
      this.sheathed = true;
      // scabbard centred on the back, tilted so the hilt sits over the right shoulder
      this.scabbard = group(j.chest, 0.0, 0.04, -0.165);
      this.scabbard.rotation.set(0.12, 0, 0.8);
      this.mesh(new THREE.BoxGeometry(0.075, 0.72, 0.035), mat(0x355a86), this.scabbard, 0, 0, 0);
      this.mesh(new THREE.BoxGeometry(0.088, 0.05, 0.045), mat(0xd9ad4f), this.scabbard, 0, 0.35, 0);
      this.mesh(new THREE.BoxGeometry(0.088, 0.05, 0.045), mat(0xd9ad4f), this.scabbard, 0, -0.35, 0);
      this.sheathSword();
      // strap
      this.mesh(new THREE.TorusGeometry(0.2, 0.012, 4, 20, Math.PI), mat(0x5a3a28), j.chest, 0, 0.03, 0, Math.PI / 2 + 0.2, 0.75, 0, 1, 1.2, 1);
    }
    if (s.spear) {
      const sp = group(j.handR, 0, -0.04, 0.02);
      sp.rotation.x = -Math.PI / 2 + 0.1;
      this.mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.2, 6), mat(0x6b4630), sp, 0, -0.3, 0, Math.PI / 2, 0, 0);
      this.mesh(new THREE.ConeGeometry(0.045, 0.3, 6), mat(0xdfe8f0, { rim: 0.8 }), sp, 0, -0.3, 1.2, Math.PI / 2, 0, 0);
      this.spear = sp;
    }
    if (s.staff) {
      const sp = group(j.handR, 0, -0.04, 0.02);
      this.mesh(new THREE.CylinderGeometry(0.02, 0.022, 1.5, 6), mat(0x7a5236), sp, 0, 0.35, 0);
      for (let i = 0; i < 5; i++) this.mesh(new THREE.SphereGeometry(0.035, 8, 6), mat(0xe9cc7e, { rim: 0.8 }), sp, Math.cos(i * 1.3) * 0.06, 1.05 + i * 0.03, Math.sin(i * 1.3) * 0.06);
      const rib = this.mesh(new THREE.BoxGeometry(0.03, 0.3, 0.005), mat(0xe8445a, { side: THREE.DoubleSide }), sp, 0.03, 0.9, 0);
      rib.rotation.z = 0.15;
      this.staff = sp;
    }
    if (s.hat === 'helmet') {
      this.mesh(new THREE.SphereGeometry(0.175, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m(s.armor || 0x9aa6b0, { rim: 0.7 }), j.head, 0, 0.16, 0, -0.1, 0, 0, 1, 1.05, 1.05);
      this.mesh(new THREE.BoxGeometry(0.03, 0.1, 0.3), m(0xc0392b), j.head, 0, 0.33, -0.02);
      this.mesh(new THREE.TorusGeometry(0.172, 0.018, 5, 20), m(s.armor || 0x9aa6b0, { rim: 0.7 }), j.head, 0, 0.16, 0, Math.PI / 2 + 0.1, 0, 0);
    }
    if (s.hat === 'scarf') {
      this.mesh(new THREE.SphereGeometry(0.172, 14, 8, 0, Math.PI * 2, 0, Math.PI / 1.9), m(s.hatColor || 0xc0503a), j.head, 0, 0.15, -0.01, -0.35, 0, 0, 1.02, 1.05, 1.08);
      this.mesh(new THREE.ConeGeometry(0.05, 0.15, 6), m(s.hatColor || 0xc0503a), j.head, 0, 0.1, -0.18, 2.4, 0, 0);
    }
    if (s.hat === 'straw') {
      this.mesh(new THREE.ConeGeometry(0.34, 0.16, 16), m(0xe0c070), j.head, 0, 0.36, 0, -0.05, 0, 0);
    }
  }

  _hair() {
    const s = this.spec, j = this.j, m = (c, o) => this._m(c, o);
    const hc = s.hair, hs = s.headScale;
    if (s.hairStyle === 'none') return;
    const H = group(j.head, 0, 0.14, 0.005);
    H.scale.setScalar(hs);
    this.hairGroup = H;
    const hm = m(hc, { rim: 0.45 });
    // cap tilted back so the forehead/eyes stay clear
    const capTheta = s.hairStyle === 'bald' ? 1.0 : 1.95;
    this.mesh(new THREE.SphereGeometry(0.17, 18, 12, 0, Math.PI * 2, 0, capTheta), hm, H, 0, 0.005, -0.012, -0.62, 0, 0, 1.02, 1.0, 1.05);
    const spike = (x, y, z, rx, rz, r = 0.06, h = 0.18, ry = 0) => this.mesh(new THREE.ConeGeometry(r, h, 6), hm, H, x, y, z, rx, ry, rz);
    if (s.hairStyle === 'hero' || s.hairStyle === 'short' || s.hairStyle === 'child') {
      // bangs
      for (let i = -2; i <= 2; i++) spike(i * 0.052, 0.07 - Math.abs(i) * 0.01, 0.138 - Math.abs(i) * 0.012, 2.65 - Math.abs(i) * 0.08, -i * 0.25, 0.048, 0.15);
      // top & back spikes
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.4;
        spike(Math.sin(a) * 0.12, 0.1, Math.cos(a) * 0.1 - 0.04, -0.9 + Math.cos(a) * 0.4, -Math.sin(a) * 0.9, 0.06, 0.17);
      }
      // side locks
      for (const sx of [-1, 1]) spike(sx * 0.14, -0.04, 0.06, 3.0, sx * -0.12, 0.04, 0.2);
      if (s.hairStyle === 'hero') {
        // short tail
        spike(0, -0.06, -0.17, -2.4, 0, 0.05, 0.22);
        this.mesh(new THREE.TorusGeometry(0.025, 0.012, 5, 10), m(0x7fe8d8), H, 0, -0.02, -0.165, 0.4, 0, 0);
      }
    } else if (s.hairStyle === 'long') {
      // hime cut: straight bangs + long back curtain
      for (let i = -3; i <= 3; i++) spike(i * 0.04, 0.06, 0.142 - Math.abs(i) * 0.008, 3.02, 0, 0.034, 0.12);
      for (const sx of [-1, 1]) this.mesh(new THREE.BoxGeometry(0.05, 0.36, 0.06), hm, H, sx * 0.145, -0.14, 0.055, 0, 0, sx * 0.05);
      const back = this.mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.62, 12, 1, false, Math.PI * 0.5, Math.PI), hm, H, 0, -0.25, -0.03, 0.05, 0, 0, 1, 1, 0.9);
      back.name = 'backhair';
      this.mesh(new THREE.BoxGeometry(0.12, 0.05, 0.03), m(0xffffff), H, 0, -0.1, -0.16, 0.2, 0, 0);
    } else if (s.hairStyle === 'bun') {
      for (let i = -2; i <= 2; i++) spike(i * 0.05, 0.07, 0.13 - Math.abs(i) * 0.01, 2.8, -i * 0.2, 0.045, 0.12);
      this.mesh(new THREE.SphereGeometry(0.075, 10, 8), hm, H, 0, 0.1, -0.13);
    } else if (s.hairStyle === 'elder') {
      this.mesh(new THREE.SphereGeometry(0.11, 10, 8), m(0xeeeeee), j.head, 0, 0.02, 0.1, 0, 0, 0, 1.1, 0.8, 0.7);
    }
  }

  sheathSword() {
    if (!this.sword) return;
    this.scabbard.add(this.sword);
    // blade down inside the scabbard, hilt poking out over the right shoulder
    this.sword.position.set(0, 0.47, 0.0);
    this.sword.rotation.set(0, 0, Math.PI);
    this.sheathed = true;
  }
  drawSword() {
    if (!this.sword) return;
    this.j.handR.add(this.sword);
    this.sword.position.set(0, -0.05, 0.02);
    // blade continues the forearm but angled forward (reads well in swings)
    this.sword.rotation.set(2.2, 0, 0);
    this.sheathed = false;
  }

  flash(t = 0.18) { this.flashT = t; }

  // ---------------------------------------------------------------------------
  // procedural animation. st = { mode, speed, sprint, vy, grounded, t, attack, castT, climbDX, climbDY, turn, talk }
  animate(dt, st) {
    this.time += dt;
    const P = this.pose;
    for (const k in P) P[k] = 0;
    const t = this.time;
    const mode = st.mode || 'idle';
    let rate = 14;

    const set = (k, v) => { P[k] = v; };
    // breathing / idle base
    const breath = Math.sin(t * 1.7);
    set('chestRX', breath * 0.02);
    set('shLRZ', 0.12); set('shRRZ', -0.12);
    set('elLRX', -0.18); set('elRRX', -0.18);

    if (mode === 'idle' || mode === 'talk' || mode === 'sit' || mode === 'guard' || mode === 'pray') {
      set('hipsRZ', Math.sin(t * 0.6) * 0.02);
      set('headRY', Math.sin(t * 0.37) * 0.15 + (st.lookYaw || 0));
      set('headRX', Math.sin(t * 0.23) * 0.05 + (st.lookPitch || 0));
      set('shLRX', Math.sin(t * 1.7) * 0.03); set('shRRX', -Math.sin(t * 1.7) * 0.03);
      if (mode === 'talk') {
        set('shRRX', -0.55 + Math.sin(t * 2.2) * 0.2); set('elRRX', -1.0 + Math.sin(t * 3.1) * 0.25); set('shRRY', 0.3);
        set('headRZ', Math.sin(t * 1.3) * 0.06);
      }
      if (mode === 'guard') { set('shRRX', -0.25); set('elRRX', -1.35); set('shRRY', -0.15); }
      if (mode === 'pray') { set('shLRX', -0.9); set('shRRX', -0.9); set('elLRX', -1.3); set('elRRX', -1.3); set('shLRY', -0.5); set('shRRY', 0.5); set('headRX', 0.25); }
      if (mode === 'sit') {
        set('bodyY', -0.42);
        set('hipLRX', -1.45); set('hipRRX', -1.45); set('kneeLRX', 1.5); set('kneeRRX', 1.5);
        set('spineRX', 0.12); set('shLRX', -0.4); set('shRRX', -0.4); set('elLRX', -0.7); set('elRRX', -0.7);
      }
      this.phase = 0;
    }

    if (mode === 'move') {
      const sp = st.speed || 0;
      const sprint = st.sprint ? 1 : 0;
      const stride = sp < 3 ? 1.3 : 1.95 + sprint * 0.5;
      this.phase += (sp / stride) * Math.PI * dt * 1.0;
      const p = this.phase;
      const run = clamp((sp - 1.5) / 4, 0, 1);
      const legA = lerp(0.45, 0.85, run) + sprint * 0.15;
      set('hipLRX', -Math.sin(p) * legA);
      set('hipRRX', Math.sin(p) * legA);
      set('kneeLRX', Math.max(0, Math.sin(p - 1.2)) * lerp(0.6, 1.5, run) + 0.12);
      set('kneeRRX', Math.max(0, Math.sin(p + Math.PI - 1.2)) * lerp(0.6, 1.5, run) + 0.12);
      set('footLRX', -Math.sin(p - 0.5) * 0.25);
      set('footRRX', Math.sin(p - 0.5) * 0.25);
      const armA = lerp(0.35, 0.8, run) + sprint * 0.2;
      set('shLRX', Math.sin(p) * armA); set('shRRX', -Math.sin(p) * armA);
      set('elLRX', -lerp(0.3, 1.3, run)); set('elRRX', -lerp(0.3, 1.3, run));
      set('shLRZ', 0.15); set('shRRZ', -0.15);
      set('hipsY', -Math.abs(Math.cos(p)) * 0.06 * run + 0.03 * run);
      set('spineRY', Math.sin(p) * 0.14);
      set('chestRY', -Math.sin(p) * 0.08);
      set('spineRX', 0.08 + run * 0.12 + sprint * 0.16);
      set('neckRX', -(0.05 + run * 0.1 + sprint * 0.12));
      set('hipsRZ', (st.turn || 0) * -0.25);
      set('spineRZ', (st.turn || 0) * -0.15);
      rate = 20;
    }

    if (mode === 'air') {
      const up = (st.vy || 0) > 0;
      set('hipLRX', up ? -1.0 : -0.5); set('kneeLRX', up ? 1.4 : 0.6);
      set('hipRRX', up ? 0.25 : 0.15); set('kneeRRX', up ? 0.6 : 0.35);
      set('shLRX', -0.5); set('shRRX', 0.2); set('shLRZ', 0.7); set('shRRZ', -0.7);
      set('elLRX', -0.5); set('elRRX', -0.5);
      set('spineRX', up ? 0.05 : -0.05);
      rate = 10;
    }

    if (mode === 'roll') {
      const k = clamp(st.t / (st.dur || 0.45), 0, 1);
      set('bodyRX', k * Math.PI * 2);
      set('bodyY', -Math.sin(k * Math.PI) * 0.3);
      set('hipLRX', -1.6); set('hipRRX', -1.4); set('kneeLRX', 2.0); set('kneeRRX', 2.1);
      set('spineRX', 0.7); set('neckRX', 0.4);
      set('shLRX', -1.0); set('shRRX', -1.0); set('elLRX', -1.6); set('elRRX', -1.6);
      rate = 40;
    }

    if (mode === 'attack') {
      const k = clamp(st.t / (st.dur || 0.34), 0, 1);
      const a = st.attack || 0;
      const e = k < 0.25 ? k / 0.25 : 1;          // windup ramp
      const hit = clamp((k - 0.2) / 0.3, 0, 1);    // strike
      const sm = hit * hit * (3 - 2 * hit);
      set('hipLRX', -0.4); set('hipRRX', 0.35); set('kneeLRX', 0.35); set('kneeRRX', 0.25);
      set('hipsY', -0.06);
      if (a === 0) {
        set('spineRY', lerp(-0.7 * e, 0.8, sm)); set('chestRY', lerp(-0.3 * e, 0.3, sm));
        set('shRRX', -1.2); set('shRRY', lerp(-1.2 * e, 1.1, sm)); set('shRRZ', -0.2);
        set('elRRX', lerp(-0.9, -0.15, sm));
        set('shLRX', -0.3); set('shLRZ', 0.5);
      } else if (a === 1) {
        set('spineRY', lerp(0.8 * e, -0.7, sm)); set('chestRY', lerp(0.3 * e, -0.3, sm));
        set('shRRX', -1.15); set('shRRY', lerp(1.2 * e, -1.1, sm)); set('shRRZ', -0.35);
        set('elRRX', lerp(-1.2, -0.1, sm));
        set('shLRX', 0.2); set('shLRZ', 0.6);
      } else {
        set('spineRX', lerp(-0.25 * e, 0.45, sm)); set('neckRX', lerp(0.1, -0.3, sm));
        set('shRRX', lerp(-2.9 * e, -0.55, sm)); set('shRRY', 0.1); set('shRRZ', -0.1);
        set('shLRX', lerp(-2.6 * e, -0.5, sm)); set('shLRY', -0.4); set('shLRZ', 0.2);
        set('elRRX', lerp(-0.6, -0.1, sm)); set('elLRX', lerp(-0.9, -0.3, sm));
        set('hipsY', lerp(0.02, -0.14, sm));
        set('hipLRX', -0.7); set('kneeLRX', 0.7);
      }
      rate = 32;
    }

    if (mode === 'cast') {
      const k = clamp(st.t / (st.dur || 0.5), 0, 1);
      const push = k < 0.25 ? k / 0.25 : 1 - clamp((k - 0.6) / 0.4, 0, 1) * 0.5;
      set('shLRX', lerp(-0.8, -1.55, push)); set('shLRY', 0.1); set('shLRZ', 0.05);
      set('elLRX', lerp(-1.3, -0.05, push));
      set('shRRX', 0.5); set('shRRZ', -0.4); set('elRRX', -0.6);
      set('spineRY', lerp(-0.4, 0.35, push)); set('spineRX', 0.12);
      set('hipLRX', -0.45); set('hipRRX', 0.4); set('kneeLRX', 0.3); set('kneeRRX', 0.2);
      set('hipsY', -0.05);
      rate = 26;
    }

    if (mode === 'climb') {
      this.phase += (Math.abs(st.climbDY || 0) + Math.abs(st.climbDX || 0)) * dt * 4.5;
      const p = this.phase;
      set('shLRX', -2.5 + Math.sin(p) * 0.45); set('shRRX', -2.5 - Math.sin(p) * 0.45);
      set('shLRZ', 0.35); set('shRRZ', -0.35);
      set('elLRX', -0.9 - Math.max(0, -Math.sin(p)) * 0.6); set('elRRX', -0.9 - Math.max(0, Math.sin(p)) * 0.6);
      set('hipLRX', -0.7 - Math.sin(p) * 0.45); set('hipRRX', -0.7 + Math.sin(p) * 0.45);
      set('kneeLRX', 1.2 + Math.sin(p) * 0.3); set('kneeRRX', 1.2 - Math.sin(p) * 0.3);
      set('hipLRZ', 0.2); set('hipRRZ', -0.2);
      set('spineRX', -0.05); set('headRX', -0.35);
      rate = 16;
    }

    if (mode === 'mantle') {
      const k = clamp(st.t / (st.dur || 0.4), 0, 1);
      set('shLRX', lerp(-2.6, -0.4, k)); set('shRRX', lerp(-2.6, -0.4, k));
      set('elLRX', lerp(-0.6, -0.2, k)); set('elRRX', lerp(-0.6, -0.2, k));
      set('hipLRX', lerp(-1.4, -0.2, k)); set('kneeLRX', lerp(1.8, 0.2, k));
      set('hipRRX', lerp(-0.3, 0, k)); set('kneeRRX', lerp(0.9, 0.1, k));
      set('spineRX', 0.5 * (1 - k));
      rate = 24;
    }

    if (mode === 'swim') {
      this.phase += dt * (2.2 + (st.speed || 0) * 0.6);
      const p = this.phase;
      set('bodyRX', 1.05);
      set('bodyY', -0.1);
      set('shLRX', -2.2 + Math.cos(p) * 0.7); set('shRRX', -2.2 + Math.cos(p) * 0.7);
      set('shLRZ', 0.3 + Math.max(0, Math.sin(p)) * 1.0); set('shRRZ', -0.3 - Math.max(0, Math.sin(p)) * 1.0);
      set('elLRX', -0.3); set('elRRX', -0.3);
      set('hipLRX', 0.2 + Math.sin(p * 2) * 0.3); set('hipRRX', 0.2 - Math.sin(p * 2) * 0.3);
      set('kneeLRX', 0.3); set('kneeRRX', 0.3);
      set('neckRX', -0.8); set('headRX', -0.3);
      rate = 10;
    }

    if (mode === 'hurt') {
      set('spineRX', -0.35); set('neckRX', -0.2);
      set('shLRX', -0.4); set('shRRX', -0.4); set('shLRZ', 0.8); set('shRRZ', -0.8);
      set('hipLRX', -0.3); set('kneeLRX', 0.5);
      rate = 30;
    }

    if (mode === 'wave') {
      set('shRRX', -2.6); set('shRRZ', -0.4 + Math.sin(t * 9) * 0.25); set('elRRX', -0.4);
      set('headRZ', 0.1);
    }

    if (mode === 'dance') {
      const p = t * 5;
      set('hipsY', -Math.abs(Math.sin(p)) * 0.07);
      set('shLRZ', 1.2 + Math.sin(p) * 0.4); set('shRRZ', -1.2 + Math.sin(p) * 0.4);
      set('elLRX', -1.0); set('elRRX', -1.0);
      set('spineRY', Math.sin(p * 0.5) * 0.3);
      set('hipLRX', -Math.max(0, Math.sin(p)) * 0.6); set('kneeLRX', Math.max(0, Math.sin(p)) * 0.9);
      set('hipRRX', -Math.max(0, -Math.sin(p)) * 0.6); set('kneeRRX', Math.max(0, -Math.sin(p)) * 0.9);
    }

    if (st.hunch) { P.spineRX = (P.spineRX || 0) + 0.35; P.neckRX = (P.neckRX || 0) - 0.25; }
    if (this.statue) {
      for (const k in P) P[k] = 0;
      P.shLRX = -2.6; P.shLRZ = 0.3; P.elLRX = -0.2; P.shRRX = -0.3; P.shRRZ = -0.25; P.headRX = -0.25; P.spineRX = -0.05;
    }

    // smooth toward targets
    const C = this.cur;
    const kk = 1 - Math.exp(-rate * dt);
    for (const k of ALL_KEYS) {
      const target = P[k] || 0;
      const c = C[k] || 0;
      if (k === 'bodyRX') C[k] = mode === 'roll' ? target : (Math.abs(c) > 3 ? 0 : c + (target - c) * kk);
      else C[k] = c + (target - c) * kk;
    }
    this._apply();

    // blink
    if (this.faceTex) {
      this.blinkT -= dt;
      const closed = this.blinkT < 0.12 || st.eyesClosed;
      this.faceTex.offset.y = closed ? 0 : 0.5;
      if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 3.5;
    }
    // hurt flash via emissive on this avatar's own materials
    if (this.flashT > 0 || this._flashing) {
      this.flashT -= dt;
      const k = Math.max(0, this.flashT) * 5;
      this._flashing = this.flashT > 0;
      if (this.mats) for (const m of this.mats) { m.emissive.setRGB(1, 0.35, 0.3); m.emissiveIntensity = k; }
    }
  }

  _apply() {
    const C = this.cur, j = this.j;
    this.bodyPivot.rotation.x = C.bodyRX || 0;
    this.bodyPivot.position.y = 0.55 + (C.bodyY || 0);
    j.hips.position.y = 0.93 - 0.55 + (C.hipsY || 0);
    j.hips.rotation.set(C.hipsRX || 0, C.hipsRY || 0, C.hipsRZ || 0);
    j.spine.rotation.set(C.spineRX || 0, C.spineRY || 0, C.spineRZ || 0);
    j.chest.rotation.set(C.chestRX || 0, C.chestRY || 0, 0);
    j.neck.rotation.set(C.neckRX || 0, C.neckRY || 0, 0);
    j.head.rotation.set(C.headRX || 0, C.headRY || 0, C.headRZ || 0);
    j.shL.rotation.set(C.shLRX || 0, C.shLRY || 0, C.shLRZ || 0);
    j.shR.rotation.set(C.shRRX || 0, C.shRRY || 0, C.shRRZ || 0);
    j.elL.rotation.x = C.elLRX || 0;
    j.elR.rotation.x = C.elRRX || 0;
    j.hipL.rotation.set(C.hipLRX || 0, 0, C.hipLRZ || 0);
    j.hipR.rotation.set(C.hipRRX || 0, 0, C.hipRRZ || 0);
    j.kneeL.rotation.x = C.kneeLRX || 0;
    j.kneeR.rotation.x = C.kneeRRX || 0;
    j.footL.rotation.x = C.footLRX || 0;
    j.footR.rotation.x = C.footRRX || 0;
    if (j.skirt) {
      const avg = ((C.hipLRX || 0) + (C.hipRRX || 0)) * 0.5;
      j.skirt.rotation.x = Math.max(-0.5, Math.min(0.5, avg * 0.6));
      j.skirt.scale.x = 1 + Math.min(0.3, Math.abs((C.hipLRX || 0) - (C.hipRRX || 0)) * 0.12);
    }
  }

  // secondary motion that needs world transforms (scarf)
  updateSecondary(dt, scene, vel) {
    if (!this.scarf) return;
    this.root.updateMatrixWorld(true);
    this.j.neck.localToWorld(_anchor.set(0, 0.02, -0.08));
    this.j.chest.localToWorld(_side.set(1, 0.15, 0)).sub(this.j.chest.localToWorld(_tmp.set(-1, 0.15, 0))).normalize();
    this.scarf.update(dt, _anchor, _side, vel, scene);
  }

  setVisible(v) { this.root.visible = v; if (this.scarf) this.scarf.mesh.visible = v; }
  resetSecondary() { if (this.scarf) this.scarf.inited = false; }
  dispose() { if (this.scarf && this.scarf.mesh.parent) this.scarf.mesh.parent.remove(this.scarf.mesh); }
}

const ALL_KEYS = ['bodyRX', 'bodyY', 'hipsY', 'hipsRX', 'hipsRY', 'hipsRZ', 'spineRX', 'spineRY', 'spineRZ', 'chestRX', 'chestRY', 'neckRX', 'neckRY', 'headRX', 'headRY', 'headRZ',
  'shLRX', 'shLRY', 'shLRZ', 'elLRX', 'shRRX', 'shRRY', 'shRRZ', 'elRRX', 'hipLRX', 'hipLRZ', 'kneeLRX', 'footLRX', 'hipRRX', 'hipRRZ', 'kneeRRX', 'footRRX'];

const _anchor = new THREE.Vector3(), _side = new THREE.Vector3(), _tmp = new THREE.Vector3();

// Verlet ribbon for the flowing scarf
class ScarfSim {
  constructor(color, color2) {
    this.n = 11;
    this.seg = 0.085;
    this.p = []; this.o = [];
    for (let i = 0; i < this.n; i++) { this.p.push(new THREE.Vector3(0, 1.5 - i * this.seg, 0)); this.o.push(new THREE.Vector3(0, 1.5 - i * this.seg, 0)); }
    const verts = new Float32Array(this.n * 2 * 3);
    const cols = new Float32Array(this.n * 2 * 3);
    const c1 = new THREE.Color(color), c2 = new THREE.Color(color2);
    const idx = [];
    for (let i = 0; i < this.n; i++) {
      const c = i % 4 === 3 ? c2 : c1;
      for (let k = 0; k < 2; k++) { cols[(i * 2 + k) * 3] = c.r; cols[(i * 2 + k) * 3 + 1] = c.g; cols[(i * 2 + k) * 3 + 2] = c.b; }
      if (i < this.n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.setIndex(idx);
    const m = toonMat({ vertexColors: true, side: THREE.DoubleSide, rim: 0.3, band: [-0.3, 0.3], variation: [0, 1] });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.inited = false;
    this.wind = new THREE.Vector3();
  }
  update(dt, anchor, side, vel, scene) {
    if (scene && this.mesh.parent !== scene) { scene.add(this.mesh); this.inited = false; }
    if (!this.inited) {
      for (let i = 0; i < this.n; i++) { this.p[i].copy(anchor).y -= i * this.seg; this.o[i].copy(this.p[i]); }
      this.inited = true;
    }
    dt = Math.min(dt, 1 / 30);
    const t = U.uTime.value;
    const w = U.uWind.value;
    this.wind.set(w.x * 0.9 + Math.sin(t * 3.1) * 0.5, Math.sin(t * 2.3) * 0.3, w.y * 0.9 + Math.cos(t * 2.7) * 0.5);
    if (vel) this.wind.addScaledVector(vel, -0.55);
    this.p[0].copy(anchor);
    for (let i = 1; i < this.n; i++) {
      const p = this.p[i], o = this.o[i];
      const vx = (p.x - o.x) * 0.9, vy = (p.y - o.y) * 0.9, vz = (p.z - o.z) * 0.9;
      o.copy(p);
      const flutter = Math.sin(t * 9 + i * 0.9) * 0.6 * (i / this.n);
      p.x += vx + (this.wind.x + side.x * flutter) * dt * dt * 6;
      p.y += vy + (-9.8 * 0.9 + this.wind.y) * dt * dt;
      p.z += vz + (this.wind.z + side.z * flutter) * dt * dt * 6;
    }
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < this.n; i++) {
        const a = this.p[i - 1], b = this.p[i];
        _tmp.subVectors(b, a);
        const d = _tmp.length() || 1e-5;
        const diff = (d - this.seg) / d;
        if (i === 1) b.addScaledVector(_tmp, -diff);
        else { a.addScaledVector(_tmp, diff * 0.5); b.addScaledVector(_tmp, -diff * 0.5); }
      }
      this.p[0].copy(anchor);
    }
    const pos = this.mesh.geometry.attributes.position;
    for (let i = 0; i < this.n; i++) {
      const wdt = 0.085 * (1 - (i / this.n) * 0.3);
      const p = this.p[i];
      pos.setXYZ(i * 2, p.x + side.x * wdt, p.y + side.y * wdt, p.z + side.z * wdt);
      pos.setXYZ(i * 2 + 1, p.x - side.x * wdt, p.y - side.y * wdt, p.z - side.z * wdt);
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingSphere();
  }
}

// Presets --------------------------------------------------------------------
export const PRESETS = {
  hero: { skin: 0xf7d9c0, hair: 0x7a4a2e, hairStyle: 'hero', eyes: [40, 130, 150], top: 0x2f86b8, trim: 0xe9cc7e, bottom: 0xefe4cc, boots: 0x6b4630, belt: 0x5a3a28, skirt: 0.34, sleeves: 'short', scarf: 0xf4f1e8, scarf2: 0x3fb0a8, sword: true, glove: 0x6b4630 },
  miko: { skin: 0xf9ddc6, hair: 0x221a22, hairStyle: 'long', eyes: [150, 60, 70], top: 0xfaf7f0, trim: 0xd83a3a, bottom: 0xc8323a, boots: 0xfaf7f0, belt: 0xc8323a, outfit: 'hakama', sleeves: 'wide', skirt: 0, staff: true, bracer: null, bust: 0.5, build: 0.92 },
  guard: { skin: 0xecc8a8, hair: 0x3a2a20, hairStyle: 'short', eyes: [80, 90, 70], top: 0x2d5a8a, trim: 0xd9ad4f, bottom: 0x3b3f48, boots: 0x3a2a20, belt: 0x3a2a20, armor: 0xaab4be, tabard: 0x2d5a8a, hat: 'helmet', skirt: 0.28, spear: true, build: 1.1 },
  merchant: { skin: 0xf0cfb2, hair: 0x5a3a2a, hairStyle: 'short', eyes: [90, 70, 50], top: 0x8a5a3a, trim: 0xe9cc7e, bottom: 0x5a4a3a, boots: 0x3a2a20, belt: 0x3a2a20, apron: 0xf2ead6, skirt: 0.2, sleeves: 'long', build: 1.25, hat: 'scarf', hatColor: 0x3f7f5f },
  merchant2: { skin: 0xf6d8c2, hair: 0xc9763a, hairStyle: 'bun', eyes: [60, 110, 70], top: 0xb8483c, trim: 0xf2e6c8, bottom: 0x4a5a7a, boots: 0x3a2a20, belt: 0x3a2a20, apron: 0xf2ead6, outfit: 'robe', sleeves: 'long', build: 1.0, bust: 0.4 },
  child: { skin: 0xf9dcc4, hair: 0x3a2618, hairStyle: 'child', eyes: [70, 100, 160], top: 0xe8a33c, trim: 0xffffff, bottom: 0x4a6a9a, boots: 0x6b4630, belt: 0x6b4630, skirt: 0.2, scale: 0.66, headScale: 1.18 },
  elder: { skin: 0xe8c4a4, hair: 0xdedede, hairStyle: 'elder', eyes: [90, 90, 90], top: 0x6a5a8a, trim: 0xd9ad4f, bottom: 0x6a5a8a, boots: 0x3a2a20, belt: 0x3a2a20, outfit: 'robe', sleeves: 'long', build: 1.05, hat: 'straw' },
  woman: { skin: 0xf8dac4, hair: 0x8a4a2a, hairStyle: 'bun', eyes: [70, 120, 90], top: 0x5a8ab0, trim: 0xf2e6c8, bottom: 0x5a8ab0, boots: 0x3a2a20, belt: 0xf2e6c8, outfit: 'robe', sleeves: 'long', bust: 0.5, build: 0.95 },
  farmer: { skin: 0xe6bf9c, hair: 0x4a3a2a, hairStyle: 'short', eyes: [80, 70, 50], top: 0x7a9a5a, trim: 0xd9c08a, bottom: 0x6a5a4a, boots: 0x4a3a2a, belt: 0x4a3a2a, skirt: 0.25, hat: 'straw', build: 1.1 },
};
