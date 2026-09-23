// Geometry helpers + batcher that merges modular pieces into few draw calls.
import * as THREE from 'three';
import { M } from '../gfx/materials.js';

// metres -> texture units per material (texture world size)
export const TEX_SCALE = {
  ground: 1 / 2.4, flag: 1 / 3.2, plaster: 1 / 2, wood: 1 / 1.2, stone: 1 / 3.2, mossStone: 1 / 3.2, roof: 1 / 2,
  marble: 1 / 4, ruin: 1 / 3.5, bark: 1 / 1.5, cloth: 1, plain: 1, plainDouble: 1, rock: 1, metal: 1, leaves: 1,
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
export function mat4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// ---------------------------------------------------------------------------
// primitive generators (all UVs in metres)
export function boxGeo(w, h, d, { uvOff = [0, 0] } = {}) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const P = [], N = [], UV = [], I = [];
  const face = (ax, ay, az, ux, uy, uz, vx, vy, vz, su, sv) => {
    // centre at a*, u & v half-vectors
    const base = P.length / 3;
    const nx = ax, ny = ay, nz = az;
    const nl = Math.hypot(nx, ny, nz);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      P.push(ax + ux * a + vx * b, ay + uy * a + vy * b, az + uz * a + vz * b);
      N.push(nx / nl, ny / nl, nz / nl);
      UV.push(a * su + uvOff[0], b * sv + uvOff[1]);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  face(hx, 0, 0, 0, 0, -hz, 0, hy, 0, hz, hy);   // +x
  face(-hx, 0, 0, 0, 0, hz, 0, hy, 0, hz, hy);   // -x
  face(0, hy, 0, hx, 0, 0, 0, 0, -hz, hx, hz);   // +y
  face(0, -hy, 0, hx, 0, 0, 0, 0, hz, hx, hz);   // -y
  face(0, 0, hz, hx, 0, 0, 0, hy, 0, hx, hy);    // +z
  face(0, 0, -hz, -hx, 0, 0, 0, hy, 0, hx, hy);  // -z
  return makeGeo(P, N, UV, I);
}

// triangular prism: base w (x) × d (z), apex height h, ridge along z
export function prismGeo(w, h, d) {
  const hx = w / 2, hz = d / 2;
  const P = [], N = [], UV = [], I = [];
  const tri = (a, b, c, n, uvs) => {
    const base = P.length / 3;
    P.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) N.push(...n);
    UV.push(...uvs);
    I.push(base, base + 1, base + 2);
  };
  const quad = (a, b, c, d2, n, uvs) => {
    const base = P.length / 3;
    P.push(...a, ...b, ...c, ...d2);
    for (let i = 0; i < 4; i++) N.push(...n);
    UV.push(...uvs);
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // gable ends
  tri([-hx, 0, hz], [hx, 0, hz], [0, h, hz], [0, 0, 1], [-hx, 0, hx, 0, 0, h]);
  tri([hx, 0, -hz], [-hx, 0, -hz], [0, h, -hz], [0, 0, -1], [-hx, 0, hx, 0, 0, h]);
  const sl = Math.hypot(hx, h);
  const nL = [-h / sl, hx / sl, 0], nR = [h / sl, hx / sl, 0];
  quad([-hx, 0, -hz], [-hx, 0, hz], [0, h, hz], [0, h, -hz], nL, [-hz, 0, hz, 0, hz, sl, -hz, sl]);
  quad([hx, 0, hz], [hx, 0, -hz], [0, h, -hz], [0, h, hz], nR, [-hz, 0, hz, 0, hz, sl, -hz, sl]);
  quad([-hx, 0, hz], [-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [0, -1, 0], [-hx, hz, -hx, -hz, hx, -hz, hx, hz]);
  return makeGeo(P, N, UV, I);
}

export function cylGeo(rt, rb, h, segs = 12, { caps = true, open = false, flat = false } = {}) {
  const g = new THREE.CylinderGeometry(rt, rb, h, segs, 1, open);
  if (!caps) { /* keep caps anyway; cheap */ }
  // remap uv to metres: u around circumference, v along height
  const uv = g.attributes.uv, pos = g.attributes.position;
  const circ = Math.PI * 2 * Math.max(rt, rb);
  for (let i = 0; i < uv.count; i++) {
    const y = pos.getY(i);
    const isCap = Math.abs(g.attributes.normal.getY(i)) > 0.999;
    if (isCap) uv.setXY(i, pos.getX(i), pos.getZ(i));
    else uv.setXY(i, uv.getX(i) * circ, y + h / 2);
  }
  if (flat) return g.toNonIndexed();
  return g;
}

export function latheGeo(points, segs = 16, uScale = 1) {
  const pts = points.map((p) => new THREE.Vector2(p[0], p[1]));
  const g = new THREE.LatheGeometry(pts, segs);
  const uv = g.attributes.uv, pos = g.attributes.position;
  let maxR = 0;
  for (const p of points) maxR = Math.max(maxR, p[0]);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * maxR * uScale, pos.getY(i));
  return g;
}

// wall with an arched opening, centred at origin, thickness along z
export function archWallGeo(w, h, d, aw, ah, { segs = 12 } = {}) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.lineTo(-w / 2, 0);
  const hole = new THREE.Path();
  const r = aw / 2, spring = ah - r;
  hole.moveTo(-r, 0);
  hole.lineTo(-r, spring);
  hole.absarc(0, spring, r, Math.PI, 0, true);
  hole.lineTo(r, 0);
  hole.lineTo(-r, 0);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: segs });
  g.translate(0, 0, -d / 2);
  fixExtrudeUV(g);
  return g;
}

// arch ring only (voussoirs) for bridges / gates
export function archRingGeo(r0, r1, d, segs = 14, from = 0, to = Math.PI) {
  const s = new THREE.Shape();
  for (let i = 0; i <= segs; i++) { const a = from + (to - from) * i / segs; const x = Math.cos(a) * r1, y = Math.sin(a) * r1; if (i === 0) s.moveTo(x, y); else s.lineTo(x, y); }
  for (let i = segs; i >= 0; i--) { const a = from + (to - from) * i / segs; s.lineTo(Math.cos(a) * r0, Math.sin(a) * r0); }
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  fixExtrudeUV(g);
  return g;
}

// generic extrude of a 2D polygon (xy) with depth along z
export function extrudeGeo(points, d, holes = []) {
  const s = new THREE.Shape(points.map((p) => new THREE.Vector2(p[0], p[1])));
  for (const h of holes) s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))));
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  fixExtrudeUV(g);
  return g;
}

// planar-projected uvs (by dominant normal axis) in metres
export function fixExtrudeUV(g) {
  const pos = g.attributes.position;
  g.computeVertexNormals();
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (nz >= nx && nz >= ny) uv.setXY(i, x, y);
    else if (nx >= ny) uv.setXY(i, z, y);
    else uv.setXY(i, x, z);
  }
  return g;
}

// world-planar (XZ) uvs in metres for flat horizontal geometry (discs, rings)
export function planarUV(g) {
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
  return g;
}

export function planeGeo(w, h) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  return g;
}

export function makeGeo(P, N, UV, I) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  if (I) g.setIndex(I);
  return g;
}

// set a uniform vertex colour on a geometry (linear colour)
export function paint(g, color) {
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// ---------------------------------------------------------------------------
// Merge static meshes under `root` into one mesh per material (draw-call reduction).
// recursive=false only merges direct leaf children (sub-groups keep animating).
export function mergeGroup(root, recursive = true) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  const victims = [];
  const visit = (o) => {
    if (o !== root && o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && !o.userData.keep && o.children.length === 0 && o.visible) {
      const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push({ geo: o.geometry, M, cast: o.castShadow, recv: o.receiveShadow, order: o.renderOrder });
      victims.push(o);
    }
    if (o === root || recursive) for (const c of o.children) visit(c);
  };
  visit(root);
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const hasUV = list.every((e) => e.geo.attributes.uv);
    const hasCol = list.every((e) => e.geo.attributes.color);
    let n = 0;
    for (const e of list) n += e.geo.attributes.position.count;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
    const UV = hasUV ? new Float32Array(n * 2) : null, C = hasCol ? new Float32Array(n * 3) : null;
    const I = [];
    let o = 0;
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    let cast = false, recv = false, order = 0;
    for (const e of list) {
      const g = e.geo, pos = g.attributes.position;
      if (!g.attributes.normal) g.computeVertexNormals();
      const nor = g.attributes.normal;
      nm.getNormalMatrix(e.M);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(e.M); P[(o + i) * 3] = v.x; P[(o + i) * 3 + 1] = v.y; P[(o + i) * 3 + 2] = v.z;
        v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); N[(o + i) * 3] = v.x; N[(o + i) * 3 + 1] = v.y; N[(o + i) * 3 + 2] = v.z;
        if (UV) { UV[(o + i) * 2] = g.attributes.uv.getX(i); UV[(o + i) * 2 + 1] = g.attributes.uv.getY(i); }
        if (C) { C[(o + i) * 3] = g.attributes.color.getX(i); C[(o + i) * 3 + 1] = g.attributes.color.getY(i); C[(o + i) * 3 + 2] = g.attributes.color.getZ(i); }
      }
      if (g.index) { const a = g.index.array; for (let k = 0; k < a.length; k++) I.push(a[k] + o); }
      else for (let k = 0; k < pos.count; k++) I.push(o + k);
      o += pos.count;
      cast = cast || e.cast; recv = recv || e.recv; order = Math.max(order, e.order);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    if (UV) g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
    if (C) g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = cast; m.receiveShadow = recv; m.renderOrder = order;
    root.add(m);
    for (const e of victims) if (e.material === mat && e.parent) e.parent.remove(e);
  }
  return root;
}

// ---------------------------------------------------------------------------
class Bucket {
  constructor() { this.P = []; this.N = []; this.UV = []; this.C = []; this.I = []; this.n = 0; }
}

const _v = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _col = new THREE.Color();

export class Batcher {
  constructor(physics = null, { cell = 64, shadows = true } = {}) {
    this.physics = physics;
    this.cell = cell;
    this.shadows = shadows;
    this.buckets = new Map();
    this.meshes = [];
  }

  /**
   * add geometry with transform + tint.
   * opts: ao (darken low vertices, in local y from bottom), uv (extra uv scale), cell override key
   */
  add(matName, geo, matrix, color = 0xffffff, opts = {}) {
    const tx = matrix.elements[12], tz = matrix.elements[14];
    const cx = opts.noCell ? 0 : Math.floor(tx / this.cell), cz = opts.noCell ? 0 : Math.floor(tz / this.cell);
    const key = matName + '|' + cx + '|' + cz + (opts.noShadow ? '|ns' : '');
    let b = this.buckets.get(key);
    if (!b) { b = new Bucket(); b.mat = matName; b.noShadow = !!opts.noShadow; this.buckets.set(key, b); }
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv, gcol = geo.attributes.color;
    const base = b.n;
    _nm.getNormalMatrix(matrix);
    const c = color instanceof THREE.Color ? color : _col.set(color);
    const cr = c.r, cg = c.g, cb = c.b;
    const ts = (TEX_SCALE[matName] || 1) * (opts.uv || 1);
    const ao = opts.ao;
    let minY = 0, hY = 1;
    if (ao) {
      minY = Infinity; let maxY = -Infinity;
      for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < minY) minY = y; if (y > maxY) maxY = y; }
      hY = Math.max(0.001, maxY - minY);
    }
    for (let i = 0; i < pos.count; i++) {
      _v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      let k = 1;
      if (ao) { const t = Math.min(1, (_v.y - minY) / Math.min(hY, ao)); k = 0.62 + 0.38 * t; }
      _v.applyMatrix4(matrix);
      b.P.push(_v.x, _v.y, _v.z);
      _v.set(nor.getX(i), nor.getY(i), nor.getZ(i)).applyMatrix3(_nm).normalize();
      b.N.push(_v.x, _v.y, _v.z);
      if (uv) b.UV.push(uv.getX(i) * ts, uv.getY(i) * ts); else b.UV.push(0, 0);
      if (gcol) b.C.push(gcol.getX(i) * cr * k, gcol.getY(i) * cg * k, gcol.getZ(i) * cb * k);
      else b.C.push(cr * k, cg * k, cb * k);
    }
    if (geo.index) {
      const idx = geo.index.array;
      for (let i = 0; i < idx.length; i++) b.I.push(base + idx[i]);
    } else {
      for (let i = 0; i < pos.count; i++) b.I.push(base + i);
    }
    b.n += pos.count;
    return this;
  }

  // convenience: axis box (rotated around Y) with optional collider
  box(mat, x, y, z, w, h, d, ry = 0, color = 0xffffff, opts = {}) {
    const g = boxGeo(w, h, d, { uvOff: opts.uvOff || [x * 0.37 + z * 0.11, y * 0.13] });
    this.add(mat, g, mat4(x, y, z, opts.rx || 0, ry, opts.rz || 0), color, opts);
    if (opts.collide && this.physics) this.physics.addBox(x, y, z, w / 2, h / 2, d / 2, ry, opts.colOpts || {});
    return this;
  }

  cyl(mat, x, y, z, rt, rb, h, segs = 12, color = 0xffffff, opts = {}) {
    const g = cylGeo(rt, rb, h, segs);
    this.add(mat, g, mat4(x, y, z, opts.rx || 0, opts.ry || 0, opts.rz || 0), color, opts);
    if (opts.collide && this.physics) this.physics.addCyl(x, z, Math.max(rt, rb), y - h / 2, y + h / 2, opts.colOpts || {});
    return this;
  }

  build(parent) {
    for (const b of this.buckets.values()) {
      if (b.n === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.N, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.UV, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.C, 3));
      g.setIndex(b.n > 65535 ? new THREE.Uint32BufferAttribute(b.I, 1) : new THREE.Uint16BufferAttribute(b.I, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, M(b.mat));
      mesh.castShadow = this.shadows && !b.noShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      this.meshes.push(mesh);
    }
    this.buckets.clear();
    return this.meshes;
  }
}
