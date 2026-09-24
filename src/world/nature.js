// Terrain, streamed grass, instanced trees / rocks / bushes / flowers.
import * as THREE from 'three';
import { toonMat, U, M } from '../gfx/materials.js';
import { getTex } from '../gfx/textures.js';
import { RNG, hash2, makeNoise2D, fbm } from '../core/util.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Heightfield terrain with exact (mesh-matching) queries
export class Terrain {
  constructor({ minX, maxX, minZ, maxZ, step = 1.6, height, color }) {
    this.minX = minX; this.minZ = minZ; this.step = step;
    this.nx = Math.round((maxX - minX) / step) + 1;
    this.nz = Math.round((maxZ - minZ) / step) + 1;
    this.maxX = minX + (this.nx - 1) * step;
    this.maxZ = minZ + (this.nz - 1) * step;
    this.h = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) this.h[j * this.nx + i] = height(minX + i * step, minZ + j * step);
    this.colorFn = color;
    this.heightFn = height;
  }
  H(i, j) {
    i = i < 0 ? 0 : i >= this.nx ? this.nx - 1 : i;
    j = j < 0 ? 0 : j >= this.nz ? this.nz - 1 : j;
    return this.h[j * this.nx + i];
  }
  height(x, z) {
    const fx0 = (x - this.minX) / this.step, fz0 = (z - this.minZ) / this.step;
    if (fx0 < 0 || fz0 < 0 || fx0 > this.nx - 1 || fz0 > this.nz - 1) return this.heightFn(x, z);
    const i = Math.min(this.nx - 2, Math.floor(fx0)), j = Math.min(this.nz - 2, Math.floor(fz0));
    const fx = fx0 - i, fz = fz0 - j;
    const ha = this.H(i, j), hb = this.H(i + 1, j), hc = this.H(i, j + 1), hd = this.H(i + 1, j + 1);
    if (fx + fz <= 1) return ha + (hb - ha) * fx + (hc - ha) * fz;
    return hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz);
  }
  normal(x, z, out) {
    const e = this.step * 0.5;
    const hl = this.height(x - e, z), hr = this.height(x + e, z), hd = this.height(x, z - e), hu = this.height(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }
  buildMeshes(material, { chunk = 40, uvScale = 1 / 7, shadows = true } = {}) {
    const meshes = [];
    const nrm = new THREE.Vector3();
    const col = new THREE.Color();
    for (let cj = 0; cj < this.nz - 1; cj += chunk) {
      for (let ci = 0; ci < this.nx - 1; ci += chunk) {
        const i1 = Math.min(this.nx - 1, ci + chunk), j1 = Math.min(this.nz - 1, cj + chunk);
        const w = i1 - ci + 1, d = j1 - cj + 1;
        const P = new Float32Array(w * d * 3), N = new Float32Array(w * d * 3), UV = new Float32Array(w * d * 2), C = new Float32Array(w * d * 3);
        let k = 0;
        for (let j = cj; j <= j1; j++) for (let i = ci; i <= i1; i++) {
          const x = this.minX + i * this.step, z = this.minZ + j * this.step, y = this.H(i, j);
          P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z;
          nrm.set(this.H(i - 1, j) - this.H(i + 1, j), 2 * this.step, this.H(i, j - 1) - this.H(i, j + 1)).normalize();
          N[k * 3] = nrm.x; N[k * 3 + 1] = nrm.y; N[k * 3 + 2] = nrm.z;
          UV[k * 2] = x * uvScale; UV[k * 2 + 1] = z * uvScale;
          this.colorFn(x, z, y, nrm.y, col);
          C[k * 3] = col.r; C[k * 3 + 1] = col.g; C[k * 3 + 2] = col.b;
          k++;
        }
        const idx = [];
        for (let j = 0; j < d - 1; j++) for (let i = 0; i < w - 1; i++) {
          const a = j * w + i, b = a + 1, c = a + w, dd = c + 1;
          idx.push(a, c, b, b, c, dd);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(P, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
        g.setAttribute('color', new THREE.BufferAttribute(C, 3));
        g.setIndex(idx.length > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, material);
        m.receiveShadow = true;
        m.castShadow = shadows;
        m.matrixAutoUpdate = false;
        meshes.push(m);
      }
    }
    return meshes;
  }
  // half-float height texture (for water depth shading)
  heightTexture() {
    const data = new Uint16Array(this.nx * this.nz);
    for (let i = 0; i < data.length; i++) data[i] = THREE.DataUtils.toHalfFloat(this.h[i]);
    const t = new THREE.DataTexture(data, this.nx, this.nz, THREE.RedFormat, THREE.HalfFloatType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return { tex: t, rect: new THREE.Vector4(this.minX, this.minZ, this.maxX - this.minX, this.maxZ - this.minZ) };
  }
}

export function terrainMaterial() {
  const t = getTex('terrain');
  return toonMat({ map: t, vertexColors: true, band: [-0.18, 0.32], rim: 0.0, variation: [0.09, 0.035] });
}

// ---------------------------------------------------------------------------
// Streamed grass: chunks generated around the player
const GRASS_VERT_PARS = /* glsl */`
attribute vec4 aOff;
attribute vec2 aVar;
uniform vec3 uPlayer;
uniform vec4 uGust;
uniform vec3 uGustDir;
uniform float uGrassDist;
varying float vH;
varying float vSeed;
varying vec3 vBase;
`;
const GRASS_VERT = /* glsl */`
vec3 transformed;
{
  vec3 base = aOff.xyz;
  float h = aVar.x;
  float c = cos( aOff.w ), s = sin( aOff.w );
  vec3 lp = vec3( position.x * c, position.y * h, position.x * s );
  float bend = position.y * position.y;
  vec2 wdir = normalize( uWind + 1e-4 );
  float t = uTime;
  float ph = dot( base.xz, vec2( 0.13, 0.1 ) ) + t * 1.9;
  vec2 disp = wdir * ( 0.12 + ( sin( ph ) * 0.5 + 0.5 ) * 0.22 + sin( ph * 2.7 + base.x ) * 0.06 );
  float wave = sin( dot( base.xz, wdir ) * 0.07 - t * 1.25 ) * 0.5 + 0.5;
  disp += wdir * wave * wave * 0.45;
  vec2 toP = base.xz - uPlayer.xz;
  float dp = length( toP );
  float tr = ( 1.0 - smoothstep( 0.25, 1.4, dp ) ) * ( 1.0 - smoothstep( 1.0, 2.0, abs( base.y - uPlayer.y ) ) );
  disp += ( toP / max( dp, 0.001 ) ) * tr * 1.3;
  float age = t - uGust.w;
  if ( age > 0.0 && age < 1.8 ) {
    vec2 toG = base.xz - uGust.xz;
    float dg = length( toG );
    float front = age * 17.0;
    float al = dot( toG / max( dg, 0.001 ), uGustDir.xz );
    float gw = exp( -abs( dg - front ) * 0.55 ) * ( 1.0 - age / 1.8 ) * smoothstep( 0.35, 0.85, al ) * ( 1.0 - smoothstep( 14.0, 22.0, dg ) );
    disp += uGustDir.xz * gw * 2.0;
  }
  float cd = distance( base.xz, cameraPosition.xz );
  float fade = 1.0 - smoothstep( uGrassDist * 0.65, uGrassDist, cd );
  lp.y *= fade;
  float dl = length( disp );
  lp.xz += disp * bend * h;
  lp.y -= min( dl, 1.2 ) * bend * h * 0.4;
  transformed = base + lp;
  vH = position.y;
  vSeed = aVar.y;
  vBase = base;
}
`;

export class GrassField {
  constructor(scene, { height, mask, density = 6, chunk = 20, dist = 60, colors = null, seed = 5, heightScale = 1 }) {
    this.scene = scene;
    this.heightFn = height;
    this.maskFn = mask;
    this.baseDensity = density;
    this.density = density;
    this.chunk = chunk;
    this.dist = dist;
    this.seed = seed;
    this.heightScale = heightScale;
    this.chunks = new Map();
    this.pending = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    // blade geometry
    const w = 0.085;
    const P = [-w / 2, 0, 0, w / 2, 0, 0, -w * 0.36, 0.45, 0, w * 0.36, 0.45, 0, 0, 1, 0];
    const N = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    const I = [0, 1, 2, 1, 3, 2, 2, 3, 4];
    this.blade = new THREE.InstancedBufferGeometry();
    this.blade.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    this.blade.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    this.blade.setIndex(I);
    const c = colors || { base: 0x4c8a36, mid: 0x74b046, tip: 0xc8dc70, dry: 0xcfc46a, blue: 0x62a676 };
    this.uniforms = {
      uGrassDist: { value: dist },
      uPlayer: U.uPlayer, uGust: U.uGust, uGustDir: U.uGustDir,
      uBaseC: { value: new THREE.Color(c.base) }, uMidC: { value: new THREE.Color(c.mid) }, uTipC: { value: new THREE.Color(c.tip) },
      uDryC: { value: new THREE.Color(c.dry) }, uBlueC: { value: new THREE.Color(c.blue) },
    };
    const mat = toonMat({ color: 0xffffff, side: THREE.DoubleSide, band: [-0.4, 0.3], rim: 0.0, variation: [0.0, 1], outline: false });
    const u = this.uniforms;
    const base = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, r) => {
      base(shader, r);
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + GRASS_VERT_PARS)
        .replace('#include <begin_vertex>', GRASS_VERT);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vH; varying float vSeed; varying vec3 vBase; uniform vec3 uBaseC; uniform vec3 uMidC; uniform vec3 uTipC; uniform vec3 uDryC; uniform vec3 uBlueC;')
        .replace('#include <color_fragment>', `
          {
            float pn = wrNoise( vBase.xz * 0.045 ) * 0.7 + wrNoise( vBase.xz * 0.21 + 3.0 ) * 0.3;
            vec3 tip = mix( uTipC, uDryC, smoothstep( 0.55, 0.8, pn ) * 0.7 );
            tip = mix( tip, uBlueC, smoothstep( 0.45, 0.2, pn ) * 0.5 );
            vec3 c = mix( uBaseC, uMidC, smoothstep( 0.0, 0.55, vH ) );
            c = mix( c, tip, smoothstep( 0.45, 1.0, vH ) );
            c *= 0.9 + vSeed * 0.2;
            diffuseColor.rgb = c;
          }`);
    };
    mat.customProgramCacheKey = () => 'wrgrass';
    this.material = mat;
    this.timer = 0;
  }

  setQuality(q) {
    this.density = this.baseDensity * q.grass;
    this.dist = q.grassDist;
    this.uniforms.uGrassDist.value = q.grassDist;
    // empty chunks are stored as null
    for (const [, m] of this.chunks) { if (m) { this.group.remove(m); m.geometry.dispose(); } }
    this.chunks.clear();
  }

  _build(ci, cj) {
    const S = this.chunk;
    const x0 = ci * S, z0 = cj * S;
    const rng = new RNG((ci * 73856093) ^ (cj * 19349663) ^ this.seed);
    const n = Math.floor(S * S * this.density);
    const off = new Float32Array(n * 4), vr = new Float32Array(n * 2);
    let k = 0;
    let minY = Infinity, maxY = -Infinity;
    for (let q = 0; q < n; q++) {
      const x = x0 + rng.next() * S, z = z0 + rng.next() * S;
      const m = this.maskFn(x, z);
      if (m <= 0 || rng.next() > m) { rng.next(); rng.next(); continue; }
      const y = this.heightFn(x, z);
      off[k * 4] = x; off[k * 4 + 1] = y - 0.03; off[k * 4 + 2] = z; off[k * 4 + 3] = rng.next() * Math.PI;
      vr[k * 2] = (0.3 + rng.next() * 0.48) * (0.6 + 0.4 * m) * this.heightScale;
      vr[k * 2 + 1] = rng.next();
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      k++;
    }
    if (k === 0) return null;
    // own copies of the tiny blade buffers: disposing a chunk must not free buffers other chunks use
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(this.blade.index.clone());
    g.setAttribute('position', this.blade.attributes.position.clone());
    g.setAttribute('normal', this.blade.attributes.normal.clone());
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off.subarray(0, k * 4), 4));
    g.setAttribute('aVar', new THREE.InstancedBufferAttribute(vr.subarray(0, k * 2), 2));
    g.instanceCount = k;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(x0 + S / 2, (minY + maxY) / 2, z0 + S / 2), S * 0.75 + (maxY - minY) / 2 + 1.5);
    const mesh = new THREE.Mesh(g, this.material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.renderOrder = 1;
    mesh.userData.noMap = true;
    return mesh;
  }

  update(dt, pos, force = false) {
    this.timer -= dt;
    if (this.timer > 0 && !force) return;
    this.timer = 0.2;
    const S = this.chunk, R = this.dist + S;
    const ci0 = Math.floor((pos.x - R) / S), ci1 = Math.floor((pos.x + R) / S);
    const cj0 = Math.floor((pos.z - R) / S), cj1 = Math.floor((pos.z + R) / S);
    const need = new Set();
    const toBuild = [];
    for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
      const cx = (ci + 0.5) * S, cz = (cj + 0.5) * S;
      if (Math.hypot(cx - pos.x, cz - pos.z) > R) continue;
      const key = ci + ',' + cj;
      need.add(key);
      if (!this.chunks.has(key)) toBuild.push([ci, cj, Math.hypot(cx - pos.x, cz - pos.z)]);
    }
    for (const [key, m] of this.chunks) {
      if (!need.has(key)) {
        if (m) { this.group.remove(m); m.geometry.dispose(); }
        this.chunks.delete(key);
      }
    }
    toBuild.sort((a, b) => a[2] - b[2]);
    const budget = force ? 999 : 3;
    for (let q = 0; q < Math.min(budget, toBuild.length); q++) {
      const [ci, cj] = toBuild[q];
      const m = this._build(ci, cj);
      this.chunks.set(ci + ',' + cj, m);
      if (m) this.group.add(m);
    }
  }
}

// ---------------------------------------------------------------------------
// Tree / rock / bush models (merged geometries with vertex colours)

function colorize(g, fn) {
  const pos = g.attributes.position;
  const c = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), col, i);
    c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function mergeGeos(list) {
  // list of non-indexed or indexed geometries with position/normal/color (uv optional)
  let vcount = 0, icount = 0;
  const prepared = list.map((g) => {
    const gi = g.index ? g : g;
    if (!gi.attributes.uv) gi.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(gi.attributes.position.count * 2), 2));
    vcount += gi.attributes.position.count;
    icount += gi.index ? gi.index.count : gi.attributes.position.count;
    return gi;
  });
  const P = new Float32Array(vcount * 3), N = new Float32Array(vcount * 3), C = new Float32Array(vcount * 3), UV = new Float32Array(vcount * 2);
  const I = new Uint32Array(icount);
  let vo = 0, io = 0;
  for (const g of prepared) {
    const n = g.attributes.position.count;
    P.set(g.attributes.position.array, vo * 3);
    N.set(g.attributes.normal.array, vo * 3);
    C.set(g.attributes.color.array, vo * 3);
    UV.set(g.attributes.uv.array, vo * 2);
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) I[io++] = a[i] + vo; }
    else for (let i = 0; i < n; i++) I[io++] = vo + i;
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  out.setIndex(new THREE.BufferAttribute(vo > 65535 ? I : new Uint16Array(I), 1));
  out.computeBoundingSphere();
  return out;
}

// blob with normals blended toward a centre (soft foliage shading)
// icosphere welded into an indexed mesh so computeVertexNormals gives smooth normals
function smoothIco(r, detail) {
  const g0 = new THREE.IcosahedronGeometry(r, detail);
  g0.deleteAttribute('normal');
  g0.deleteAttribute('uv');
  return mergeVertices(g0);
}

function blob(r, cx, cy, cz, center, soft = 0.6, detail = 1, noiseAmt = 0.18, seed = 1) {
  const g = smoothIco(r, detail);
  g.computeVertexNormals();
  const pos = g.attributes.position, nor = g.attributes.normal;
  const rng = new RNG(seed);
  const n = makeNoise2D(seed);
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const k = 1 + n(v.x * 1.3 + v.y, v.z * 1.3 - v.y) * noiseAmt;
    v.multiplyScalar(k);
    v.y *= 0.85;
    pos.setXYZ(i, v.x + cx, v.y + cy, v.z + cz);
  }
  void rng;
  g.computeVertexNormals();
  const nor2 = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    v.set(nor2.getX(i), nor2.getY(i), nor2.getZ(i));
    c.set(pos.getX(i) - center.x, pos.getY(i) - center.y, pos.getZ(i) - center.z).normalize();
    v.lerp(c, soft).normalize();
    nor2.setXYZ(i, v.x, v.y, v.z);
  }
  void nor;
  return g;
}

function trunkGeo(h, r0, r1, bend = 0, segs = 7) {
  const g = new THREE.CylinderGeometry(r1, r0, h, segs, 4);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setX(i, pos.getX(i) + Math.sin((y / h) * 2.2) * bend);
  }
  g.computeVertexNormals();
  return g;
}

const TREE_TYPES = {
  round: { leaf: [0x4f9a3c, 0x7cc04e], trunk: 0x6b4a36 },
  deep: { leaf: [0x3f7f3a, 0x5fa648], trunk: 0x5d4232 },
  sakura: { leaf: [0xe89ab4, 0xffd2e0], trunk: 0x5a3c34 },
  maple: { leaf: [0xc9502e, 0xf2a03c], trunk: 0x5a3c30 },
  golden: { leaf: [0xc9a534, 0xf2dc6a], trunk: 0x6b4a36 },
};

// lowest foliage / branch height in model units; trees are placed at >= 0.7 scale, so this keeps
// every canopy above the player's head (1.72 m)
const CANOPY_MIN = 2.8;

export function makeTreeModel(type = 'round', seed = 1) {
  const rng = new RNG(seed);
  const T = TREE_TYPES[type] || TREE_TYPES.round;
  const trunks = [], leaves = [];
  const H = rng.range(3.0, 4.2);
  const r0 = rng.range(0.3, 0.38), bend = rng.range(-0.25, 0.25);
  const center = new THREE.Vector3(0, H + 1.4, 0);
  const n = 5 + rng.int(0, 2);
  const cA = new THREE.Color(T.leaf[0]), cB = new THREE.Color(T.leaf[1]);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const rr = i === 0 ? 0 : rng.range(0.9, 1.6);
    const r = i === 0 ? rng.range(1.7, 2.1) : rng.range(1.1, 1.6);
    const cy = center.y + (i === 0 ? 0.5 : rng.range(-0.6, 0.5));
    leaves.push({ geo: blob(r, Math.cos(a) * rr, cy, Math.sin(a) * rr, center, 0.65, 1, 0.2, seed * 31 + i), tint: rng.range(-0.06, 0.06) });
  }
  // lift the whole crown (and lengthen the trunk) when a blob hangs below head height
  let low = Infinity;
  for (const l of leaves) { const p = l.geo.attributes.position; for (let k = 0; k < p.count; k++) low = Math.min(low, p.getY(k)); }
  const lift = Math.max(0, CANOPY_MIN - low);
  center.y += lift;
  for (const l of leaves) {
    l.geo.translate(0, lift, 0);
    colorize(l.geo, (x, y, z, c) => {
      const t = Math.max(0, Math.min(1, (y - (center.y - 2)) / 3.6));
      c.copy(cA).lerp(cB, t * t).offsetHSL(l.tint * 0.3, 0, l.tint);
      c.multiplyScalar(0.75 + t * 0.3);
    });
  }
  const TH = H + 0.6 + lift;
  const tg = trunkGeo(TH, r0, 0.16, bend);
  colorize(tg, (x, y, z, c) => c.set(T.trunk).multiplyScalar(0.8 + (y / TH) * 0.3));
  trunks.push(tg);
  // branches spring from above head height and angle up into the crown
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI * 2 + rng.range(0, 1);
    const bl = rng.range(1.2, 1.8);
    const bg = trunkGeo(bl, 0.1, 0.05, 0, 5);
    bg.rotateZ(-0.9); bg.rotateY(a);
    bg.translate(0, Math.max(CANOPY_MIN - 0.3, TH * rng.range(0.62, 0.85)), 0);
    colorize(bg, (x, y, z, c) => c.set(T.trunk));
    trunks.push(bg);
  }
  return { trunk: mergeGeos(trunks), leaves: mergeGeos(leaves.map((l) => l.geo)), height: TH + 2.9, radius: r0, bend, trunkH: TH, leafLow: low + lift };
}

export function makeConiferModel(seed = 1) {
  const rng = new RNG(seed);
  const H = rng.range(8.2, 10.8);
  const tg = trunkGeo(H, 0.32, 0.12, 0, 7);
  colorize(tg, (x, y, z, c) => c.set(0x5d3f30).multiplyScalar(0.85 + (y / H) * 0.2));
  const tiers = 5;
  const leaves = [];
  const cA = new THREE.Color(0x2f5f3e), cB = new THREE.Color(0x5d9a5a);
  // the lowest tier's skirt starts at CANOPY_MIN (bare trunk below, like a tall pine)
  const y0 = CANOPY_MIN + 1.3;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = 2.6 * (1 - t * 0.72) + rng.range(-0.1, 0.1);
    const hh = 2.6 - t * 0.8;
    const y = y0 + t * (H - y0);
    const g = new THREE.ConeGeometry(r, hh, 9, 2);
    const pos = g.attributes.position;
    const nz = makeNoise2D(seed + i);
    for (let k = 0; k < pos.count; k++) {
      const px = pos.getX(k), pz = pos.getZ(k), py = pos.getY(k);
      const f = 1 + nz(px * 2, pz * 2) * 0.12;
      pos.setXYZ(k, px * f, py + y + (py < -hh / 2 + 0.01 ? Math.sin(Math.atan2(pz, px) * 4) * 0.12 : 0), pz * f);
    }
    g.computeVertexNormals();
    const nor = g.attributes.normal;
    const v = new THREE.Vector3();
    for (let k = 0; k < pos.count; k++) {
      v.set(nor.getX(k), nor.getY(k) + 0.6, nor.getZ(k)).normalize();
      nor.setXYZ(k, v.x, v.y, v.z);
    }
    colorize(g, (x, yy, z, c) => { const q = Math.max(0, Math.min(1, (yy - (y - hh / 2)) / hh)); c.copy(cA).lerp(cB, q * 0.7 + t * 0.3); });
    leaves.push(g);
  }
  let leafLow = Infinity;
  for (const g of leaves) { const p = g.attributes.position; for (let k = 0; k < p.count; k++) leafLow = Math.min(leafLow, p.getY(k)); }
  return { trunk: mergeGeos([tg]), leaves: mergeGeos(leaves), height: H + 1, radius: 0.32, bend: 0, trunkH: H, leafLow };
}

export function makeBushModel(seed = 1, color = [0x4a8f3a, 0x78b94c], scale = 1) {
  const rng = new RNG(seed);
  const leaves = [];
  const center = new THREE.Vector3(0, 0.5 * scale, 0);
  const cA = new THREE.Color(color[0]), cB = new THREE.Color(color[1]);
  const n = 3 + rng.int(0, 2);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), rr = i === 0 ? 0 : rng.range(0.4, 0.7) * scale;
    const r = rng.range(0.55, 0.85) * scale;
    const g = blob(r, Math.cos(a) * rr, center.y + rng.range(-0.1, 0.2) * scale, Math.sin(a) * rr, center, 0.6, 1, 0.22, seed * 17 + i);
    colorize(g, (x, y, z, c) => { const t = Math.max(0, Math.min(1, y / (1.2 * scale))); c.copy(cA).lerp(cB, t); c.multiplyScalar(0.8 + t * 0.25); });
    leaves.push(g);
  }
  return { leaves: mergeGeos(leaves) };
}

export function makeRockModel(seed = 1, { flat = 0.7, color = 0xa8a699, detail = 1 } = {}) {
  const g = smoothIco(1, detail);
  const pos = g.attributes.position;
  const nz = makeNoise2D(seed);
  const rng = new RNG(seed);
  const sx = rng.range(0.8, 1.3), sz = rng.range(0.8, 1.3);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + nz(x * 1.7 + y, z * 1.7 - y) * 0.22 + nz(x * 4, z * 4 + y * 3) * 0.06;
    x *= k * sx; y *= k * flat; z *= k * sz;
    if (y < -0.3 * flat) y = -0.3 * flat + (y + 0.3 * flat) * 0.3;
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  const base = new THREE.Color(color);
  colorize(g, (x, y, z, c) => { c.copy(base).multiplyScalar(0.82 + (y / flat) * 0.18 + rng.range(-0.03, 0.03)); });
  const gg = g.index ? g : g;
  return { geo: mergeGeos([gg]) };
}

// Instanced scatter helper with spatial chunking for culling
export class InstancedKit {
  constructor(scene, { chunk = 70 } = {}) {
    this.scene = scene;
    this.chunk = chunk;
    this.groups = new Map(); // key: model|cell -> {geo, mat, list}
  }
  add(geo, mat, matrix, { cast = true, receive = true, key = '' } = {}) {
    const e = matrix.elements;
    const cx = Math.floor(e[12] / this.chunk), cz = Math.floor(e[14] / this.chunk);
    const k = geo.uuid + '|' + mat.uuid + '|' + cx + '|' + cz + key;
    let gr = this.groups.get(k);
    if (!gr) { gr = { geo, mat, list: [], cast, receive }; this.groups.set(k, gr); }
    gr.list.push(matrix.clone());
  }
  build() {
    const meshes = [];
    for (const gr of this.groups.values()) {
      const m = new THREE.InstancedMesh(gr.geo, gr.mat, gr.list.length);
      gr.list.forEach((mx, i) => m.setMatrixAt(i, mx));
      m.instanceMatrix.needsUpdate = true;
      m.castShadow = gr.cast;
      m.receiveShadow = gr.receive;
      m.computeBoundingSphere();
      this.scene.add(m);
      meshes.push(m);
    }
    this.groups.clear();
    return meshes;
  }
}

export const natureMats = {
  bark: () => M('bark'),
  leaves: () => M('leaves'),
  rock: () => M('rock'),
};

export function treeSet(seedBase = 100) {
  // a small library of pre-built variants
  return {
    round: [makeTreeModel('round', seedBase + 1), makeTreeModel('round', seedBase + 2), makeTreeModel('deep', seedBase + 3)],
    sakura: [makeTreeModel('sakura', seedBase + 4), makeTreeModel('sakura', seedBase + 5)],
    maple: [makeTreeModel('maple', seedBase + 6)],
    golden: [makeTreeModel('golden', seedBase + 9)],
    conifer: [makeConiferModel(seedBase + 7), makeConiferModel(seedBase + 8)],
    bush: [makeBushModel(seedBase + 10), makeBushModel(seedBase + 11, [0x3f7f3a, 0x6aa848]), makeBushModel(seedBase + 12, [0x4a8f3a, 0x8fc454], 0.8)],
    rock: [makeRockModel(seedBase + 13), makeRockModel(seedBase + 14, { flat: 0.55 }), makeRockModel(seedBase + 15, { flat: 0.9, color: 0x9fa08f })],
  };
}

const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _s4 = new THREE.Vector3(), _p4 = new THREE.Vector3(), _e4 = new THREE.Euler();
export function trs(x, y, z, ry = 0, s = 1, rx = 0, rz = 0, sy = null) {
  _e4.set(rx, ry, rz);
  _q4.setFromEuler(_e4);
  return _m4.compose(_p4.set(x, y, z), _q4, _s4.set(s, sy !== null ? sy : s, s)).clone();
}

// place a tree (trunk + leaves instanced) with optional collider
export function placeTree(kit, model, x, y, z, ry, s, physics = null) {
  const m = trs(x, y - 0.15, z, ry, s);
  if (model.trunk) kit.add(model.trunk, M('bark'), m);
  kit.add(model.leaves, M('leaves'), m);
  if (physics && model.trunk) {
    // follow the trunk's bend at chest height (the bend runs along the model's local x)
    const ly = 1.0 / s, th = model.trunkH || 4;
    const off = Math.sin((ly / th) * 2.2) * (model.bend || 0) * s;
    physics.addCyl(x + Math.cos(ry) * off, z - Math.sin(ry) * off, (model.radius || 0.35) * s + 0.04, y - 1, y - 0.15 + th * s, { walkable: false });
  }
}

// ---------------------------------------------------------------------------
// Colliders fitted to instanced models (rocks, bushes). The model's vertices that stand above the
// ground under them give an ellipse in its local x/z frame, approximated by a "stadium" (two
// cylinders + a box). With `groundFn` each vertex is measured against the ground right below it,
// so rocks on slopes keep their full downhill extent.
const _fv = new THREE.Vector3();
export function modelFootprint(geo, { x = 0, z = 0, y, groundY, groundFn = null, ry = 0, s, sy = s, band = 1.9, inset = 1 }) {
  const pos = geo.attributes.position;
  const c = Math.cos(ry), sn = Math.sin(ry);
  let ax = 0, az = 0, top = -Infinity, low = Infinity, any = false;
  for (let i = 0; i < pos.count; i++) {
    _fv.fromBufferAttribute(pos, i);
    const wy = y + _fv.y * sy;
    if (wy > top) top = wy;
    const g = groundFn ? groundFn(x + (_fv.x * c + _fv.z * sn) * s, z + (-_fv.x * sn + _fv.z * c) * s) : groundY;
    if (wy < g + 0.1 || wy > g + band) continue;
    any = true;
    if (g < low) low = g;
    ax = Math.max(ax, Math.abs(_fv.x) * s);
    az = Math.max(az, Math.abs(_fv.z) * s);
  }
  if (!any) return null;
  return { a: ax * inset, b: az * inset, top, low };
}

export function addEllipseCollider(P, x, z, a, b, ry, bottom, top, opts = {}) {
  const major = Math.max(a, b), minor = Math.min(a, b);
  if (major - minor < Math.max(0.15, major * 0.12)) { P.addCyl(x, z, (a + b) / 2, bottom, top, opts); return; }
  // unit vector of the major axis (model local x -> world (cos, -sin), local z -> (sin, cos))
  const c = Math.cos(ry), s = Math.sin(ry);
  const ux = a >= b ? c : s, uz = a >= b ? -s : c;
  const off = major - minor;
  P.addCyl(x + ux * off, z + uz * off, minor, bottom, top, opts);
  P.addCyl(x - ux * off, z - uz * off, minor, bottom, top, opts);
  P.addBox(x, (bottom + top) / 2, z, a >= b ? off : minor, (top - bottom) / 2, a >= b ? minor : off, ry, opts);
}

// place a rock with a collider matching its visible footprint; low rocks become steps
export function placeRock(kit, P, geo, x, groundY, z, { y = groundY, ry = 0, s = 1, sy = s, rx = 0, rz = 0, cast = true, inset = 0.93, walkable = true, groundFn = null } = {}) {
  if (kit) kit.add(geo, M('rock'), trs(x, y, z, ry, s, rx, rz, sy), { cast });
  if (!P) return;
  const f = modelFootprint(geo, { x, z, y, groundY, groundFn, ry, s, sy, inset });
  if (!f || f.top < f.low + 0.12) return;
  // only rocks taller than the player's shoulders stop the camera
  addEllipseCollider(P, x, z, f.a, f.b, ry, f.low - 1.5, f.top - 0.04, { walkable, blockCam: f.top - groundY > 1.3 });
}

// bushes are solid (a little smaller than the foliage so the leaves brush the player)
export function placeBush(kit, P, geo, x, groundY, z, { y = groundY - 0.1, ry = 0, s = 1, groundFn = null } = {}) {
  kit.add(geo, M('leaves'), trs(x, y, z, ry, s));
  if (!P) return;
  const f = modelFootprint(geo, { x, z, y, groundY, groundFn, ry, s, inset: 0.86 });
  if (!f || f.top < f.low + 0.35) return;
  addEllipseCollider(P, x, z, f.a, f.b, ry, f.low - 1, f.top, { walkable: false, blockCam: false });
}

// on slopes the uphill side of a crown can hang down to head height: such spots get no tree
export function canopyClear(model, heightFn, x, y, z, s) {
  const low = y - 0.15 + (model.leafLow || CANOPY_MIN) * s;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    for (const r of [1.2 * s, 2.4 * s]) if (heightFn(x + Math.cos(a) * r, z + Math.sin(a) * r) + 1.9 > low) return false;
  }
  return true;
}

// flower heads (instanced small star shapes) scattered via a mask
export function makeFlowerGeo() {
  const g = new THREE.CylinderGeometry(0.11, 0.02, 0.06, 5, 1);
  g.translate(0, 0.38, 0);
  const stem = new THREE.CylinderGeometry(0.012, 0.012, 0.38, 3, 1);
  stem.translate(0, 0.19, 0);
  colorize(g, (x, y, z, c) => c.setRGB(1, 1, 1));
  colorize(stem, (x, y, z, c) => c.set(0x4c8a36));
  return mergeGeos([g, stem]);
}
export { mergeGeos, colorize, blob, hash2, fbm };
