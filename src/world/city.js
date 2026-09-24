// 天鸣城 — the classical fantasy city hub.
import * as THREE from 'three';
import { Zone } from './zone.js';
import { Batcher, boxGeo, cylGeo, latheGeo, mat4, planeGeo, archRingGeo, prismGeo, mergeGroup } from './geom.js';
import { house, stall, bridge, stairs, roundTower, gableRoof, hipRoof, column, columnColliders, archway, PAL } from './kit.js';
import { lampPost, bench, barrel, crate, planter, stoneLantern, well, shimenawa, cart, boat } from './props.js';
import { buildCityShell, buildFarTower, CITY, wildsHeight, wildsColor, forestMask } from './shared.js';
import { Terrain, terrainMaterial, GrassField, InstancedKit, treeSet, placeTree, placeBush, trs } from './nature.js';
import { waterMaterial, riverStrip, waterDisc, waterfall } from '../gfx/water.js';
import { M, toonMat, glowMat, U } from '../gfx/materials.js';
import { getTex } from '../gfx/textures.js';
import { Spinner, Barrier, Door, Interactable, Chest, WindChime, Breakable, makeBrambles, runeTile, crystalObject, makeBeam, glowToon } from '../game/entities.js';
import { NPC } from '../game/npc.js';
import { Avatar } from '../game/avatar.js';
import { RNG, clamp, lerp, easeInOut } from '../core/util.js';
import { playHeld } from '../game/camera.js';

const CANAL = { z0: 27, z1: 33, bottom: -3.0, water: -0.95 };
const TEMPLE = { floor: 5.1, terrace: 4.5 };
const HOLE = { minX: -2.4, maxX: 2.4, minZ: -71.4, maxZ: -66.6 };
export const UC_RETURN = { pos: new THREE.Vector3(0, TEMPLE.floor, -64.4), yaw: 0 };

export const ENV_SUNSET = {
  zenith: 0x4a6fbf, fog: 0xf2c79a, fogSun: 0xffb070, ground: 0xb08a78, sunDir: [-0.55, 0.22, 0.8], sunColor: 0xffc48a, sunIntensity: 1.9,
  hemiSky: 0xc8b6e0, hemiGround: 0x9a7058, hemiIntensity: 1.6, cloudLit: 0xffe0c0, cloudShade: 0xc59aa8, sunDisk: 0xffc080, exposure: 1.02, sat: 1.15, bloom: 0.8,
};

function cityGround() {
  return {
    height(x, z) {
      if (z > CANAL.z0 && z < CANAL.z1 && x > -112 && x < 112) return CANAL.bottom;
      return 0;
    },
    normal(x, z, o) { return o.set(0, 1, 0); },
    water(x, z) {
      if (z > CANAL.z0 && z < CANAL.z1 && x > -112 && x < 112) return CANAL.water;
      return -Infinity;
    },
  };
}

export function buildCity(game) {
  const z = new Zone(game, 'city', {
    name: '天鸣城', subtitle: 'AMANE · 风之都', ground: cityGround(), surface: 'stone',
    bounds: { minX: -120, maxX: 120, minZ: -124, maxZ: 110 }, camMaxDist: 10, ambientWind: 0.35,
  });
  const P = z.physics;
  const B = new Batcher(P, { cell: 128 });
  const rng = new RNG(2024);
  z.titleFocus = new THREE.Vector3(0, 3, -6);
  z.marks = {};
  z.portalTo = {};
  z.poi = [];

  // -------------------------------------------------------------------------
  // ground: cobble everywhere, canal cut, paved plaza & main street
  const addGround = (x0, x1, z0, z1, mat = 'ground', y = 0, color = 0xffffff) => {
    const g = planeGeo(x1 - x0, z1 - z0).rotateX(-Math.PI / 2);
    const uv = g.attributes.uv, pos = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) + (x0 + x1) / 2, pos.getZ(i) + (z0 + z1) / 2);
    B.add(mat, g, mat4((x0 + x1) / 2, y, (z0 + z1) / 2), color, { noShadow: true });
  };
  for (let x0 = -112; x0 < 112; x0 += 32) {
    for (const [z0, z1] of [[-118, -86], [-86, -54], [-54, -22], [-22, 10], [10, CANAL.z0], [CANAL.z1, 66], [66, 102]]) addGround(x0, Math.min(112, x0 + 32), z0, z1);
  }
  // canal walls and bed
  B.box('stone', 0, (CANAL.bottom) / 2, CANAL.z0 + 0.2, 224, -CANAL.bottom, 0.4, 0, 0xcfc6b2);
  B.box('stone', 0, (CANAL.bottom) / 2, CANAL.z1 - 0.2, 224, -CANAL.bottom, 0.4, 0, 0xcfc6b2);
  B.box('mossStone', 0, CANAL.bottom - 0.05, 30, 224, 0.1, 6, 0, 0x9aa89a, { noShadow: true });
  for (const zz of [CANAL.z0 - 0.15, CANAL.z1 + 0.15]) B.box('stone', 0, 0.12, zz, 224, 0.24, 0.7, 0, 0xe4dccb);
  // swimmers: the canal walls are solid (tops flush with the promenade), and the water gates under
  // the east / west walls are closed off so the canal can't be used to slip out of the city
  for (const zz of [CANAL.z0 + 0.2, CANAL.z1 - 0.2]) P.addBox(0, CANAL.bottom / 2, zz, 112, -CANAL.bottom / 2, 0.2, 0, { blockCam: false });
  for (const s of [-1, 1]) P.addBox(s * CITY.maxX, (CANAL.bottom - 0.2) / 2, 30, 2.3, (0.2 - CANAL.bottom) / 2, 3.3, 0, { blockCam: false });
  const canalWater = waterMaterial({ shallow: 0x58b8c8, deep: 0x2a7f9e, flow: 0.25, streak: 0.5, constDepth: 2.0, edgeFoam: 0.6, width: 6, wave: 0.6 });
  z.add(riverStrip([[-112, 30, CANAL.water, 6], [112, 30, CANAL.water, 6]], canalWater, { segLen: 8 }));
  // bridges over the canal
  bridge(B, P, { x: 0, z: 30, len: 10, w: 11, deckY: 0.38, archR: 2.6, baseY: CANAL.bottom, color: 0xdcd3c0 });
  bridge(B, P, { x: -60, z: 30, len: 10, w: 5, deckY: 0.38, archR: 2.6, baseY: CANAL.bottom, color: 0xd6cdb9 });
  bridge(B, P, { x: 60, z: 30, len: 10, w: 5, deckY: 0.38, archR: 2.6, baseY: CANAL.bottom, color: 0xd6cdb9 });
  boat(B, -30, CANAL.water + 0.05, 29.2, Math.PI / 2 + 0.05);
  boat(B, 42, CANAL.water + 0.05, 31, Math.PI / 2 - 0.08);

  // plaza paving (radial) & paved streets
  {
    const g = new THREE.CircleGeometry(24, 48).rotateX(-Math.PI / 2);
    const uv = g.attributes.uv, pos = g.attributes.position;
    for (let i = 0; i < uv.count; i++) { const x = pos.getX(i), zz = pos.getZ(i); const r = Math.hypot(x, zz); const a = Math.atan2(zz, x); uv.setXY(i, a * 7.5, r * 0.9); }
    B.add('flag', g, mat4(0, 0.02, 0), 0xf2ece0, { noShadow: true });
    const ring = new THREE.RingGeometry(23.4, 24.2, 48).rotateX(-Math.PI / 2);
    B.add('stone', ring, mat4(0, 0.035, 0), 0xcfc4ae, { noShadow: true });
  }
  addGround(-6, 6, 35, 96, 'flag', 0.02, 0xf0e8d8);
  addGround(-8.5, 8.5, -31, -23, 'flag', 0.02, 0xf0e8d8);
  addGround(-112, 112, 22.3, 26.6, 'flag', 0.015, 0xe8e0d0);
  addGround(-112, 112, 33.4, 37.5, 'flag', 0.015, 0xe8e0d0);

  // -------------------------------------------------------------------------
  buildCityShell(B, P, { exterior: false });
  // invisible wall just outside the gate (the wilds zone takes over there)
  P.addBox(0, 5, 104.6, 6, 5, 0.3, 0, { blockCam: false });

  const lanternSpots = [];
  // -------------------------------------------------------------------------
  // PLAZA: fountain, stele, benches, lamps, trees
  const fountain = buildFountain(z, B, P);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const r = 19.5;
    if (Math.abs(Math.sin(a)) < 0.3 && Math.cos(a) < 0) continue;
    bench(B, P, Math.cos(a) * r, Math.sin(a) * r, -a - Math.PI / 2);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    lanternSpots.push(lampPost(B, P, Math.cos(a) * 22.5, Math.sin(a) * 22.5, -a));
  }
  for (const [x, zz] of [[-14, -14], [14, -14], [-15, 13], [15, 13]]) planter(B, P, x, zz, 3.2, 3.2, 0, 0, x * 7 + zz);

  // Wind Stele
  const stele = buildStele(z, game);
  // practice wind vanes around the stele
  const vanes = [];
  for (const [x, zz] of [[-6.5, -12], [6.5, -12]]) vanes.push(makeVane(z, game, x, zz, 0));

  // -------------------------------------------------------------------------
  // MAIN STREET: market stalls, bunting, lamps
  const awnings = ['awningRed', 'awningBlue', 'awningGreen', 'awningGold'];
  const goods = ['fruit', 'pottery', 'cloth'];
  for (let i = 0; i < 6; i++) {
    const zz = 47 + i * 7.2;
    stall(B, P, { x: -8.8, z: zz, ry: Math.PI / 2, awning: awnings[i % 4], goods: goods[i % 3], seed: i + 1 });
    stall(B, P, { x: 8.8, z: zz + 3.5, ry: -Math.PI / 2, awning: awnings[(i + 2) % 4], goods: goods[(i + 1) % 3], seed: i + 11 });
    if (i % 2 === 0) { barrel(B, P, -10.8, zz + 2.2); crate(B, P, 10.9, zz + 0.4, 0.3, 0.8); }
  }
  for (let zz = 40; zz <= 92; zz += 13) { lanternSpots.push(lampPost(B, P, -6.4, zz, Math.PI)); lanternSpots.push(lampPost(B, P, 6.4, zz + 6, 0)); }
  const bunting = [];
  for (const zz of [52, 66, 80]) bunting.push(makeBunting(z, new THREE.Vector3(-12, 7.2, zz), new THREE.Vector3(12, 7.2, zz + 1)));
  bunting.push(makeBunting(z, new THREE.Vector3(-6, 6.5, 38), new THREE.Vector3(6, 6.5, 38)));
  cart(B, P, 12.5, 43, 0.4);
  well(B, P, -18, 44);
  // canal promenade lamps
  for (let x = -96; x <= 96; x += 24) { if (Math.abs(x) < 10) continue; lanternSpots.push(lampPost(B, P, x, 25.8, Math.PI / 2)); }

  // -------------------------------------------------------------------------
  // TEMPLE TERRACE
  const temple = buildTemple(z, B, P, game);
  // -------------------------------------------------------------------------
  // WIND TOWERS (sails restart at the end)
  const towerW = buildWindTower(z, B, P, -64, -38, 5.5, 24, 8);
  const towerE = buildWindTower(z, B, P, 66, -50, 5, 22, 7.5);
  z.windTowers = [towerW, towerE];

  // -------------------------------------------------------------------------
  // HOUSES in rows (front faces the street)
  let hid = 1;
  const row = (facing, front, a0, a1, opts = {}) => {
    let a = a0;
    while (a < a1 - 5) {
      const w = rng.range(7, 10);
      if (a + w > a1) break;
      const skip = opts.skip && opts.skip.some(([s0, s1]) => a + w > s0 && a < s1);
      if (skip) { a += 3; continue; }
      const d = rng.range(6.5, 8);
      const c = a + w / 2;
      let x, zz, ry;
      if (facing === 'n') { x = c; zz = front + d / 2; ry = Math.PI; }
      else if (facing === 's') { x = c; zz = front - d / 2; ry = 0; }
      else if (facing === 'e') { zz = c; x = front - d / 2; ry = Math.PI / 2; }
      else { zz = c; x = front + d / 2; ry = -Math.PI / 2; }
      const floors = opts.floors ? opts.floors : rng.chance(0.35) ? 3 : 2;
      house(B, P, { x, z: zz, ry, w: facing === 'e' || facing === 'w' ? w : w, d, floors, seed: 100 + hid++, balcony: !opts.lite && rng.chance(0.3), lite: !!opts.lite, roofAxis: rng.chance(0.5) ? 'x' : 'z' });
      a += w + rng.range(0.2, 1.4);
    }
  };
  row('n', 39, -98, -15, { skip: [[-65, -55]] });
  row('n', 39, 15, 98, { skip: [[55, 65]] });
  row('e', -14.8, 50, 92);
  row('w', 14.8, 50, 92);
  row('n', 60, -98, -30, {});
  row('n', 60, 30, 70, {});
  row('s', 90, -98, -30, { lite: true });
  row('s', 90, 30, 70, { lite: true });
  row('s', 21, -98, -30, {});
  row('s', 21, 30, 98, {});
  row('e', -29, -16, 12, { floors: 3 });
  row('w', 29, -16, 12, { floors: 3 });
  row('n', -17, -98, -40, { lite: true });
  row('n', -17, 40, 98, { lite: true });
  row('s', -27, -98, -40, { skip: [[-75, -52]], lite: true });
  row('s', -27, 40, 98, { lite: true });
  row('n', -62, -98, -40, { lite: true });
  row('n', -62, 40, 98, { skip: [[57, 75]], lite: true });
  row('s', -90, -98, -40, { lite: true });
  row('s', -90, 40, 98, { lite: true });
  // archways over side streets
  archway(B, P, { x: -60, z: 39.5, w: 9, h: 7, aw: 4.4, ah: 5, roof: 0x3f8a8a });
  archway(B, P, { x: 60, z: 39.5, w: 9, h: 7, aw: 4.4, ah: 5, roof: 0x3f8a8a });

  // the old granary with ivy (climbable) and a rooftop secret
  const granary = buildGranary(z, B, P, game, 82, 76);

  // pots to smash
  for (const [x, zz] of [[-12, 42], [-12.8, 41.2], [12.8, 58], [-40, 23.5], [45, 24], [-3.5, 93.5], [4, 93]]) {
    z.breakables.push(z.addEntity(new Breakable(game, { pos: new THREE.Vector3(x, 0, zz), physics: P, drop: 0.3 })));
  }

  // -------------------------------------------------------------------------
  // GATE mechanism (brambled wind wheel + portcullis)
  const gate = buildGate(z, B, P, game);

  // -------------------------------------------------------------------------
  // NATURE: trees, bushes, grass beds
  const kit = new InstancedKit(z.scene, { chunk: 1000 });
  const T = treeSet(500);
  const treeAt = (type, x, zz, y = 0, s = null) => {
    const models = T[type];
    const m = models[Math.floor(rng.next() * models.length)];
    placeTree(kit, m, x, y, zz, rng.range(0, 6.28), s || rng.range(0.75, 1.0), P);
    grassSpots.push([x, zz, 3.2]);
  };
  const grassSpots = [];
  for (const [x, zz] of [[-12, -18], [12, -18], [-18, 10], [18, 10]]) treeAt('sakura', x, zz, 0, 0.85);
  for (let x = -100; x <= 100; x += 17) { if (Math.abs(x) < 12 || Math.abs(Math.abs(x) - 60) < 5) continue; treeAt(rng.chance(0.3) ? 'sakura' : 'round', x + rng.range(-2, 2), 23.8, 0, 0.7); }
  for (const [x, zz] of [[-40, 0], [-55, 5], [-70, -2], [-85, 6], [45, 2], [60, -4], [78, 5], [92, -2], [-92, 76], [-70, 94], [-45, 94], [45, 94], [70, 94], [92, 94], [-100, 40], [100, 44], [-100, -40], [100, -60], [-50, -76], [50, -76], [-100, -104], [100, -104], [-80, -104], [80, -104], [-60, -45], [72, -40]]) {
    treeAt(rng.chance(0.25) ? 'conifer' : rng.chance(0.3) ? 'golden' : 'round', x, zz);
  }
  // temple garden trees on the terrace
  for (const [x, zz] of [[-26, -46], [26, -46], [-26, -64], [-26, -86], [26, -92], [-18, -92]]) treeAt(rng.chance(0.5) ? 'sakura' : 'conifer', x, zz, TEMPLE.terrace, 0.85);
  for (let i = 0; i < 26; i++) {
    const a = rng.range(0, Math.PI * 2);
    const models = T.bush;
    const x = rng.range(-100, 100), zz = rng.range(-110, 95);
    if (Math.abs(x) < 34 && zz > -100 && zz < 98) continue;
    placeBush(kit, P, models[i % models.length].leaves, x, 0, zz, { y: 0, ry: a, s: rng.range(0.8, 1.2) });
    grassSpots.push([x, zz, 2]);
  }
  kit.build();
  // grass beds inside the walls
  const gardens = [[-30, 30, -96, -41, TEMPLE.terrace], [-108, -95, -112, 94, 0], [95, 108, -112, 94, 0], [-95, 95, 94, 97.5, 0], [-95, 95, -112, -104, 0]];
  const grassMask = (x, zz) => {
    for (const [cx, cz, r] of grassSpots) { const d = Math.hypot(x - cx, zz - cz); if (d < r) return 1 - d / r * 0.6; }
    for (const g of gardens) if (x > g[0] && x < g[1] && zz > g[2] && zz < g[3]) {
      if (g[4] > 0) { if (Math.abs(x) < 16.5 && zz < -52) return 0; if (Math.abs(x) < 9 && zz > -44) return 0; if (Math.abs(x - 23) < 4.5 && Math.abs(zz + 82) < 4.5) return 0; return 0.8; }
      return 0.7;
    }
    return 0;
  };
  const grassH = (x, zz) => (x > -32 && x < 32 && zz > -96 && zz < -40 ? TEMPLE.terrace : 0);
  z.grass = new GrassField(z.scene, { height: grassH, mask: grassMask, density: 5, chunk: 20, dist: game.engine.q.grassDist, seed: 77, heightScale: 0.8 });
  z.grass.setQuality(game.engine.q);
  z.setGrassQuality = (q) => z.grass.setQuality(q);

  // -------------------------------------------------------------------------
  // WILDS PROXY beyond the walls (low-res terrain, trees, far tower)
  buildProxy(z, rng);

  // wind chimes on plaza lamps
  z.chimes = [];
  for (const p of lanternSpots.slice(0, 8)) z.chimes.push(z.addEntity(new WindChime(game, { pos: p.clone().setY(p.y - 0.05), color: PAL.shutter[z.chimes.length % 6] | 0x404040 })));

  B.build(z.scene);

  // -------------------------------------------------------------------------
  // NPCs
  const npcs = buildNPCs(z, game);

  // -------------------------------------------------------------------------
  // triggers & portals
  z.addTrigger({
    minX: -3.6, maxX: 3.6, minZ: 101.2, maxZ: 104.5,
    onEnter: () => {
      if (!game.state.flags.gateOpen) return;
      const p = game.player.pos;
      game.travel('wilds', new THREE.Vector3(p.x, 0.05, 106.5), 0);
    },
  });
  z.addTrigger({
    minX: HOLE.minX, maxX: HOLE.maxX, minZ: HOLE.minZ, maxZ: HOLE.maxZ, maxY: TEMPLE.floor - 0.3,
    onEnter: () => {
      if (!game.state.flags.templeOpen) return;
      game.travel('undercroft', game.zones.undercroft.spawns.start.pos, game.zones.undercroft.spawns.start.yaw, { color: '#000' });
    },
  });
  z.portalTo.wilds = new THREE.Vector3(0, 0, 99);
  z.portalTo.undercroft = new THREE.Vector3(0, TEMPLE.floor, -69);
  z.spawns.start = { pos: new THREE.Vector3(0, 0, 17), yaw: Math.PI };
  z.spawns.fromWilds = { pos: new THREE.Vector3(0, 0, 94), yaw: Math.PI };
  z.checkpoint = () => {
    const f = game.state.flags;
    if (game.player.pos.z > 60) return { pos: new THREE.Vector3(0, 0, 88), yaw: Math.PI };
    if (f.templeOpen && game.player.pos.z < -40) return { pos: UC_RETURN.pos.clone(), yaw: 0 };
    return z.spawns.start;
  };
  z.marks.stele = new THREE.Vector3(0, 0, -13);
  z.marks.gateWheel = gate.wheelPos.clone().setY(gate.wheelPos.y - 1.5);
  z.marks.altar = new THREE.Vector3(0, TEMPLE.floor, -77);
  z.marks.miko = () => npcs.miko.pos;
  z.marks.mikoTemple = () => npcs.miko.pos;
  z.marks.guard = () => npcs.guard.pos;
  z.poi.push({ x: 0, z: 100, color: '#f3e9d2', shape: 'diamond', r: 5 });
  z.nearWater = (p) => {
    let w = 0;
    const dz = p.z < CANAL.z0 ? CANAL.z0 - p.z : p.z > CANAL.z1 ? p.z - CANAL.z1 : 0;
    w = Math.max(w, 1 - dz / 14);
    if (game.state.flags.coreActive) w = Math.max(w, 1 - Math.hypot(p.x, p.z) / 18);
    return w;
  };

  // -------------------------------------------------------------------------
  // animation hooks
  const lanternMat = M('lantern');
  z.animated.push((dt, t) => {
    const f = game.state.flags;
    const target = f.coreActive ? 2.6 : f.cityChanged ? 1.6 : 0.25;
    lanternMat.emissiveIntensity = lerp(lanternMat.emissiveIntensity, target, 1 - Math.exp(-1.5 * dt));
    for (const b of bunting) b.rotation.x = Math.sin(t * 1.3 + b.position.z) * 0.08;
    const p = game.player.pos;
    z.grass.update(dt, game.mode === 'title' ? z.titleFocus : p);
    if (f.coreActive && Math.random() < dt * 3) game.fx.petals(new THREE.Vector3(p.x + (Math.random() - 0.5) * 20, p.y + 6, p.z + (Math.random() - 0.5) * 20), new THREE.Vector3(U.uWind.value.x, 0, U.uWind.value.y), 2);
  });

  // -------------------------------------------------------------------------
  // state application (load / continue / ending)
  z.applyState = (s) => {
    const f = s.flags;
    gate.brambles.dispelled = false;
    if (f.gateBrambles || f.gateOpen) gate.brambles.dispel(true);
    gate.wheel.setActive(!!f.gateOpen, true);
    if (f.gateOpen) gate.wheel.speed = gate.wheel.maxSpeed;
    gate.door.setOpen(!!f.gateOpen, true);
    temple.setBarrier(!f.cityChanged, true);
    temple.setSeal(!!f.templeOpen, true);
    stele.setAwake(!!f.hasRune);
    fountain.setActive(!!f.coreActive, true);
    for (const t of z.windTowers) t.spinner.setActive(!!f.coreActive, true);
    temple.setCore(!!f.coreActive);
    if (granary.chest) { if (f.towerChest) granary.chest.setOpened(); }
    npcs.place(s);
  };
  z.onEnter = () => {
    const f = game.state.flags;
    z.grass.update(0, game.player.pos, true);
    if (f.crystalTaken && !f.cityChanged && game.mode === 'play') game.after(0.9, () => cityWakes(z, game, temple, npcs));
  };
  z.intro = () => introScene(z, game);
  z.ending = { fountain, temple, towers: z.windTowers, npcs };
  z.playEnding = (done) => cityEnding(z, game, done);
  z.npcsRef = npcs;
  z.gate = gate;
  z.temple = temple;
  z.stele = stele;
  return z;
}

// ---------------------------------------------------------------------------
function buildFountain(z, B, P) {
  const R = 5.4, H = 0.72;
  const stoneC = 0xe2dac8;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const len = 2 * R * Math.tan(Math.PI / 8) + 0.02;
    const x = Math.cos(a) * R, zz = Math.sin(a) * R;
    B.box('stone', x, H / 2, zz, 0.55, H, len, -a, stoneC, { collide: true });
    B.box('marble', Math.cos(a) * (R + 0.05), H + 0.07, Math.sin(a) * (R + 0.05), 0.85, 0.14, len + 0.35, -a, 0xf2ede2);
  }
  B.add('mossStone', new THREE.CircleGeometry(R, 24).rotateX(-Math.PI / 2), mat4(0, 0.12, 0), 0xb8b8a8, { noShadow: true });
  // central tiers
  const prof = [[0.001, 0], [1.4, 0], [1.35, 0.9], [0.55, 1.1], [0.5, 2.1], [1.2, 2.25], [2.3, 2.55], [2.35, 2.75], [2.1, 2.72], [0.4, 2.6], [0.35, 3.55], [0.9, 3.65], [1.25, 3.95], [1.2, 4.05], [0.3, 4.0], [0.25, 4.2], [0.001, 4.2]];
  B.add('marble', latheGeo(prof, 24), mat4(0, 0.1, 0), 0xf0ebe0);
  P.addCyl(0, 0, 1.45, 0, 4.3);
  // keep the camera out of the upper basins and the ring of falling water around them
  P.addCyl(0, 0, 2.8, 0.5, 4.4, { camOnly: true });
  // goddess statue on top
  const statue = new Avatar({ statue: true, hairStyle: 'long', outfit: 'robe', sleeves: 'wide', skirt: 0, bust: 0.5, build: 0.95, stoneColor: 0xe8e2d6 });
  statue.animate(0.016, { mode: 'idle' });
  statue.root.position.set(0, 4.28, 0);
  statue.root.scale.setScalar(1.05);
  statue.root.rotation.y = Math.PI;
  z.add(statue.root);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), toonMat({ color: 0x9ff5e8, emissive: 0x6fe8d8, emissiveIntensity: 0.2, rim: 1 }));
  orb.position.set(0.23, 6.95, 0.05);
  z.add(orb);
  // water surfaces (hidden until active)
  const wm = waterMaterial({ shallow: 0x7fd8e0, deep: 0x3aa0c0, constDepth: 0.6, streak: 0.4, wave: 0.8 });
  const w1 = waterDisc(0, 0.55, 0, R - 0.25, wm, 32);
  const w2 = waterDisc(0, 2.62, 0, 2.1, wm, 24);
  const w3 = waterDisc(0, 3.88, 0, 1.1, wm, 16);
  const falls = [];
  const fallMat = waterfall([[0, 0, 0], [0, 1, 0]], 1).material;
  for (const [r, y0, y1] of [[2.32, 2.72, 0.6], [1.22, 3.98, 2.65]]) {
    const g = new THREE.CylinderGeometry(r + 0.05, r + 0.35, y0 - y1, 24, 1, true);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * (y0 - y1));
    const m = fallMat;
    const cyl = new THREE.Mesh(g, m);
    cyl.position.y = (y0 + y1) / 2;
    cyl.renderOrder = 6;
    falls.push(cyl);
  }
  const group = new THREE.Group();
  group.add(w1, w2, w3, ...falls);
  z.add(group);
  let active = false, k = 0;
  const api = {
    group, orb,
    setActive(v, instant = false) { active = v; if (instant) k = v ? 1 : 0; group.visible = k > 0.01 || v; },
  };
  z.animated.push((dt, t) => {
    k = lerp(k, active ? 1 : 0, 1 - Math.exp(-0.8 * dt));
    group.visible = k > 0.02;
    w1.position.y = 0.12 + 0.43 * k;
    for (const f of falls) f.scale.set(1, Math.max(0.01, k), 1);
    orb.material.emissiveIntensity = 0.2 + k * 2.5;
    if (active && k > 0.5) {
      const fx = z.game.fx;
      if (Math.random() < dt * 30) {
        const a = Math.random() * Math.PI * 2;
        fx.normal.emit({ pos: { x: 0.23, y: 7.1, z: 0.05 }, vel: { x: Math.cos(a) * 1.2, y: 5 + Math.random() * 1.5, z: Math.sin(a) * 1.2 }, life: 1.1, size: 0.16, size2: 0.08, color: new THREE.Color(0xeefcff), alpha: 0.85, frame: 7, gravity: 9.8 });
      }
      if (Math.random() < dt * 12) {
        const a = Math.random() * Math.PI * 2;
        fx.normal.emit({ pos: { x: Math.cos(a) * 2.45, y: 0.6, z: Math.sin(a) * 2.45 }, vel: { x: Math.cos(a) * 0.8, y: 1.2, z: Math.sin(a) * 0.8 }, life: 0.5, size: 0.3, size2: 0.6, color: new THREE.Color(0xffffff), alpha: 0.5, frame: 4, drag: 2 });
      }
    }
    void t;
  });
  return api;
}

// ---------------------------------------------------------------------------
function buildStele(z, game) {
  const g = new THREE.Group();
  g.position.set(0, 0, -13);
  const stone = toonMat({ color: 0xc9cfc6, map: getTex('ruin'), rim: 0.35, moss: [0.45, 0.62, 0.3, 0.45], emissive: 0x7fe8d8, emissiveIntensity: 0 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.7, 0.5, 8), toonMat({ color: 0xd8d0bf, map: getTex('stoneWall'), rim: 0.2 }));
  base.position.y = 0.25; base.receiveShadow = true; base.castShadow = true;
  g.add(base);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3.2, 0.62), stone);
  body.position.y = 2.1; body.castShadow = true;
  g.add(body);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.62, 16, 1, false, 0, Math.PI), stone);
  top.rotation.set(Math.PI / 2, 0, Math.PI / 2); top.position.y = 3.7; top.castShadow = true;
  g.add(top);
  const glyphs = [];
  for (const s of [-1, 1]) {
    const r = runeTile(3, 0x7fe8d8, 2.4, 1.05);
    r.position.set(0, 2.6, s * 0.32); r.rotation.y = s > 0 ? 0 : Math.PI;
    r.material.opacity = 0.25;
    g.add(r); glyphs.push(r);
    const r2 = runeTile(10, 0x7fe8d8, 2.0, 0.9);
    r2.position.set(0, 1.35, s * 0.32); r2.rotation.y = s > 0 ? 0 : Math.PI;
    r2.material.opacity = 0.2;
    g.add(r2); glyphs.push(r2);
  }
  // orbiting rune stones
  const orbit = new THREE.Group();
  orbit.position.y = 2.4;
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), toonMat({ color: 0xbff8ee, emissive: 0x6fe8d8, emissiveIntensity: 0.8, rim: 0.8 }));
    s.position.set(Math.cos(i * 2.09) * 1.5, 0, Math.sin(i * 2.09) * 1.5);
    orbit.add(s);
  }
  g.add(orbit);
  z.add(g);
  z.physics.addCyl(0, -13, 2.5, 0, 0.5);
  z.physics.addBox(0, 2.1, -13, 0.8, 2.0, 0.35, 0);
  let awake = false, t = 0;
  const api = { group: g, setAwake(v) { awake = v; } };
  z.animated.push((dt) => {
    t += dt;
    const k = awake ? 1 : 0.25 + Math.sin(t * 2) * 0.1;
    for (const r of glyphs) r.material.opacity = lerp(r.material.opacity, k, 1 - Math.exp(-3 * dt));
    orbit.rotation.y += dt * (awake ? 0.8 : 0.25);
    orbit.position.y = 2.4 + Math.sin(t * 1.3) * 0.15;
  });
  const it = new Interactable(game, {
    id: 'stele', pos: new THREE.Vector3(0, 0, -11.9), radius: 3.2,
    prompt: () => (game.state.flags.hasRune ? '风之石碑' : '触碰风之石碑'),
    act: (g2) => {
      const f = g2.state.flags;
      if (f.hasRune) { g2.talk([{ name: '风之石碑', text: '石碑静静地散发着微光。风在你身边轻轻回旋。' }]); return; }
      steleSequence(z, g2, api);
    },
  });
  z.addEntity(it);
  return api;
}

function steleSequence(z, game, stele) {
  const p = game.player.pos;
  const f = game.state.flags;
  game.player.facing = Math.PI;
  game.audio.sfx('reveal');
  const center = new THREE.Vector3(0, 2.2, -13);
  game.cutscene([
    { pos: [5, 3, -5], pos2: [3.5, 2.6, -7], look: [0, 2.2, -12], look2: [0, 2.2, -12], dur: 2.2, onStart: () => { stele.setAwake(true); game.fx.ring(new THREE.Vector3(0, 0.55, -13), 0x9ff5e8, 0.5, 6, 1.2, 0.9); } },
    {
      pos: [3.5, 2.6, -7], pos2: [p.x + 3.2, p.y + 2.2, p.z + 3.6], look: [0, 2.2, -12], look2: [p.x, p.y + 1.3, p.z], dur: 2.0,
      onStart: () => {
        for (let i = 0; i < 10; i++) game.after(i * 0.12, () => {
          const a = i * 0.9;
          const o = new THREE.Vector3(center.x + Math.cos(a) * 3, center.y + (Math.random() - 0.5) * 2, center.z + Math.sin(a) * 3);
          game.fx.windLines.add({ origin: o, dir: new THREE.Vector3(p.x, p.y + 1.2, p.z).sub(o), len: o.distanceTo(p) + 1, dur: 0.8, width: 0.08, swirl: 1.2, radius: 0.6, phase: a, alpha: 0.9, trail: 0.5 });
        });
        game.after(1.2, () => { game.fx.sparkle(p.clone().setY(p.y + 1.2), 0xbff8ee, 40, 1.2, 2); game.audio.sfx('activate'); game.cam.shake(0.3); });
      },
    },
  ], () => {
    f.hasRune = true;
    game.itemGet({ icon: 'rune', name: '风之符文', desc: '古代风之民留下的符文之力。<br>按 <b>鼠标右键 / F</b> 释放风压（会自动瞄准附近目标）。<br>转动风车 · 推动石块 · 驱散瘴雾与荆棘<br>击退敌人 · 显现隐藏的符文' }, () => {
      if (game.state.stage === 'talk_miko' || game.state.stage === 'touch_stele') game.quest.set('go_gate');
      game.hud.toast('试着对石碑两侧的风向标使用风之符文吧', 3.2);
    });
  });
}

// small practice wind vane (pinwheel on a post)
function makeVane(z, game, x, zz, y) {
  const g = new THREE.Group();
  g.position.set(x, y, zz);
  const wood = toonMat({ color: 0x8a5e3c, rim: 0.2 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 8), wood);
  post.position.y = 1.3; post.castShadow = true;
  g.add(post);
  const rotor = new THREE.Group();
  rotor.position.set(0, 2.6, 0.12);
  const cols = [0xe8453a, 0xf5d547, 0x4fa8e0, 0x8cc84b];
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.1, 0.55, 0), new THREE.Vector3(-0.35, 0.5, 0.08)]), toonMat({ color: cols[i], side: THREE.DoubleSide, rim: 0.3 }));
    blade.geometry.computeVertexNormals();
    blade.rotation.z = (i * Math.PI) / 2;
    rotor.add(blade);
  }
  rotor.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), M('gold')));
  mergeGroup(rotor);
  g.add(rotor);
  z.add(g);
  z.physics.addCyl(x, zz, 0.15, y, y + 2.6);
  let spoke = false;
  const sp = new Spinner(game, {
    id: 'vane', object: g, rotor, axis: 'z', pos: new THREE.Vector3(x, y + 2.6, zz), radius: 0.8, maxSpeed: 22, impulse: 20, decay: 3, threshold: 8, idle: 0.3, aimWeight: 0.9,
    onActivate: () => {
      game.audio.sfx('chime');
      if (!spoke) { spoke = true; game.hud.toast('风车转起来了！风之符文可以驱动这样的机关', 3); }
    },
  });
  sp.sfx = true;
  z.addEntity(sp);
  return sp;
}

// ---------------------------------------------------------------------------
function makeBunting(z, a, b) {
  const g = new THREE.Group();
  const mid = a.clone().lerp(b, 0.5); mid.y -= 0.8;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const line = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.02, 4, false), toonMat({ color: 0x5a4a3a }));
  g.add(line);
  const cols = [0xe8453a, 0xf5d547, 0x4fa8e0, 0x8cc84b, 0xf07aa0, 0xffffff];
  const n = Math.floor(a.distanceTo(b) / 0.8);
  const tri = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.22, 0, 0), new THREE.Vector3(0.22, 0, 0), new THREE.Vector3(0, -0.45, 0)]);
  tri.computeVertexNormals();
  const mats = cols.map((c) => toonMat({ color: c, side: THREE.DoubleSide, rim: 0.2, outline: false }));
  for (let i = 1; i < n; i++) {
    const p = curve.getPoint(i / n);
    const m = new THREE.Mesh(tri, mats[i % mats.length]);
    m.position.copy(p);
    m.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) - Math.PI / 2;
    g.add(m);
  }
  mergeGroup(g);
  z.add(g);
  return g;
}

// ---------------------------------------------------------------------------
function buildTemple(z, B, P, game) {
  const TY = TEMPLE.terrace, FY = TEMPLE.floor;
  const stoneC = 0xe0d8c6, marbleC = 0xf4f0e8;
  // terrace volume & top
  B.box('stone', 0, TY / 2, -68, 64, TY, 56, 0, stoneC, { ao: 3 });
  B.box('flag', 0, TY + 0.01, -68, 63.6, 0.04, 55.6, 0, 0xf0e8d8, { noShadow: true });
  P.addBox(0, TY / 2, -68, 32, TY / 2, 28);
  stairs(B, P, { x: 0, z: -31, ry: 0, y0: 0, w: 16, steps: 18, rise: 0.25, run: 0.5, color: 0xe6dfcf });
  // balustrade along the front edge & sides
  const rail = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2;
    B.box('marble', (x0 + x1) / 2, TY + 0.55, (z0 + z1) / 2, len, 0.12, 0.4, ry, marbleC);
    B.box('marble', (x0 + x1) / 2, TY + 0.06, (z0 + z1) / 2, len, 0.12, 0.45, ry, marbleC);
    const n = Math.floor(len / 0.7);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      B.cyl('marble', lerp(x0, x1, t), TY + 0.3, lerp(z0, z1, t), 0.09, 0.12, 0.5, 6, marbleC);
    }
    P.addBox((x0 + x1) / 2, TY + 0.6, (z0 + z1) / 2, len / 2, 0.6, 0.25, ry, { walkable: false, blockCam: false });
  };
  rail(-31.7, -40.3, -8.3, -40.3); rail(8.3, -40.3, 31.7, -40.3);
  rail(-31.7, -40.3, -31.7, -95.7); rail(31.7, -40.3, 31.7, -95.7); rail(-31.7, -95.7, 31.7, -95.7);
  for (const x of [-8.6, 8.6]) { B.box('marble', x, TY + 0.7, -40.3, 0.8, 1.4, 0.8, 0, marbleC, { collide: true }); stoneLantern(B, P, x * 1.9, -43.5, TY, 1.1); }
  // stylobate with the hole for the undercroft
  B.box('marble', 0, TY + 0.3, -72, 30, 0.6, 34, 0, marbleC, { ao: 0.4 });
  B.box('marble', 0, TY + 0.15, -54, 30, 0.3, 2, 0, marbleC);
  P.addBox(0, TY + 0.15, -54, 15, 0.15, 1);
  const addFloor = (x0, x1, z0, z1) => P.addBox((x0 + x1) / 2, TY + 0.3, (z0 + z1) / 2, (x1 - x0) / 2, 0.3, (z1 - z0) / 2);
  addFloor(-15, 15, -89, HOLE.minZ); addFloor(-15, 15, HOLE.maxZ, -55); addFloor(-15, HOLE.minX, HOLE.minZ, HOLE.maxZ); addFloor(HOLE.maxX, 15, HOLE.minZ, HOLE.maxZ);
  const sealCol = P.addBox(0, TY + 0.3, (HOLE.minZ + HOLE.maxZ) / 2, (HOLE.maxX - HOLE.minX) / 2, 0.3, (HOLE.maxZ - HOLE.minZ) / 2);
  // columns
  const colXs = [-12.5, -7.5, -2.5, 2.5, 7.5, 12.5];
  for (const x of colXs) { column(B, x, FY, -57.2, { r: 0.5, h: 7.6, color: marbleC }); columnColliders(P, x, FY, -57.2, { r: 0.5, h: 7.6 }); }
  for (const s of [-1, 1]) for (const zz of [-62.6, -68, -73.4, -78.8]) { column(B, s * 13.2, FY, zz, { r: 0.5, h: 7.6, color: marbleC }); columnColliders(P, s * 13.2, FY, zz, { r: 0.5, h: 7.6 }); }
  // cella walls (back + partial sides)
  B.box('marble', 0, FY + 3.8, -87.5, 28, 7.6, 1.2, 0, 0xece6da, { collide: true, ao: 2 });
  for (const s of [-1, 1]) B.box('marble', s * 13.2, FY + 3.8, -84.2, 1, 7.6, 7.4, 0, 0xece6da, { collide: true, ao: 2 });
  // entablature
  B.box('marble', 0, FY + 8.1, -57.2, 28, 1.0, 1.4, 0, marbleC);
  B.box('marble', 0, FY + 8.1, -88, 28, 1.0, 1.4, 0, marbleC);
  for (const s of [-1, 1]) B.box('marble', s * 13.2, FY + 8.1, -72.6, 1.4, 1.0, 31.4, 0, marbleC);
  B.box('gold', 0, FY + 8.66, -72.6, 28.6, 0.12, 32, 0, 0xffffff);
  const RW = mat4(0, FY + 8.7, -72.6);
  gableRoof(B, RW, 30, 34, 0, { pitch: 0.42, axis: 'z', roofColor: 0x3f8a8a, gable: 0xf2eee6, overGable: 0.6, over: 1.0 });
  P.addBox(0, FY + 10.5, -72.6, 15, 2.6, 17, 0, { walkable: false });
  // pediment crest (glows when the core wakes)
  const crestMat = glowToon(0xd9ad4f, 0x9ff5e8, { rim: 0.8 });
  const crest = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.16, 10, 36), crestMat);
  crest.position.set(0, FY + 11.1, -55.4);
  z.add(crest);
  const crestRune = runeTile(3, 0x9ff5e8, 2.6, 2.4);
  crestRune.position.set(0, FY + 11.1, -55.35);
  crestRune.material.opacity = 0.0;
  z.add(crestRune);
  // statue of the wind goddess inside
  B.box('marble', 0, FY + 0.8, -84.3, 4, 1.6, 3, 0, 0xe6e0d4, { collide: true });
  const goddess = new Avatar({ statue: true, hairStyle: 'long', outfit: 'robe', sleeves: 'wide', skirt: 0, bust: 0.5, build: 0.95, stoneColor: 0xf0ece2 });
  goddess.animate(0.016, { mode: 'idle' });
  goddess.root.position.set(0, FY + 1.6, -84.3);
  goddess.root.scale.setScalar(2.1);
  z.add(goddess.root);
  P.addCyl(0, -84.3, 0.95, FY + 1.6, FY + 5.6, { walkable: false });
  // altar
  B.cyl('marble', 0, FY + 0.55, -77, 1.1, 1.3, 1.1, 16, 0xe8e2d6, { collide: true });
  B.cyl('gold', 0, FY + 1.14, -77, 0.9, 0.9, 0.08, 20, 0xffffff);
  const socket = runeTile(12, 0x9ff5e8, 2.5, 1.2);
  socket.rotation.x = -Math.PI / 2;
  socket.position.set(0, FY + 1.2, -77);
  socket.material.opacity = 0.2;
  z.add(socket);
  // floor seal halves
  const sealMat = toonMat({ color: 0xe8e2d6, map: getTex('marble'), rim: 0.2 });
  const halves = [];
  for (const s of [-1, 1]) {
    const hg = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 4.8), sealMat);
    m.position.x = s * 1.2; m.receiveShadow = true;
    hg.add(m);
    const r = runeTile(3, 0x7fe8d8, 2.0, 2.0);
    r.rotation.x = -Math.PI / 2; r.position.set(s * 1.2, 0.11, 0);
    r.material.opacity = 0.35;
    hg.add(r);
    hg.position.set(0, FY - 0.08, -69);
    z.add(hg);
    halves.push({ g: hg, s });
  }
  // stairwell shaft below the seal
  const shaftMat = toonMat({ color: 0x5a6068, rim: 0.1, map: getTex('ruin') });
  const shaft = new THREE.Group();
  for (const [x, zz, w, d] of [[0, HOLE.minZ - 0.2, 5.2, 0.4], [0, HOLE.maxZ + 0.2, 5.2, 0.4], [HOLE.minX - 0.2, -69, 0.4, 5.2], [HOLE.maxX + 0.2, -69, 0.4, 5.2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 5, d), shaftMat);
    m.position.set(x, FY - 2.5, zz);
    shaft.add(m);
  }
  for (let i = 0; i < 6; i++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.3, 0.8), shaftMat);
    st.position.set(0, FY - 0.6 - i * 0.55, HOLE.maxZ - 0.4 - i * 0.75);
    shaft.add(st);
  }
  const glowStrip = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.08, 0.08), glowMat(0x7fe8d8, 2.2));
  glowStrip.position.set(0, FY - 3.8, HOLE.minZ + 0.1);
  shaft.add(glowStrip);
  mergeGroup(shaft);
  shaft.visible = false;
  z.add(shaft);
  // rune barrier across the temple front
  const barrierMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uOpacity: { value: 1 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: `uniform float uTime; uniform float uOpacity; varying vec2 vUv; varying vec3 vW;
      float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
      void main(){
        vec2 g = vUv * vec2(28.0, 7.6);
        vec2 c = floor(g); vec2 f = fract(g);
        float r = h(c + floor(uTime*0.5));
        float glyph = step(0.6, r) * smoothstep(0.45, 0.35, length(f - 0.5)) * (0.5 + 0.5*sin(uTime*3.0 + c.x));
        float lines = smoothstep(0.03, 0.0, abs(fract(vUv.y * 7.6 - uTime * 0.3) - 0.5) - 0.46);
        float edge = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
        vec3 col = vec3(0.5, 1.0, 0.92) * (0.35 + glyph * 1.4 + lines * 0.5);
        gl_FragColor = vec4(col * 1.4, (0.18 + glyph * 0.5 + lines * 0.25) * edge * uOpacity);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const barrier = new THREE.Mesh(new THREE.PlaneGeometry(26.4, 7.6), barrierMat);
  barrier.position.set(0, FY + 3.8, -57.6);
  barrier.renderOrder = 12;
  z.add(barrier);
  const barrierCol = P.addBox(0, FY + 3.8, -57.6, 13.2, 3.8, 0.3, 0, { blockCam: false });
  // shimenawa between the two middle columns
  shimenawa(z, new THREE.Vector3(-2.5, FY + 6.4, -56.6), new THREE.Vector3(2.5, FY + 6.4, -56.6), 0.7, 0.16);
  // bell tower
  const bx = 23, bz = -82;
  B.box('stone', bx, TY + 8, bz, 6, 16, 6, 0, 0xddd5c3, { collide: true, ao: 4 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box('stone', bx + sx * 2.6, TY + 18, bz + sz * 2.6, 0.8, 4, 0.8, 0, 0xddd5c3);
  B.box('stone', bx, TY + 20.2, bz, 6.6, 0.5, 6.6, 0, 0xcfc6b2);
  hipRoof(B, mat4(bx, TY + 20.4, bz), 6.4, 6.4, 0, { h: 6, color: 0x3f8a8a, over: 0.3 });
  const bell = new THREE.Mesh(new THREE.LatheGeometry([[0.001, 1.3], [0.35, 1.25], [0.55, 0.9], [0.7, 0.2], [0.95, 0.0], [0.001, 0.0]].map((p) => new THREE.Vector2(p[0], p[1])), 18), toonMat({ color: 0xb8863a, rim: 0.7, rimColor: 0xffe0a0 }));
  bell.position.set(bx, TY + 17, bz);
  bell.castShadow = true;
  z.add(bell);
  // banners on the terrace front
  for (const x of [-20, 20]) {
    const bn = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.4), M('bannerTeal'));
    bn.position.set(x, TY - 1.6, -39.9);
    z.add(bn);
  }
  // core beam for the ending
  const beam = makeBeam(0x9ff5e8, 260, 2.2);
  beam.position.set(0, FY + 11, -72);
  beam.visible = false;
  z.add(beam);
  let barrierK = 1, sealK = 0, sealOpen = false, barrierOn = true, coreOn = false;
  const api = {
    beam, crest, socket,
    setBarrier(v, instant = false) { barrierOn = v; barrierCol.enabled = v; if (instant) { barrierK = v ? 1 : 0; barrier.visible = v; } },
    setSeal(v, instant = false) { sealOpen = v; sealCol.enabled = !v; shaft.visible = v || sealK > 0; if (instant) sealK = v ? 1 : 0; },
    setCore(v) { coreOn = v; beam.visible = v; },
  };
  z.animated.push((dt, t) => {
    barrierK = lerp(barrierK, barrierOn ? 1 : 0, 1 - Math.exp(-1.2 * dt));
    barrierMat.uniforms.uOpacity.value = barrierK;
    barrier.visible = barrierK > 0.01;
    sealK = clamp(sealK + (sealOpen ? dt / 2.5 : -dt), 0, 1);
    const e = easeInOut(sealK);
    for (const h of halves) { h.g.position.x = h.s * e * 2.6; h.g.position.y = FY - 0.08 - e * 0.18; }
    shaft.visible = sealK > 0.01;
    const f = game.state.flags;
    socket.material.opacity = lerp(socket.material.opacity, f.crystalTaken && !f.templeOpen ? 0.6 + Math.sin(t * 4) * 0.3 : f.coreActive ? 1 : 0.2, 1 - Math.exp(-3 * dt));
    crestMat.emissiveIntensity = lerp(crestMat.emissiveIntensity, coreOn ? 2.2 : 0, 1 - Math.exp(-dt));
    crestRune.material.opacity = lerp(crestRune.material.opacity, coreOn ? 1 : 0, 1 - Math.exp(-dt));
    if (coreOn) { beam.material.uniforms.uOpacity.value = 0.55 + Math.sin(t * 2) * 0.1; bell.rotation.z = Math.sin(t * 1.4) * 0.15; }
  });
  // altar interaction
  z.addEntity(new Interactable(game, {
    id: 'altar', pos: new THREE.Vector3(0, FY, -75.4), radius: 2.6,
    prompt: () => (game.state.flags.crystalTaken && !game.state.flags.templeOpen ? '将风之结晶献于祭坛' : '祭坛'),
    act: (g2) => {
      const f = g2.state.flags;
      if (f.crystalTaken && !f.templeOpen) { altarSequence(z, g2, api); return; }
      if (f.templeOpen) g2.talk([{ name: '', text: '祭坛上的风纹微微发光，指引着地下的道路。' }]);
      else g2.talk([{ name: '', text: '一座古老的祭坛。中央的凹槽似乎能放入什么东西……' }]);
    },
  }));
  return api;
}

function altarSequence(z, game, temple) {
  const FY = TEMPLE.floor;
  const cry = crystalObject(1.1);
  const p = game.player.pos;
  cry.position.set(p.x, p.y + 1.6, p.z);
  z.add(cry);
  let t = 0;
  const upd = (dt) => {
    t += dt;
    const k = Math.min(1, t / 1.6);
    cry.position.lerpVectors(new THREE.Vector3(p.x, p.y + 1.6, p.z), new THREE.Vector3(0, FY + 2.4, -77), easeInOut(k));
    cry.rotation.y += dt * 2;
    if (t > 5.8) { const kk = Math.min(1, (t - 5.8) / 1.2); cry.position.lerpVectors(new THREE.Vector3(0, FY + 2.4, -77), new THREE.Vector3(p.x, p.y + 1.6, p.z), easeInOut(kk)); cry.scale.setScalar(1 - kk * 0.9); }
  };
  z.animated.push(upd);
  game.cutscene([
    { pos: [4.5, FY + 2.6, -69], pos2: [3.5, FY + 3.2, -71], look: [0, FY + 1.8, -77], look2: [0, FY + 2.2, -77], dur: 2.4, onStart: () => game.audio.sfx('reveal') },
    { pos: [0, FY + 5.5, -60], pos2: [0, FY + 6.5, -62], look: [0, FY, -69], look2: [0, FY - 1, -69], dur: 3.2, onStart: () => { temple.setSeal(true); game.audio.sfx('rumble'); game.cam.shake(0.4); game.fx.sparkle(new THREE.Vector3(0, FY + 2.4, -77), 0xbff8ee, 40, 1, 3); game.fx.ring(new THREE.Vector3(0, FY + 0.1, -69), 0x9ff5e8, 0.5, 7, 1.4, 0.9); } },
    { pos: [0, FY + 6.5, -62], pos2: [p.x + 2, p.y + 2.5, p.z + 4], look: [0, FY - 1, -69], look2: [p.x, p.y + 1.4, p.z], dur: 1.6 },
  ], () => {
    const i = z.animated.indexOf(upd); if (i >= 0) z.animated.splice(i, 1);
    z.scene.remove(cry);
    game.state.flags.templeOpen = true;
    game.quest.set('undercroft');
    game.audio.sfx('solve');
    game.talk([{ name: '', text: '结晶的光芒流入地面，神殿地下的入口开启了。' }, { name: '', text: '（结晶回到了你的手中。它在指引你前往地下深处。）' }]);
  });
}

// ---------------------------------------------------------------------------
function buildWindTower(z, B, P, x, zz, r, h, sailR) {
  roundTower(B, P, { x, z: zz, r, h, roof: 0x4d6b95, stone: 0xe2dac8, windows: 3, crenel: false, roofH: r * 2.4 });
  // balcony ring
  B.add('wood', cylGeo(r + 1.1, r + 1.1, 0.25, 20), mat4(x, h - 3, zz), 0x7a5236);
  for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; B.box('wood', x + Math.cos(a) * (r + 1), h - 2.45, zz + Math.sin(a) * (r + 1), 0.08, 1, 0.08, 0, 0x6b4a33); }
  B.add('wood', new THREE.TorusGeometry(r + 1, 0.05, 4, 32), mat4(x, h - 1.95, zz, Math.PI / 2), 0x6b4a33);
  // sails on the south face
  const hub = new THREE.Group();
  hub.position.set(x, h - 4, zz + r + 0.4);
  const rotor = new THREE.Group();
  hub.add(rotor);
  const wood = toonMat({ color: 0x6b4a33, map: getTex('wood'), rim: 0.2 });
  const cloth = toonMat({ color: 0xf2ead6, side: THREE.DoubleSide, rim: 0.25, band: [-0.3, 0.3] });
  rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 1.2, 12).rotateX(Math.PI / 2), wood));
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2 + 0.4;
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.28, sailR, 0.28), wood);
    spar.position.y = sailR / 2;
    spar.castShadow = true;
    arm.add(spar);
    const sail = new THREE.Mesh(new THREE.BoxGeometry(1.9, sailR - 1.4, 0.05), cloth);
    sail.position.set(1.05, sailR / 2 + 0.6, 0.1);
    sail.castShadow = true;
    arm.add(sail);
    for (let k = 0; k < 5; k++) {
      const bat = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 0.1), wood);
      bat.position.set(1.0, 1.2 + k * (sailR - 1.6) / 4, 0.16);
      arm.add(bat);
    }
    rotor.add(arm);
  }
  mergeGroup(rotor);
  z.add(hub);
  const game = z.game;
  const sp = new Spinner(game, { id: 'tower', object: hub, rotor, axis: 'z', pos: hub.position.clone(), radius: sailR, maxSpeed: 0.9, impulse: 0, decay: 0.05, threshold: 99, latch: true, idle: 0, aimable: false, sfx: false });
  sp.aimable = false;
  sp.onWind = () => false;
  z.addEntity(sp);
  return { hub, rotor, spinner: sp };
}

// ---------------------------------------------------------------------------
function buildGate(z, B, P, game) {
  // portcullis
  const grid = new THREE.Group();
  const iron = toonMat({ color: 0x3a3a42, rim: 0.5, rimColor: 0xb0c0d0 });
  for (let i = 0; i <= 8; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 8.6, 0.16), iron); b.position.set(-3.4 + i * 0.85, 4.3, 0); b.castShadow = true; grid.add(b); }
  for (let j = 0; j < 6; j++) { const b = new THREE.Mesh(new THREE.BoxGeometry(7, 0.14, 0.14), iron); b.position.set(0, 0.8 + j * 1.5, 0.05); grid.add(b); }
  for (let i = 0; i <= 8; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 5), iron); s.position.set(-3.4 + i * 0.85, -0.12, 0); s.rotation.x = Math.PI; grid.add(s); }
  grid.position.set(0, 0, 99);
  mergeGroup(grid);
  z.add(grid);
  const doorCol = P.addBox(0, 4.3, 99, 3.6, 4.3, 0.3);
  const door = new Door(game, { id: 'portcullis', object: grid, colliders: [doorCol], mode: 'up', dist: 8.2, dur: 3.6 });
  z.addEntity(door);
  // wind wheel on the inner face of the east gate tower
  const wheelPos = new THREE.Vector3(8.5, 8.2, 95.0);
  const hub = new THREE.Group();
  hub.position.copy(wheelPos);
  const rotor = new THREE.Group();
  hub.add(rotor);
  const wood = toonMat({ color: 0x7a5236, map: getTex('wood'), rim: 0.25 });
  const bronze = glowToon(0xb8863a, 0x7fe8d8, { rim: 0.7, rimColor: 0xffe0a0 });
  rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.8, 16).rotateX(Math.PI / 2), bronze));
  for (let i = 0; i < 6; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 3;
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.1, 0.22), wood);
    spar.position.y = 1.65; arm.add(spar);
    const paddle = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.5, 0.08), wood);
    paddle.position.set(0.45, 2.4, 0); paddle.rotation.y = 0.5; arm.add(paddle);
    rotor.add(arm);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.15, 0.1, 6, 40), bronze);
  rotor.add(ring);
  mergeGroup(rotor);
  // gear box on the wall
  B.box('wood', 8.5, 8.2, 95.35, 2.2, 2.2, 0.5, 0, 0x6b4a33);
  B.box('metal', 8.5, 4.2, 95.4, 0.3, 6, 0.3, 0, 0x3a3a42, { collide: true, colOpts: { walkable: false, blockCam: false } });
  z.add(hub);
  // brambles
  const br = makeBrambles(new RNG(9), { w: 7, h: 11, d: 1.8, count: 22 });
  br.position.set(8.5, 0, 94.6);
  z.add(br);
  const brCol = P.addBox(8.5, 5, 93.9, 3.4, 5, 1.2, 0, { blockCam: false });
  const brambles = new Barrier(game, {
    id: 'gateBrambles', object: br, pos: new THREE.Vector3(8.5, 6, 94.4), radius: 3.5, extent: 6, hits: 2, colliders: [brCol], kind: 'thorns',
    onDispel: () => {
      game.state.flags.gateBrambles = true;
      game.hud.toast('荆棘被吹散了！再对着风轮吹风试试', 3);
      game.saveGame();
    },
  });
  z.addEntity(brambles);
  const wheel = new Spinner(game, {
    id: 'gateWheel', object: hub, rotor, axis: 'z', pos: wheelPos, radius: 3.2, maxSpeed: 6, impulse: 4.6, decay: 0.35, threshold: 5.5, latch: true,
    glowMats: [bronze], glowMax: 1.2, hits: 2,
    locked: () => !brambles.dispelled,
    onActivate: () => gateOpening(z, game, door),
  });
  wheel.onLockedHit = () => game.hud.toast('风轮被荆棘死死缠住了……先把荆棘吹散！', 2.5);
  z.addEntity(wheel);
  return { door, wheel, brambles, wheelPos };
}

function gateOpening(z, game, door) {
  game.state.flags.gateOpen = true;
  game.audio.sfx('solve');
  game.cutscene([
    { pos: [2, 5, 86], pos2: [3.5, 6.5, 88], look: [8.5, 8, 95], look2: [8.5, 8, 95], dur: 1.8 },
    { pos: [0, 3.2, 80], pos2: [0, 2.6, 89], look: [0, 4.5, 100], look2: [0, 3, 108], dur: 4.2, onStart: () => { door.setOpen(true); game.audio.sfx('rumble'); } },
  ], () => {
    game.quest.set('to_ruins');
    game.hud.toast('城门开启了！', 2.5);
    game.saveGame();
  });
}

// ---------------------------------------------------------------------------
function buildGranary(z, B, P, game, x, zz) {
  const w = 9, d = 11, h = 7.5;
  B.box('stone', x, h / 2, zz, w, h, d, 0, 0xd8cfb9, { collide: true, ao: 3 });
  // the roof slab (top at h + 0.25) is the floor up there: climb top-out, chest and planter all sit on it
  B.box('stone', x, h + 0.1, zz, w + 0.4, 0.3, d + 0.4, 0, 0xc9bea6, { collide: true });
  for (const [sx, sz, lw, ld] of [[0, -d / 2, w, 0.4], [0, d / 2, w, 0.4], [-w / 2, 0, 0.4, d], [w / 2, 0, 0.4, d]]) {
    B.box('stone', x + sx, h + 0.75, zz + sz, lw + 0.4, 1.0, ld + 0.4, 0, 0xc9bea6);
    P.addBox(x + sx, h + 0.75, zz + sz, (lw + 0.4) / 2, 0.5, (ld + 0.4) / 2, 0, { walkable: true });
  }
  B.box('wood', x, 1.4, zz + d / 2 + 0.05, 2.2, 2.8, 0.12, 0, 0x6b4630);
  B.box('wood', x + 2.8, 4.2, zz + d / 2 + 0.05, 1.2, 1.2, 0.12, 0, 0x5a3a28);
  B.box('wood', x - 2.8, 4.2, zz + d / 2 + 0.05, 1.2, 1.2, 0.12, 0, 0x5a3a28);
  // rooftop garden
  planter(B, P, x - 2.5, zz - 3.5, 2.5, 1.2, 0, h + 0.25, 41);
  // ivy on the west face (x - w/2)
  const ivy = new THREE.Mesh(planeGeo(5, h - 0.2), M('ivy'));
  ivy.position.set(x - w / 2 - 0.05, h / 2, zz + 1);
  ivy.rotation.y = -Math.PI / 2;
  z.add(ivy);
  z.addClimb({ x: x - w / 2, z: zz + 1, nx: -1, nz: 0, w: 5, y0: 0, y1: h + 0.2, topY: h + 0.25 });
  const chest = new Chest(game, {
    id: 'towerChest', pos: new THREE.Vector3(x + 2, h + 0.25, zz), ry: -Math.PI / 2, physics: P,
    onOpen: () => {
      game.state.flags.towerChest = true;
      game.state.stats.secrets++;
      game.player.maxHp += 2; game.player.hp = game.player.maxHp;
      game.itemGet({ icon: 'heart', name: '心之容器', desc: '生命上限 <b>+1</b>，并完全恢复了生命。<br>藏在旧粮仓屋顶上的祝福。' }, () => game.saveGame());
    },
  });
  z.addEntity(chest);
  z.poi.push({ x, z: zz, color: '#c8a46e', r: 4, hidden: () => !game.state.flags.gateOpen });
  return { chest };
}

// ---------------------------------------------------------------------------
function buildProxy(z, rng) {
  const t = new Terrain({ minX: -240, maxX: 240, minZ: -140, maxZ: 480, step: 5, height: (x, zz) => {
    const inside = x > CITY.minX - 2 && x < CITY.maxX + 2 && zz > CITY.minZ - 2 && zz < CITY.maxZ + 2;
    return inside ? -9 : wildsHeight(x, zz);
  }, color: wildsColor });
  const mat = terrainMaterial();
  for (const m of t.buildMeshes(mat, { chunk: 24, shadows: false })) { m.receiveShadow = false; m.userData.noMap = true; z.add(m); }
  // moat water + gate bridge (visible through the open gate)
  const wm = waterMaterial({ shallow: 0x58a8b8, deep: 0x2a6f8e, constDepth: 2.5, streak: 0.3 });
  for (const [x, zz, w, d] of [[0, 111, 240, 9], [0, -127, 240, 9], [-121, -8, 9, 230], [121, -8, 9, 230]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), wm);
    m.position.set(x, -1.3, zz); m.userData.noMap = true; m.renderOrder = 5;
    z.add(m);
  }
  const PB = new Batcher(null, { cell: 400, shadows: false });
  import_bridge(PB);
  buildFarTower(PB);
  const pm = PB.build(z.scene);
  for (const m of pm) m.userData.noMap = true;
  // sparse trees outside
  const kit = new InstancedKit(z.scene, { chunk: 1000 });
  const T = treeSet(900);
  for (let i = 0; i < 260; i++) {
    const x = rng.range(-220, 220), zz = rng.range(-135, 460);
    if (x > CITY.minX - 18 && x < CITY.maxX + 18 && zz > CITY.minZ - 18 && zz < CITY.maxZ + 22) continue;
    const f = forestMask(x, zz);
    if (f < 0.3 && rng.chance(0.8)) continue;
    const h = wildsHeight(x, zz);
    if (h > 30) continue;
    const m = T.round[i % 3];
    kit.add(m.leaves, M('leaves'), trs(x, h - 0.2, zz, rng.range(0, 6), rng.range(0.9, 1.2)), { cast: false });
    kit.add(m.trunk, M('bark'), trs(x, h - 0.2, zz, rng.range(0, 6), 1), { cast: false });
  }
  for (const m of kit.build()) m.userData.noMap = true;
}
function import_bridge(PB) {
  bridge(PB, null, { x: 0, z: 111.5, ry: 0, len: 17, w: 8, deckY: 0.05, archR: 3.5, baseY: -5, color: 0xd6cdb9 });
}

// ---------------------------------------------------------------------------
function buildNPCs(z, game) {
  const P = z.physics;
  const st = () => game.state.stage;
  const F = () => game.state.flags;
  const miko = z.addNPC(new NPC(game, {
    id: 'miko', name: '巫女 · 千风', preset: 'miko', pos: new THREE.Vector3(6.5, 0, 7.5), yaw: -0.6, physics: P,
    talk: () => {
      const s = st();
      if (s === 'talk_miko') return [
        '你就是那位旅人吧？我是风之神殿的巫女，千风。',
        '如你所见，天鸣城失去了风。风车静止，风铃无声……就连这座喷泉，也在七天前干涸了。',
        '城市的核心「[g]天鸣之心[/g]」停止了运转。古籍记载，只有带着「[j]风之结晶[/j]」的人，才能重新将它唤醒。',
        '而结晶沉睡在城外东南方的[g]风祭遗迹[/g]。可城外已被瘴气与失控的魔物占据……',
        '请去触碰喷泉北侧的[j]风之石碑[/j]。我能感觉到，你身上带着风的气息——石碑或许会回应你。',
      ];
      if (s === 'touch_stele') return ['风之石碑就在喷泉的北侧，去吧，它在等你。'];
      if (s === 'go_gate' || s === 'open_gate') return [
        '那就是[j]风之符文[/j]的力量……！',
        '按 [g]鼠标右键 / F[/g] 就能释放风压。它能转动风车、驱散瘴雾与荆棘，还能掀翻魔物，吹出被尘封的[j]隐藏符文[/j]。',
        '南城门由城楼上的[g]风轮[/g]驱动，可它被诡异的荆棘缠住了。去找守门的岩助吧。',
      ];
      if (s === 'to_ruins' || s === 'cross_gorge' || s === 'ruins_barrier' || s === 'ruins_pillars' || s === 'take_crystal') return ['风祭遗迹在城外东南，要越过一道峡谷。', '遇到打不过的魔物，就用风把它们掀翻吧。愿风守护你，旅人。'];
      if (s === 'return_city' || s === 'temple') return ['结晶在共鸣……神殿的封印已经解开了！', '快去神殿，把结晶献于[g]祭坛[/g]。'];
      if (s === 'undercroft' || s === 'core') return ['神殿地下的风脉回廊……传说那里沉睡着天鸣之心。', '机关会考验你对风的理解。我会在这里为你祈祷。'];
      return ['风回来了。谢谢你，旅人。', '天鸣城的每一个风铃，都会记住你的名字。'];
    },
    onTalked: (g) => {
      if (g.state.stage === 'talk_miko') { g.state.flags.metMiko = true; g.quest.set('touch_stele'); }
    },
  }));
  const guard = z.addNPC(new NPC(game, {
    id: 'guard', name: '守门人 · 岩助', preset: 'guard', pos: new THREE.Vector3(-3.4, 0, 90.5), yaw: Math.PI, mode: 'guard', physics: P,
    talk: () => {
      const s = st(), f = F();
      if (!f.hasRune) return ['城门已经关闭了。外面到处都是游荡的魔物，而且没有风，城门也打不开。', '你还是先去广场找神殿的巫女大人吧。'];
      if (!f.gateOpen) return [
        '哦？你身上有风的气息……那是风之符文？太好了！',
        '城门由上面那座[g]风轮[/g]驱动。七天前，它被一团诡异的黑色荆棘缠住了。',
        '先用风吹散荆棘，再对着风轮[j]多吹几次[/j]，把它转起来，城门就能打开！',
      ];
      if (s === 'free') return ['风又回来了！城门的风轮转得比以前还欢快呢。'];
      return ['城门开了，多亏了你！', '出城后沿着大路往南走，过了草原就能看到峡谷。遗迹就在峡谷对岸。', '要是想回城，随时从这座门进来就行。'];
    },
    onTalked: (g) => { if (g.state.flags.hasRune && !g.state.flags.gateOpen && g.state.stage === 'go_gate') g.quest.set('open_gate'); },
  }));
  z.addNPC(new NPC(game, {
    id: 'mokichi', name: '水果商 · 茂吉', preset: 'merchant', pos: new THREE.Vector3(-10.2, 0, 47), yaw: Math.PI / 2, physics: P,
    talk: () => {
      const f = F();
      if (f.coreActive) return ['风车转起来啦！明天就有新鲜的面粉了！', '来，尝尝这个苹果——算我请客！'];
      if (f.gateOpen) return ['听说是你打开了城门？外面的果园总算能去了！'];
      return ['没有风，城里的磨坊都停了，面粉一点也磨不出来……', '今天只能卖点水果了。要不要来一个？'];
    },
  }));
  z.addNPC(new NPC(game, {
    id: 'kanon', name: '陶器店 · 花音', preset: 'merchant2', pos: new THREE.Vector3(10.4, 0, 57.5), yaw: -Math.PI / 2, physics: P,
    talk: () => [
      '这些陶器用的是城外河边的陶土。',
      '你知道吗？城外那些会蹦蹦跳跳的[g]土偶[/g]，其实是很久以前的工匠做的遗迹守卫。',
      '瘴气让它们失去了理智……用剑敲碎它们，或者用风把它们掀翻，都是好办法。',
      '还有那些戴着面具的黑紫色[g]怨灵[/g]——剑对它们没用，只能用风吹散！',
    ],
  }));
  const circle = [];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; circle.push(new THREE.Vector3(Math.cos(a) * 8.6, 0, Math.sin(a) * 8.6)); }
  z.addNPC(new NPC(game, {
    id: 'aoi', name: '小葵', preset: 'child', pos: circle[0].clone(), path: circle, speed: 2.6, physics: P, colRadius: 0.32,
    talk: () => {
      const f = F();
      if (f.coreActive) return ['喷泉又喷水啦！', '大哥哥……不对，大姐姐？总之谢谢你！'];
      if (f.hasRune) return ['哇！你会用风吗？', '石碑旁边的小风车，帮我把它们吹起来嘛！'];
      return ['风车都不转了，好无聊哦……', '以前喷泉里还有好多小鱼呢。'];
    },
  }));
  z.addNPC(new NPC(game, {
    id: 'elder', name: '长老 · 玄翁', preset: 'elder', pos: new THREE.Vector3(-17.2, 0, -8.8), yaw: 1.1, mode: 'sit', hunch: true, physics: P,
    talk: () => {
      if (F().coreActive) return ['唔……你听，风铃在唱歌。', '好久没有听到这么好听的风声了。'];
      return [
        '年轻人，你知道「天鸣」这个名字的由来吗？',
        '风穿过城中千百个风铃，整座城就像在歌唱一样。',
        '古代的风之民在城外建了许多遗迹，用风驱动机关。他们的[j]符文[/j]有时会被尘土掩埋……',
        '用风一吹，便会显现。若在遗迹里迷了路，不妨对着墙壁和地面吹吹风。',
      ];
    },
  }));
  z.addNPC(new NPC(game, {
    id: 'mio', name: '船家 · 澪', preset: 'woman', pos: new THREE.Vector3(24, 0, 24.5), yaw: Math.PI, physics: P,
    talk: () => [
      '运河的水也快停止流动了。',
      '要是不小心掉进水里，游到岸边就能[g]爬上来[/g]哦。',
      '对了，东南边那座旧粮仓的墙上爬满了[j]藤蔓[/j]，小时候我们常沿着藤蔓爬上屋顶——',
      '听说屋顶上还藏着什么宝贝呢。',
    ],
  }));
  z.addNPC(new NPC(game, {
    id: 'farmer', name: '磨坊主 · 大吾', preset: 'farmer', pos: new THREE.Vector3(-58, 0, -27.5), yaw: 0, physics: P,
    talk: () => F().coreActive ? ['大风车又转起来了！我这辈子都没这么高兴过！'] : ['西边那座大风车塔，是全城最大的磨坊。', '风一停，它就像睡着了一样……真希望能再看到它转起来。'],
  }));
  const api = {
    miko, guard,
    place(s) {
      const stg = s.stage;
      if (['return_city', 'temple', 'undercroft', 'core'].includes(stg) || s.flags.cityChanged && !s.flags.coreActive) miko.setPos(new THREE.Vector3(3.5, TEMPLE.terrace, -43.5), Math.PI * 0.95);
      else miko.setPos(new THREE.Vector3(6.5, 0, 7.5), -0.6);
      miko.mode = ['undercroft', 'core'].includes(stg) ? 'pray' : 'idle';
    },
  };
  return api;
}

// ---------------------------------------------------------------------------
function introScene(z, game) {
  game.cutscene([
    { pos: [30, 26, 60], pos2: [18, 20, 40], look: [0, 6, -30], look2: [0, 6, -40], dur: 4.5, onStart: () => game.talk([{ name: '', text: '天鸣城——千百年来受风神眷顾的城市。' }, { name: '', text: '可是七日之前，城中的风忽然停了。风车静止，风铃无声，喷泉也干涸了……' }]) },
    { pos: [18, 20, 40], pos2: [8, 5, 26], look: [0, 6, -40], look2: [0, 2, 0], dur: 3.5 },
  ], () => {
    game.hud.toast('W A S D 移动 · 鼠标转动视角', 3.5);
  });
}

function cityWakes(z, game, temple, npcs) {
  const f = game.state.flags;
  if (f.cityChanged) return;
  f.cityChanged = true;
  game.audio.sfx('reveal');
  game.cutscene([
    { pos: [3, 3, 84], pos2: [0, 5, 70], look: [0, 3, 60], look2: [0, 4, 40], dur: 3.2, onStart: () => game.hud.toast('风之结晶与城市产生了共鸣……', 3) },
    { pos: [0, 9, 8], pos2: [0, 12, -8], look: [0, 9, -57], look2: [0, 9, -57], dur: 3.6, onStart: () => { temple.setBarrier(false); game.audio.sfx('dispel'); } },
  ], () => {
    npcs.place(game.state);
    game.quest.set('temple');
    game.hud.toast('街灯亮起，神殿的封印消散了！', 3);
    game.saveGame();
  });
}

function cityEnding(z, game, done) {
  const e = z.ending;
  e.fountain.setActive(true);
  for (const t of e.towers) t.spinner.setActive(true);
  e.temple.setCore(true);
  for (const c of z.chimes) c.swing = 1;
  let k = 0;
  const upd = (dt) => { k = Math.min(1, k + dt / 10); z.lerpEnv(ENV_SUNSET, easeInOut(k)); };
  z.animated.push(upd);
  game.audio.sfx('chime');
  playHeld(game, [
    { pos: [12, 3.5, 16], pos2: [8, 5.5, 11], look: [0, 3.2, 0], look2: [0, 4.5, 0], dur: 4.2 },
    { pos: [-38, 10, -6], pos2: [-44, 16, -14], look: [-64, 20, -32], look2: [-64, 20, -32], dur: 3.4, onStart: () => game.audio.sfx('chime') },
    { pos: [0, 5, 22], pos2: [0, 9, 8], look: [0, 12, -60], look2: [0, 40, -72], dur: 4.2, onStart: () => game.audio.sfx('bell') },
  ], () => {
    const i = z.animated.indexOf(upd); if (i >= 0) z.animated.splice(i, 1);
    done && done();
  });
}
