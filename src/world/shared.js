// World layout shared by the city and the wilds (same global coordinates).
// +x east, -z north. City plaza at (0,0,0); the south gate at z=100 leads to the wilds.
import * as THREE from 'three';
import { makeNoise2D, fbm, Polyline, smoothstep, clamp, lerp } from '../core/util.js';
import { mat4, boxGeo, archWallGeo, archRingGeo, cylGeo } from './geom.js';
import { toonMat, defineMaterial } from '../gfx/materials.js';
import { getTex } from '../gfx/textures.js';

// far landmarks need much weaker fog to read as a hazy silhouette
defineMaterial('farStone', () => toonMat({ map: getTex('ruin'), vertexColors: true, rim: 0.25, variation: [0.05, 0.05], fogMul: 0.3 }));
defineMaterial('farGold', () => toonMat({ color: 0xd9ad4f, emissive: 0x7fe8d8, emissiveIntensity: 0.0, rim: 0.5, fogMul: 0.3 }));
import { wallSegment, roundTower, gableRoof, hipRoof, column, bridge, PAL } from './kit.js';

const N1 = makeNoise2D(11), N2 = makeNoise2D(23), N3 = makeNoise2D(37), N4 = makeNoise2D(53);

export const CITY = { minX: -110, maxX: 110, minZ: -116, maxZ: 100 };
export const CITY_OUT = { minX: -113, maxX: 113, minZ: -119, maxZ: 103 };
export const GATE_Z = 100;
export const MOAT_Y = -1.3;

// ---------------------------------------------------------------------------
// polylines with fast "near" queries
class Path extends Polyline {
  constructor(points, smooth = 5) {
    super(smooth ? Polyline.smooth(points, smooth) : points);
    for (const g of this.seg) {
      g.minX = Math.min(g.ax, g.ax + g.dx); g.maxX = Math.max(g.ax, g.ax + g.dx);
      g.minZ = Math.min(g.az, g.az + g.dz); g.maxZ = Math.max(g.az, g.az + g.dz);
    }
    this.ctrl = points;
  }
  // closest within maxD, or null
  near(x, z, maxD, out = {}) {
    const b = this.bounds;
    if (x < b.minX - maxD || x > b.maxX + maxD || z < b.minZ - maxD || z > b.maxZ + maxD) return null;
    let best = maxD * maxD, found = false;
    for (const g of this.seg) {
      if (x < g.minX - maxD || x > g.maxX + maxD || z < g.minZ - maxD || z > g.maxZ + maxD) continue;
      let t = ((x - g.ax) * g.dx + (z - g.az) * g.dz) / (g.len * g.len);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = g.ax + g.dx * t, pz = g.az + g.dz * t;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < best) { best = d2; found = true; out.s = g.s0 + g.len * t; out.x = px; out.z = pz; out.tx = g.dx / g.len; out.tz = g.dz / g.len; }
    }
    if (!found) return null;
    out.d = Math.sqrt(best);
    return out;
  }
}

export const ROAD_MAIN = new Path([[0, 104], [0, 124], [-5, 140], [-13, 158], [-9, 180], [8, 204], [30, 226], [58, 246], [86, 260], [104, 268], [110, 276]]);
export const ROAD_RUINS = new Path([[110, 306], [112, 322], [118, 338], [125, 350]]);
export const ROAD_WEST = new Path([[8, 204], [-16, 214], [-42, 232], [-56, 254], [-60, 270], [-62, 290], [-72, 314], [-86, 336], [-96, 348]]);
export const ROADS = [ROAD_MAIN, ROAD_RUINS, ROAD_WEST];

// river control points [x, z, waterY, width]
export const RIVER_CTRL = [
  [-270, 214, -9.2, 15], [-220, 226, -9.8, 15], [-170, 240, -10.5, 14], [-125, 254, -11.2, 13], [-90, 264, -11.6, 13],
  [-62, 272, -11.9, 14], [-30, 279, -12.4, 12], [0, 284, -12.9, 12], [26, 288, -13.4, 11], [43, 290, -13.8, 11],
  [52, 291, -31.0, 9], [80, 292, -31.3, 9], [110, 292, -31.6, 9], [150, 289, -32, 9], [200, 286, -32.4, 9], [270, 282, -33, 9],
];
export const RIVER = new Path(RIVER_CTRL.map((p) => [p[0], p[1]]), 0);
const RIVER_S = (() => { const s = [0]; for (let i = 1; i < RIVER_CTRL.length; i++) s.push(s[i - 1] + Math.hypot(RIVER_CTRL[i][0] - RIVER_CTRL[i - 1][0], RIVER_CTRL[i][1] - RIVER_CTRL[i - 1][1])); return s; })();
export function riverAttr(s, out = {}) {
  let i = 0;
  while (i < RIVER_S.length - 2 && RIVER_S[i + 1] < s) i++;
  const t = clamp((s - RIVER_S[i]) / (RIVER_S[i + 1] - RIVER_S[i]), 0, 1);
  out.y = lerp(RIVER_CTRL[i][2], RIVER_CTRL[i + 1][2], t);
  out.w = lerp(RIVER_CTRL[i][3], RIVER_CTRL[i + 1][3], t);
  return out;
}
export const FALLS_X0 = 44, FALLS_X1 = 51;
export const FORD = { x0: -72, x1: -50 };

export const PLATEAU = { minX: 58, maxX: 205, minZ: 300, maxZ: 470, y: -5 };
export const RUINS = { x: 130, z: 388, y: -0.5, r: 30 };
export const BRIDGE_X = 110;
export const RIM_Y = -5.5;
export const TOWER_FAR = new THREE.Vector3(560, -30, 1150);
export const CAVE = { x: -104, z: 360 };
let _caveY = null;
function caveFloorY() {
  if (_caveY === null) _caveY = heightNoRoad(CAVE.x + 8, CAVE.z - 10) + 0.4;
  return _caveY;
}

function rectDist(x, z, r) {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  if (dx > 0 || dz > 0) return Math.hypot(dx, dz);
  return -Math.min(x - r.minX, r.maxX - x, z - r.minZ, r.maxZ - z);
}
export { rectDist };

const PLAY = { minX: -200, maxX: 205, minZ: -125, maxZ: 478 };

const _n = {};
function baseHeight(x, z) {
  let h = -10 + fbm(N1, x * 0.0055, z * 0.0055, 4) * 4.8 + fbm(N2, x * 0.022 + 7, z * 0.022 - 3, 3) * 1.3;
  // gentle rise toward the forest (west) & south hills
  h += smoothstep(-40, -180, x) * 3 * (0.5 + 0.5 * fbm(N3, x * 0.01, z * 0.01, 2));
  // city plateau + moat
  const cd = rectDist(x, z, CITY_OUT);
  if (cd < 0) h = 0;
  else {
    const t = smoothstep(13, 85, cd);
    h = lerp(0, h, t);
    if (cd < 14) {
      const m = cd < 3 ? 0 : cd > 13 ? 0 : Math.sin(((cd - 3) / 10) * Math.PI);
      h -= Math.pow(m, 0.6) * 4.6;
    }
  }
  // ruins plateau (raised table-land south of the gorge, cliff on the west side)
  const pd = rectDist(x, z, PLATEAU);
  if (pd < 7) {
    const t = 1 - smoothstep(-3, 7, pd);
    h = lerp(h, PLATEAU.y + fbm(N4, x * 0.03, z * 0.03, 2) * 0.5, t);
  }
  // cave mound
  const cx = x - (CAVE.x - 12), cz = z - (CAVE.z + 10);
  h += 16 * Math.exp(-(cx * cx + cz * cz) / (2 * 22 * 22));
  // boundary mountains
  const ed = rectDist(x, z, PLAY);
  if (ed > -25) {
    const m = smoothstep(-25, 50, ed);
    let gap = 1;
    if (z > 400 && x > 110 && x < 260) gap = 0.42 + 0.58 * smoothstep(0, 40, Math.abs(x - 185) - 35);
    h += m * m * (58 + fbm(N3, x * 0.012, z * 0.012, 3) * 26) * gap;
  }
  return h;
}

function riverCarve(x, z, h) {
  const rc = RIVER.near(x, z, 26, _n);
  if (!rc) return h;
  const a = riverAttr(rc.s, _r);
  const hw = a.w / 2;
  const d = rc.d;
  const gorgeT = smoothstep(FALLS_X0 - 1, FALLS_X1, rc.x);
  let rh = h;
  // ordinary river channel with banks
  if (gorgeT < 1) {
    const fd = Math.max(FORD.x0 - x, x - FORD.x1, 0);
    const ford = 1 - smoothstep(0, 8, fd);
    const depth = lerp(1.7, 0.55, ford);
    let ch;
    if (d < hw) ch = a.y - (0.25 + depth * (1 - (d / hw) * (d / hw)));
    else ch = lerp(a.y + 0.25, Math.max(h, a.y + 0.25), smoothstep(hw, hw + 9, d));
    rh = Math.min(h, ch);
  }
  if (gorgeT > 0) {
    const bottom = a.y - 1.6 + fbm(N4, x * 0.1, z * 0.1, 2) * 0.3;
    let gh;
    if (d < hw + 0.5) gh = bottom;
    else if (d < hw + 6.5) gh = lerp(bottom, h, Math.pow((d - hw - 0.5) / 6, 0.85));
    else gh = h;
    rh = lerp(rh, Math.min(h, gh), gorgeT);
  }
  return rh;
}
const _r = {};

const _rq = {};
function roadFlatten(x, z, h, pre) {
  for (const road of ROADS) {
    const rc = road.near(x, z, 8, _rq);
    if (!rc) continue;
    const d = rc.d; // pre() below reuses other scratch objects
    const target = pre(rc.x, rc.z);
    const t = 1 - smoothstep(3.2, 8, d);
    h = lerp(h, target, t);
  }
  return h;
}

function heightNoRoad(x, z) {
  let h = baseHeight(x, z);
  h = riverCarve(x, z, h);
  return h;
}

export function wildsHeight(x, z) {
  let h = heightNoRoad(x, z);
  h = roadFlatten(x, z, h, heightNoRoad);
  // flattened rims at the broken bridge
  const nr = rectDist(x, z, { minX: 98, maxX: 124, minZ: 262, maxZ: 280.5 });
  if (nr < 6) h = lerp(RIM_Y, h, smoothstep(0, 6, nr));
  const sr = rectDist(x, z, { minX: 98, maxX: 124, minZ: 301.5, maxZ: 316 });
  if (sr < 6) h = lerp(RIM_Y, h, smoothstep(0, 6, sr));
  // flat cave floor
  const cd2 = Math.hypot(x - CAVE.x, z - CAVE.z);
  if (cd2 < 15) h = lerp(caveFloorY(), h, smoothstep(9.5, 15, cd2));
  // the ford: stepping area is shallow
  return h;
}

export function wildsWater(x, z) {
  const cd = rectDist(x, z, CITY_OUT);
  if (cd > 3 && cd < 13.5) return MOAT_Y;
  const rc = RIVER.near(x, z, 12, _n);
  if (!rc) return -Infinity;
  const a = riverAttr(rc.s, _r);
  if (rc.d > a.w / 2 + 1.5) return -Infinity;
  if (rc.x > FALLS_X0 - 1 && rc.x < FALLS_X1 + 1) return -Infinity;
  return a.y;
}

// terrain colouring
const C = (h) => new THREE.Color(h);
const COL = {
  grassA: C(0x6fae45), grassB: C(0x8cc052), dark: C(0x4f8a38), dry: C(0xb9b65c), rock: C(0x8e8c7f), rockDark: C(0x6f6e66),
  dirt: C(0xc4a26c), dirtDark: C(0xa4845a), sand: C(0xd6c897), wet: C(0x7d8a64), plateau: C(0x86b04e), moss: C(0x5f8a44), snow: C(0xf2f5f7),
};
const _c = new THREE.Color();
export function wildsColor(x, z, h, ny, out) {
  const n = fbm(N2, x * 0.018, z * 0.018, 3);
  const n2 = N3(x * 0.07, z * 0.07);
  out.copy(COL.grassA).lerp(COL.grassB, clamp(n * 0.8 + 0.5, 0, 1));
  // forest floor darker
  const forest = forestMask(x, z);
  if (forest > 0) out.lerp(COL.dark, forest * 0.75);
  // dry patches
  out.lerp(COL.dry, smoothstep(0.35, 0.7, n2) * 0.45 * (1 - forest));
  if (rectDist(x, z, PLATEAU) < 0) out.lerp(COL.plateau, 0.35);
  // river banks / underwater
  const rc = RIVER.near(x, z, 24, _n);
  if (rc) {
    const a = riverAttr(rc.s, _r);
    const above = h - a.y;
    if (above < 0.1) out.copy(COL.wet).lerp(COL.sand, clamp(above + 0.9, 0, 1) * 0.5);
    else if (above < 1.2 && rc.d < a.w / 2 + 5) out.lerp(COL.sand, (1 - smoothstep(0.2, 1.2, above)) * 0.85);
  }
  const cd = rectDist(x, z, CITY_OUT);
  if (cd > 2 && cd < 14 && h < MOAT_Y + 0.8) out.copy(COL.wet);
  // roads
  for (const road of ROADS) {
    const r = road.near(x, z, 5, _n);
    if (r) {
      const k = 1 - smoothstep(1.6 + n2 * 0.8, 3.4 + n2, r.d);
      out.lerp(_c.copy(COL.dirt).lerp(COL.dirtDark, clamp(n2 * 0.5 + 0.5, 0, 1) * 0.4), k);
    }
  }
  // rims near the broken bridge: worn dirt
  if (rectDist(x, z, { minX: 100, maxX: 122, minZ: 266, maxZ: 279 }) < 0 || rectDist(x, z, { minX: 100, maxX: 122, minZ: 303, maxZ: 314 }) < 0) out.lerp(COL.dirt, 0.5);
  // cave floor: dark packed earth
  const cvd = Math.hypot(x - CAVE.x, z - CAVE.z);
  if (cvd < 11) out.lerp(_c.set(0x6a5e4c), 1 - smoothstep(7, 11, cvd));
  // steep -> rock
  const rockK = smoothstep(0.84, 0.6, ny);
  if (rockK > 0) out.lerp(_c.copy(COL.rock).lerp(COL.rockDark, clamp(n2 + 0.5, 0, 1) * 0.5), rockK);
  // mountain tops
  if (h > 30) out.lerp(COL.rock, smoothstep(30, 55, h) * 0.6);
  if (h > 58) out.lerp(COL.snow, smoothstep(58, 70, h));
  return out;
}

export function forestMask(x, z) {
  // west forest, both banks
  let f = 0;
  if (x < -40) {
    f = smoothstep(-40, -70, x) * smoothstep(120, 160, z) * (1 - smoothstep(400, 440, z));
    f *= 0.75 + 0.25 * fbm(N1, x * 0.02, z * 0.02, 2);
  }
  // small grove near the plateau west slope
  const gx = x - 70, gz = z - 330;
  f = Math.max(f, Math.exp(-(gx * gx + gz * gz) / (2 * 18 * 18)) * 0.8);
  return clamp(f, 0, 1);
}

// grass density mask (0..1), sampled from a precomputed grid for speed
let grassGrid = null;
const GG = { minX: -210, maxX: 215, minZ: 100, maxZ: 490, step: 2 };
export function buildGrassGrid(heightFn) {
  const nx = Math.round((GG.maxX - GG.minX) / GG.step) + 1, nz = Math.round((GG.maxZ - GG.minZ) / GG.step) + 1;
  const g = new Float32Array(nx * nz);
  const nrm = new THREE.Vector3();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = GG.minX + i * GG.step, z = GG.minZ + j * GG.step;
    let m = 1;
    const h = heightFn(x, z);
    // slope
    const e = 1.2;
    nrm.set(heightFn(x - e, z) - heightFn(x + e, z), 2 * e, heightFn(x, z - e) - heightFn(x, z + e)).normalize();
    m *= smoothstep(0.7, 0.9, nrm.y);
    if (h > 28) m *= 1 - smoothstep(28, 40, h);
    for (const road of ROADS) { const r = road.near(x, z, 4, _n); if (r) m *= smoothstep(2.4, 4, r.d); }
    const w = wildsWater(x, z);
    if (w > -Infinity && w > h - 0.6) m = 0;
    const rc = RIVER.near(x, z, 12, _n);
    if (rc) { const a = riverAttr(rc.s, _r); if (h < a.y + 0.7) m *= smoothstep(a.y + 0.2, a.y + 0.7, h); }
    if (rectDist(x, z, CITY_OUT) < 15) m = 0;
    const rd = Math.hypot(x - RUINS.x, z - RUINS.z);
    if (rd < RUINS.r + 1) m = 0;
    if (rectDist(x, z, { minX: 100, maxX: 122, minZ: 266, maxZ: 279 }) < 0) m *= 0.3;
    if (Math.hypot(x - CAVE.x, z - CAVE.z) < 9) m = 0;
    m *= 1 - forestMask(x, z) * 0.45;
    g[j * nx + i] = m;
  }
  grassGrid = { g, nx, nz };
}
export function wildsGrass(x, z) {
  if (!grassGrid) return 0;
  const fx = (x - GG.minX) / GG.step, fz = (z - GG.minZ) / GG.step;
  if (fx < 0 || fz < 0 || fx >= grassGrid.nx - 1 || fz >= grassGrid.nz - 1) return 0;
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const g = grassGrid.g, nx = grassGrid.nx;
  const a = g[j * nx + i], b = g[j * nx + i + 1], c = g[(j + 1) * nx + i], d = g[(j + 1) * nx + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

// ---------------------------------------------------------------------------
// City walls, towers and gatehouse — identical in both zones
export function buildCityShell(B, phys, { exterior = false } = {}) {
  const S = 0xdcd3c0;
  const H = 10.5;
  const gx = 12.5;
  const walls = [
    [CITY.minX, CITY.maxZ, -gx, CITY.maxZ], [gx, CITY.maxZ, CITY.maxX, CITY.maxZ],
    [CITY.minX, CITY.minZ, CITY.maxX, CITY.minZ],
    [CITY.minX, CITY.minZ, CITY.minX, CITY.maxZ], [CITY.maxX, CITY.minZ, CITY.maxX, CITY.maxZ],
  ];
  for (const w of walls) {
    // split long walls into segments for culling / merlon rhythm
    const len = Math.hypot(w[2] - w[0], w[3] - w[1]);
    const n = Math.max(1, Math.round(len / 40));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      wallSegment(B, phys, lerp(w[0], w[2], t0), lerp(w[1], w[3], t0), lerp(w[0], w[2], t1), lerp(w[1], w[3], t1), { h: H, t: 4, stone: S });
    }
  }
  // towers
  const towers = [
    [CITY.minX, CITY.minZ, 6.5, 17], [CITY.maxX, CITY.minZ, 6.5, 17], [CITY.minX, CITY.maxZ, 6.5, 17], [CITY.maxX, CITY.maxZ, 6.5, 17],
    [CITY.minX, -8, 4.8, 14], [CITY.maxX, -8, 4.8, 14], [-58, CITY.maxZ, 4.8, 14], [58, CITY.maxZ, 4.8, 14], [-55, CITY.minZ, 4.8, 14], [55, CITY.minZ, 4.8, 14],
  ];
  for (const [x, z, r, h] of towers) roundTower(B, phys, { x, z, r, h, crenel: true, roof: 0x4d6b95, stone: S, windows: 2 });
  // gatehouse: two square towers + arched gate block
  for (const s of [-1, 1]) {
    const tx = s * 8.5;
    B.box('stone', tx, 8.5, CITY.maxZ, 8, 17, 9, 0, S, { collide: true, ao: 4 });
    B.box('stone', tx, 17.4, CITY.maxZ, 8.8, 0.8, 9.8, 0, 0xcfc6b2);
    const W = mat4(tx, 17.8, CITY.maxZ);
    hipRoof(B, W, 8.4, 9.4, 0, { h: 6.5, color: 0x4d6b95, over: 0.4 });
    // arrow slit windows
    for (const zz of [-1, 1]) for (const yy of [6, 11]) B.box('glass', tx, yy, CITY.maxZ + zz * 4.52, 0.5, 1.6, 0.1, 0);
  }
  // gate block with arch opening (7 wide, 8.5 tall), depth 9
  const G = mat4(0, 0, CITY.maxZ);
  B.add('stone', archWallGeo(9.2, 13, 9, 7, 8.5), G, S, { ao: 3 });
  B.add('stone', archRingGeo(3.5, 4.3, 9.3, 14), mat4(0, 8.5 - 3.5, CITY.maxZ), 0xe6ddc9);
  B.box('stone', 0, 13.3, CITY.maxZ, 9.4, 0.6, 9.6, 0, 0xcfc6b2);
  for (let i = 0; i < 4; i++) for (const zz of [-1, 1]) B.box('stone', -3.3 + i * 2.2, 14.1, CITY.maxZ + zz * 4.3, 1.1, 1.1, 0.6, 0, S);
  if (phys) {
    phys.addBox(0, 10.8, CITY.maxZ, 4.6, 2.3, 4.5, 0, { walkable: false });
    // side jambs inside the passage
    for (const s of [-1, 1]) phys.addBox(s * 4.1, 4.3, CITY.maxZ, 0.6, 4.3, 4.5, 0);
  }
  // crest above the arch (both faces)
  for (const zz of [-1, 1]) {
    B.add('gold', new THREE.TorusGeometry(0.9, 0.12, 8, 24), mat4(0, 10.6, CITY.maxZ + zz * 4.62), 0xffffff);
  }
  // canal water gates (visual arches) in east / west walls
  for (const s of [-1, 1]) {
    B.add('stone', archRingGeo(3, 3.8, 4.6, 12), mat4(s * CITY.maxX, -1.4, 30, 0, Math.PI / 2, 0), 0xe6ddc9);
    for (let i = -2; i <= 2; i++) B.box('metal', s * CITY.maxX, 0.2, 30 + i * 1.1, 0.14, 3.2, 0.14, 0, 0x3a3a40);
  }
  if (exterior) {
    // gate bridge over the moat
    bridge(B, phys, { x: 0, z: 111.5, ry: 0, len: 17, w: 8, deckY: 0.05, archR: 3.5, baseY: -5, color: 0xd6cdb9 });
  }
}

// silhouettes of tall city landmarks for the exterior view
export function buildCitySkyline(B) {
  // temple roof on the northern terrace
  const T = mat4(0, 4.5, -72);
  B.box('marble', 0, 4.5 + 0.3 + 4, -72, 28, 8, 32, 0, 0xf2eee6);
  gableRoof(B, T, 30, 34, 8.6, { pitch: 0.5, axis: 'z', roofColor: 0x3f8a8a, gable: 0xf2eee6 });
  B.box('stone', 22, 4.5 + 13, -72, 6, 26, 6, 0, 0xddd5c3);
  hipRoof(B, mat4(22, 4.5 + 26, -72), 6.4, 6.4, 0, { h: 7, color: 0x3f8a8a });
  // rooftops just inside the south wall
  const rng = mulb(7);
  for (let i = 0; i < 18; i++) {
    const x = -95 + i * 11 + rng() * 3;
    if (Math.abs(x) < 16) continue;
    const z = 84 - rng() * 8;
    const h = 6 + rng() * 4;
    B.box('plaster', x, h / 2, z, 8, h, 7, 0, PAL.plaster[i % PAL.plaster.length]);
    gableRoof(B, mat4(x, 0, z), 8.4, 7.4, h, { pitch: 1, axis: i % 2 ? 'x' : 'z', roofColor: PAL.roof[i % 5], gable: PAL.plaster[i % PAL.plaster.length] });
  }
}
function mulb(seed) { let a = seed; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// the far ancient tower (visible from both zones)
export function buildFarTower(B) {
  const x = TOWER_FAR.x, z = TOWER_FAR.z, y0 = TOWER_FAR.y;
  const segs = [[26, 22, 60], [20, 16, 55], [15, 12, 50], [11, 8, 45], [7, 4, 35]];
  let y = y0;
  for (const [r0, r1, h] of segs) {
    B.add('farStone', cylGeo(r1, r0, h, 12), mat4(x, y + h / 2, z), 0xb8bcb0, { noCell: true });
    B.add('farStone', cylGeo(r0 * 1.12, r0 * 1.12, 3, 12), mat4(x, y + h - 1.5, z), 0xa6aa9e, { noCell: true });
    y += h;
  }
  B.add('farStone', new THREE.ConeGeometry(4, 22, 12), mat4(x, y + 11, z), 0xb8bcb0, { noCell: true });
  // floating rings
  B.add('farGold', new THREE.TorusGeometry(18, 1.2, 8, 40), mat4(x, y0 + 150, z, Math.PI / 2 - 0.2, 0, 0.1), 0xffffff, { noCell: true });
  B.add('farGold', new THREE.TorusGeometry(12, 0.9, 8, 40), mat4(x, y0 + 200, z, Math.PI / 2 + 0.25, 0, -0.1), 0xffffff, { noCell: true });
  return new THREE.Vector3(x, y + 22, z);
}
export { column };
