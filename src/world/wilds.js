// 苍风原野 — the open world outside the city walls.
import * as THREE from 'three';
import { Zone } from './zone.js';
import { Batcher, boxGeo, cylGeo, latheGeo, mat4, planeGeo, archRingGeo, mergeGroup, planarUV } from './geom.js';
import { house, stairs, roundTower, column, gableRoof, hipRoof, PAL } from './kit.js';
import { fence, signpost, stoneLantern, crate, barrel, shimenawa } from './props.js';
import {
  wildsHeight, wildsColor, wildsWater, wildsGrass, buildGrassGrid, forestMask, buildCityShell, buildCitySkyline, buildFarTower,
  RIVER_CTRL, CITY, CITY_OUT, MOAT_Y, RUINS, RIM_Y, BRIDGE_X, CAVE, TOWER_FAR, PLATEAU, ROAD_MAIN, ROAD_WEST, rectDist, riverAttr, RIVER, FALLS_X0, FALLS_X1,
} from './shared.js';
import { Terrain, terrainMaterial, GrassField, InstancedKit, treeSet, placeTree, trs, makeFlowerGeo, makeRockModel } from './nature.js';
import { waterMaterial, riverStrip, waterRect, waterfall } from '../gfx/water.js';
import { M, toonMat, glowMat, U } from '../gfx/materials.js';
import { getTex } from '../gfx/textures.js';
import { Spinner, Barrier, Door, Interactable, Chest, Pickup, HiddenRune, PushBlock, PressurePlate, TopplePillar, mistMaterial, runeTile, crystalObject, makeBeam, glowToon } from '../game/entities.js';
import { Haniwa, Wisp } from '../game/enemies.js';
import { NPC } from '../game/npc.js';
import { Avatar } from '../game/avatar.js';
import { RNG, clamp, lerp, easeInOut, easeOutCubic } from '../core/util.js';
import { playHeld } from '../game/camera.js';

export function buildWilds(game) {
  const terrain = new Terrain({ minX: -240, maxX: 240, minZ: -140, maxZ: 520, step: 1.6, height: wildsHeight, color: wildsColor });
  const H = (x, z) => terrain.height(x, z);
  const ground = { height: H, normal: (x, z, o) => terrain.normal(x, z, o), water: wildsWater };
  const z = new Zone(game, 'wilds', {
    name: '苍风原野', subtitle: 'AOKAZE FIELDS', ground, surface: 'grass', killY: -45,
    bounds: { minX: -200, maxX: 205, minZ: 95, maxZ: 480 }, camMaxDist: 11, ambientWind: 0.8, shadowRange: 40,
  });
  z.terrain = terrain;
  const P = z.physics;
  const rng = new RNG(777);
  z.marks = {};
  z.portalTo = {};
  z.poi = [];

  // terrain meshes
  const tmat = terrainMaterial();
  for (const m of terrain.buildMeshes(tmat, { chunk: 64 })) z.add(m);
  const htex = terrain.heightTexture();

  // -------------------------------------------------------------------------
  // WATER: river (upper), waterfall, gorge river, moat
  const riverMat = waterMaterial({ shallow: 0x62d0d6, deep: 0x1f86ae, flow: 0.9, streak: 1, height: htex, width: 12, wave: 1 });
  const upper = RIVER_CTRL.filter((p) => p[0] <= 44).map((p) => [p[0], p[1], p[2], p[3] + 3]);
  z.add(riverStrip(upper, riverMat, { segLen: 3 }));
  const gorgeMat = waterMaterial({ shallow: 0x4fb0c8, deep: 0x1a6a90, flow: 1.4, streak: 1.2, height: htex, width: 10, wave: 1.2 });
  const lower = RIVER_CTRL.filter((p) => p[0] >= 51).map((p) => [p[0], p[1], p[2], p[3] + 2]);
  z.add(riverStrip(lower, gorgeMat, { segLen: 3 }));
  const falls = waterfall([
    [43.5, -13.75, 290, 12, 0, 1], [45, -14.6, 290.1, 11.6, 0, 1], [46.3, -18, 290.3, 11, 0, 1], [47.4, -23, 290.5, 10.4, 0, 1], [48.6, -28, 290.7, 10, 0, 1], [49.6, -31.2, 290.9, 10, 0, 1],
  ], 11, { speed: 3.2 });
  z.add(falls);
  const moatMat = waterMaterial({ shallow: 0x58b0c0, deep: 0x2a7494, height: htex, streak: 0.3, width: 10, wave: 0.6 });
  for (const [x, zz, w, d] of [[0, 111, 256, 12], [0, -127, 256, 12], [-121, -8, 12, 226], [121, -8, 12, 226]]) z.add(waterRect(x, MOAT_Y, zz, w, d, moatMat));
  // ford stepping stones
  const SB = new Batcher(P, { cell: 64 });
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const x = -61 + Math.sin(i * 1.7) * 1.2, zz = 264 + t * 16;
    const rc = RIVER.near(x, zz, 20, {});
    const wy = rc ? riverAttr(rc.s).y : -12;
    SB.add('rock', makeRockModel(40 + i, { flat: 0.35, color: 0xa3a292 }).geo, mat4(x, wy + 0.05, zz, 0, i, 0, 0.9, 0.9, 0.9), 0xffffff);
    P.addCyl(x, zz, 0.85, wy - 2, wy + 0.3);
  }

  // -------------------------------------------------------------------------
  // CITY EXTERIOR
  const B = new Batcher(P, { cell: 128 });
  buildCityShell(B, P, { exterior: true });
  buildCitySkyline(B);
  const towers = [skylineTower(z, B, -64, -38, 5.5, 24, 8), skylineTower(z, B, 66, -50, 5, 22, 7.5)];
  // keep the player out of the (absent) city interior
  P.addBox(0, 5, 95.2, 4, 5, 0.3, 0, { blockCam: false });
  // a short street visible through the open gate
  B.add('ground', planeGeo(28, 30).rotateX(-Math.PI / 2), mat4(0, 0.02, 81), 0xffffff, { noShadow: true });
  B.add('flag', planeGeo(12, 30).rotateX(-Math.PI / 2), mat4(0, 0.03, 81), 0xf0e8d8, { noShadow: true });
  for (const [x, zz, ry] of [[-15, 90, Math.PI / 2], [-15, 80, Math.PI / 2], [-15, 70, Math.PI / 2], [15, 88, -Math.PI / 2], [15, 78, -Math.PI / 2], [15, 68, -Math.PI / 2]]) {
    house(B, null, { x, z: zz, ry, w: 9, d: 7, floors: 2 + (Math.abs(zz) % 2), seed: 700 + zz + (x > 0 ? 50 : 0), lite: true });
  }
  z.portalTo.city = new THREE.Vector3(0, 0, 101);
  z.addTrigger({
    minX: -3.6, maxX: 3.6, minZ: 96, maxZ: 99.6,
    onEnter: () => {
      const p = game.player.pos;
      game.travel('city', new THREE.Vector3(p.x, 0, 94), Math.PI);
    },
  });

  // far tower
  const farTop = buildFarTower(B);
  const farBeam = makeBeam(0x9ff5e8, 700, 6);
  farBeam.position.copy(farTop);
  farBeam.visible = false;
  farBeam.material.uniforms.uOpacity.value = 0.6;
  z.add(farBeam);

  // -------------------------------------------------------------------------
  // ROADSIDE: signpost, fences, farm, shrine
  signpost(z, 12, H(12, 200), 200, 0.6, [
    { text: '风祭遗迹 → 东南', dir: 1, ry: 0 },
    { text: '← 翠影之森 · 浅滩', dir: -1, ry: 0 },
    { text: '天鸣城 ↑ 北', dir: 0, ry: 0 },
  ]);
  fence(B, P, [[-30, 128], [-40, 138], [-44, 154], [-36, 168], [-22, 168]], { heightFn: H });
  buildFarm(z, B, P, game, H, rng);
  buildShrine(z, B, P, game, H);
  // road-side stone markers
  for (let s = 20; s < ROAD_MAIN.length; s += 34) {
    const q = ROAD_MAIN.pointAt(s);
    const x = q.x + q.tz * 3.6, zz = q.z - q.tx * 3.6;
    B.box('stone', x, H(x, zz) + 0.45, zz, 0.45, 1.0, 0.45, Math.atan2(q.tx, q.tz), 0xcfc6b2, { collide: true });
  }

  // -------------------------------------------------------------------------
  // BROKEN BRIDGE + TOPPLING PILLAR
  const bridgeApi = buildBrokenBridge(z, B, P, game, H);

  // RUINS
  const ruins = buildRuins(z, B, P, game, H, rng);

  // CAVE
  const cave = buildCave(z, B, P, game, H, rng);

  // -------------------------------------------------------------------------
  // VEGETATION
  const kit = new InstancedKit(z.scene, { chunk: 250 });
  const T = treeSet(300);
  const blocked = (x, zz) => {
    if (rectDist(x, zz, CITY_OUT) < 18) return true;
    if (wildsWater(x, zz) > H(x, zz) - 1) return true;
    const nearRoad = ROAD_MAIN.near(x, zz, 5.5, {}) || ROAD_WEST.near(x, zz, 5.5, {});
    if (nearRoad) return true;
    if (Math.hypot(x - RUINS.x, zz - RUINS.z) < RUINS.r + 3) return true;
    if (Math.hypot(x - CAVE.x, zz - CAVE.z) < 14) return true;
    if (rectDist(x, zz, { minX: 96, maxX: 126, minZ: 258, maxZ: 318 }) < 0) return true;
    if (Math.hypot(x + 24, zz - 146) < 18) return true;
    if (Math.hypot(x + 52, zz - 226) < 9) return true;
    const rc = RIVER.near(x, zz, 16, {});
    if (rc && rc.x > FALLS_X0 - 3 && rc.d < 14) return true;
    return false;
  };
  const slopeOK = (x, zz) => { const n = terrain.normal(x, zz, new THREE.Vector3()); return n.y > 0.8; };
  let placed = 0;
  for (let i = 0; i < 9000 && placed < 700; i++) {
    const x = rng.range(-205, 210), zz = rng.range(118, 490);
    const f = forestMask(x, zz);
    const p = f > 0.25 ? f * 0.85 : 0.035;
    if (!rng.chance(p)) continue;
    if (blocked(x, zz)) continue;
    const y = H(x, zz);
    const outside = rectDist(x, zz, { minX: -198, maxX: 203, minZ: -125, maxZ: 476 }) > 0;
    if (y > 34) continue;
    if (!outside && !slopeOK(x, zz)) continue;
    let type;
    const r = rng.next();
    if (f > 0.25) type = r < 0.38 ? 'conifer' : r < 0.9 ? 'round' : r < 0.95 ? 'golden' : 'maple';
    else type = r < 0.6 ? 'round' : r < 0.75 ? 'golden' : r < 0.85 ? 'maple' : 'conifer';
    if (rectDist(x, zz, PLATEAU) < 0 && rng.chance(0.4)) type = rng.chance(0.5) ? 'sakura' : 'maple';
    const models = T[type];
    placeTree(kit, models[i % models.length], x, y, zz, rng.range(0, 6.28), rng.range(0.8, 1.25), outside ? null : P);
    placed++;
    if (rng.chance(0.5)) {
      const bx = x + rng.range(-4, 4), bz = zz + rng.range(-4, 4);
      if (!blocked(bx, bz)) kit.add(T.bush[i % 3].leaves, M('leaves'), trs(bx, H(bx, bz) - 0.1, bz, rng.range(0, 6), rng.range(0.7, 1.3)));
    }
  }
  // extra bushes & rocks in the open
  for (let i = 0; i < 380; i++) {
    const x = rng.range(-195, 200), zz = rng.range(120, 470);
    if (blocked(x, zz)) continue;
    const y = H(x, zz);
    if (y > 25) continue;
    if (rng.chance(0.55)) kit.add(T.bush[i % 3].leaves, M('leaves'), trs(x, y - 0.1, zz, rng.range(0, 6), rng.range(0.7, 1.4)));
    else {
      const s = rng.range(0.5, 2.4);
      kit.add(T.rock[i % 3].geo, M('rock'), trs(x, y - 0.25 * s, zz, rng.range(0, 6), s));
      if (s > 1.2) P.addCyl(x, zz, s * 0.85, y - 1, y + s * 0.5);
    }
  }
  // big boulders along the gorge rim & plateau cliff
  for (let i = 0; i < 40; i++) {
    const x = rng.range(52, 200), zz = rng.range(270, 320);
    const rc = RIVER.near(x, zz, 30, {});
    if (!rc || rc.d < 12 || rc.d > 18) continue;
    if (Math.abs(x - BRIDGE_X) < 16) continue;
    const y = H(x, zz), s = rng.range(1.2, 2.6);
    kit.add(T.rock[i % 3].geo, M('rock'), trs(x, y - 0.3 * s, zz, rng.range(0, 6), s));
    P.addCyl(x, zz, s * 0.9, y - 1, y + s * 0.6);
  }
  kit.build();
  SB.build(z.scene);

  // flowers
  buildFlowers(z, H, rng, blocked);

  // grass
  buildGrassGrid(H);
  z.grass = new GrassField(z.scene, { height: H, mask: wildsGrass, density: 7, chunk: 20, dist: game.engine.q.grassDist, seed: 31 });
  z.grass.setQuality(game.engine.q);
  z.setGrassQuality = (q) => z.grass.setQuality(q);

  B.build(z.scene);

  // -------------------------------------------------------------------------
  // ENEMIES
  const enemyDefs = [
    ['h1', 'haniwa', 22, 216], ['h2', 'haniwa', 36, 238], ['h3', 'haniwa', 74, 252], ['h4', 'haniwa', 96, 262],
    ['h5', 'haniwa', -74, 256], ['w1', 'wisp', -100, 244], ['w2', 'wisp', -126, 300], ['h6', 'haniwa', -30, 196],
    ['r1', 'haniwa', 120, 372], ['r2', 'haniwa', 140, 402], ['rw', 'wisp', 146, 378],
    ['cw', 'wisp', -104, 362], ['h7', 'haniwa', 104, 330],
  ];
  z.enemyDefs = enemyDefs;
  const spawnEnemies = () => {
    for (const e of z.enemies) if (e.object.parent) e.object.parent.remove(e.object);
    z.enemies.length = 0;
    for (const [id, type, x, zz] of enemyDefs) {
      if (game.state.done[id]) continue;
      let y = H(x, zz);
      if (Math.hypot(x - RUINS.x, zz - RUINS.z) < RUINS.r) y = RUINS.y;
      const pos = new THREE.Vector3(x, y, zz);
      if (type === 'haniwa') z.addEnemy(new Haniwa(game, z, { id, pos, yaw: rng.range(0, 6), variant: id.startsWith('r') ? 1 : 0 }));
      else z.addEnemy(new Wisp(game, z, { id, pos: pos.clone().setY(y + (id === 'cw' ? 0.5 : 0)), hover: id === 'cw' ? 1.7 : 2.0 }));
    }
  };
  z.spawnEnemies = spawnEnemies;
  z.resetEnemies = () => { for (const e of z.enemies) e.resetToHome(); };

  // -------------------------------------------------------------------------
  // hazards & regions
  z.hazard = (p) => {
    if (p.x > 44 && p.y < -18) { const rc = RIVER.near(p.x, p.z, 16, _h); if (rc) return true; }
    return false;
  };
  z.unsafe = (p) => { const rc = RIVER.near(p.x, p.z, 14, _h); return !!(rc && p.x > 40 && rc.d < 12); };
  const titles = [
    { name: '翠影之森', sub: 'VERDANT SHADE FOREST', test: (p) => p.x < -62 && forestMask(p.x, p.z) > 0.5 },
    { name: '清音川', sub: 'SEION RIVER', test: (p) => { const rc = RIVER.near(p.x, p.z, 10, _h); return rc && rc.x < 30 && rc.d < 9; } },
    { name: '断风峡', sub: 'BROKEN WIND GORGE', test: (p) => Math.abs(p.x - BRIDGE_X) < 20 && p.z > 262 && p.z < 283 },
    { name: '风祭遗迹', sub: 'KAZAMATSURI RUINS', test: (p) => Math.hypot(p.x - RUINS.x, p.z - RUINS.z) < 50 },
    { name: '回音洞', sub: 'ECHO GROTTO', test: (p) => Math.hypot(p.x - CAVE.x, p.z - CAVE.z) < 12 },
  ];
  z.titlesSeen = new Set();
  let regionT = 0;

  // -------------------------------------------------------------------------
  // marks
  z.marks.bridge = new THREE.Vector3(BRIDGE_X, RIM_Y, 272);
  z.marks.pillar = new THREE.Vector3(116.5, RIM_Y, 278);
  z.marks.barrier = new THREE.Vector3(125, RUINS.y, 360);
  z.marks.nextPillar = () => ruins.nextPillarPos();
  z.marks.altar = new THREE.Vector3(RUINS.x, RUINS.y, RUINS.z);
  z.spawns.start = { pos: new THREE.Vector3(0, 0.05, 106.5), yaw: 0 };
  // respawn at the nearest checkpoint on the player's side of the gorge
  const CPS = [
    [0, 106.5, 0], [8, 200, 0.6], [-50, 219, Math.PI], [-60, 258, 0], [-92, 346, 0.3], [108, 266, 0],
    [112, 312, 0], [125, 344, 0], [120, 372, 0.2],
  ];
  z.checkpoint = () => {
    const p = game.player.pos;
    const south = p.x > 50 && p.z > 298;
    let best = null, bd = Infinity;
    for (const [x, zz, yaw] of CPS) {
      if ((x > 50 && zz > 298) !== south) continue;
      if (zz > 360 && !game.state.flags.ruinsBarrier) continue;
      const d = Math.hypot(p.x - x, p.z - zz);
      if (d < bd) { bd = d; best = [x, zz, yaw]; }
    }
    if (!best) return z.spawns.start;
    const [x, zz, yaw] = best;
    const y = Math.hypot(x - RUINS.x, zz - RUINS.z) < RUINS.r ? RUINS.y : H(x, zz) + 0.05;
    return { pos: new THREE.Vector3(x, y, zz), yaw };
  };
  z.nearWater = (p) => {
    const rc = RIVER.near(p.x, p.z, 40, _h);
    let w = rc ? 1 - rc.d / 40 : 0;
    if (Math.hypot(p.x - 47, p.z - 290) < 70) w = Math.max(w, 1 - Math.hypot(p.x - 47, p.z - 290) / 70);
    return w;
  };

  // -------------------------------------------------------------------------
  z.animated.push((dt, t) => {
    const p = game.player.pos;
    z.grass.update(dt, p);
    // waterfall spray
    if (Math.hypot(p.x - 47, p.z - 290) < 90 && Math.random() < dt * 14) {
      game.fx.normal.emit({ pos: { x: 50 + Math.random() * 2, y: -31, z: 286 + Math.random() * 9 }, vel: { x: 1 + Math.random(), y: 2 + Math.random() * 2, z: (Math.random() - 0.5) * 2 }, life: 1.6, size: 1.2, size2: 3, color: new THREE.Color(0xffffff), alpha: 0.35, frame: 4, drag: 0.8 });
    }
    // region titles
    regionT -= dt;
    if (regionT <= 0 && game.mode === 'play' && game.controlEnabled) {
      regionT = 0.5;
      for (const r of titles) if (!z.titlesSeen.has(r.name) && r.test(p)) { z.titlesSeen.add(r.name); game.hud.areaTitle(r.name, r.sub); break; }
    }
    for (const tw of towers) if (tw.on) tw.rotor.rotation.z += dt * 0.9;
    if (farBeam.visible) farBeam.material.uniforms.uOpacity.value = 0.45 + Math.sin(t * 1.5) * 0.1;
  });

  // story trigger near the broken bridge
  z.addTrigger({
    x: BRIDGE_X, z: 272, r: 16,
    onEnter: () => {
      const f = game.state.flags;
      if (!f.pillarFallen && (game.state.stage === 'to_ruins')) {
        game.quest.set('cross_gorge');
        game.talk([{ name: '', text: '石桥从中间断开了，峡谷深不见底……' }, { name: '', text: '桥边那根古老的石柱看起来摇摇欲坠。如果用[j]风[/j]推它一把——' }]);
      }
    },
  });

  z.applyState = (s) => {
    const f = s.flags;
    if (f.pillarFallen) bridgeApi.pillar.setFallen();
    ruins.apply(f);
    cave.apply(f);
    const core = !!f.coreActive;
    farBeam.visible = core;
    M('farGold').emissiveIntensity = core ? 1.6 : 0;
    for (const tw of towers) tw.on = core;
  };
  z.onEnter = () => {
    const f = game.state.flags;
    if (!z.spawned) { z.spawned = true; spawnEnemies(); }
    z.grass.update(0, game.player.pos, true);
    z.titlesSeen.clear();
    if (!f.enteredWilds && game.mode === 'play') {
      f.enteredWilds = true;
      game.after(1.4, () => {
        game.cutscene([
          { pos: [8, 10, 118], pos2: [30, 22, 150], look: [40, -6, 260], look2: [120, 0, 380], dur: 5.5 },
          { pos: [30, 22, 150], pos2: [-4, 3.5, 102], look: [120, 0, 380], look2: [0, 1, 112], dur: 3 },
        ], () => game.hud.toast('远处的古塔……风祭遗迹就在峡谷对岸', 3.2));
      });
    }
  };
  z.playEnding = (done) => wildsEnding(z, game, ruins, farBeam, towers, done);
  z.ruins = ruins;
  z.bridgeApi = bridgeApi;
  return z;
}
const _h = {};

// ---------------------------------------------------------------------------
function skylineTower(z, B, x, zz, r, h, sailR) {
  roundTower(B, null, { x, z: zz, r, h, roof: 0x4d6b95, stone: 0xe2dac8, windows: 3, crenel: false, roofH: r * 2.4 });
  const hub = new THREE.Group();
  hub.position.set(x, h - 4, zz + r + 0.4);
  const rotor = new THREE.Group();
  hub.add(rotor);
  const wood = toonMat({ color: 0x6b4a33, rim: 0.2 });
  const cloth = toonMat({ color: 0xf2ead6, side: THREE.DoubleSide, rim: 0.25 });
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2 + 0.4;
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.28, sailR, 0.28), wood); spar.position.y = sailR / 2; arm.add(spar);
    const sail = new THREE.Mesh(new THREE.BoxGeometry(1.9, sailR - 1.4, 0.05), cloth); sail.position.set(1.05, sailR / 2 + 0.6, 0.1); arm.add(sail);
    rotor.add(arm);
  }
  mergeGroup(rotor);
  z.add(hub);
  return { rotor, on: false };
}

// ---------------------------------------------------------------------------
function buildFarm(z, B, P, game, H, rng) {
  const cx = -24, cz = 146;
  const y = H(cx, cz);
  house(B, P, { x: cx - 6, z: cz - 3, ry: 0.3, w: 7, d: 6, floors: 1, seed: 901, baseY: y - 0.2, roof: 0xb94c3a, style: 'plaster', chimney: true });
  // field rows
  for (let i = 0; i < 6; i++) {
    const zz = cz + 4 + i * 1.6;
    for (let k = 0; k < 7; k++) {
      const x = cx - 2 + k * 1.3;
      const yy = H(x, zz);
      B.add('leaves_farm', new THREE.IcosahedronGeometry(0.35, 0), mat4(x, yy + 0.25, zz, 0, k, 0, 1, 0.7, 1), i % 2 ? 0x8cc84b : 0x6aa840);
    }
  }
  for (const [x, zz] of [[cx + 8, cz - 4], [cx + 9.3, cz - 3]]) { const yy = H(x, zz); B.add('plain', cylGeo(0.7, 0.7, 1.1, 10), mat4(x, yy + 0.55, zz, Math.PI / 2, 0.4, 0), 0xe0c070); P.addCyl(x, zz, 0.7, yy, yy + 1.1); }
  // scarecrow
  const sy = H(cx + 2, cz + 9);
  B.box('wood', cx + 2, sy + 1.1, cz + 9, 0.12, 2.2, 0.12, 0, 0x7a5236);
  B.box('wood', cx + 2, sy + 1.6, cz + 9, 1.6, 0.1, 0.1, 0, 0x7a5236);
  B.add('plain', new THREE.SphereGeometry(0.25, 8, 6), mat4(cx + 2, sy + 2.3, cz + 9), 0xe8d8a8);
  B.add('plain', new THREE.ConeGeometry(0.45, 0.3, 10), mat4(cx + 2, sy + 2.55, cz + 9), 0xe0c070);
  barrel(B, P, cx - 1.5, cz - 6.5, H(cx - 1.5, cz - 6.5));
  crate(B, P, cx - 2.6, cz - 7.2, 0.4, 0.8, H(cx - 2.6, cz - 7.2));
  z.addNPC(new NPC(game, {
    id: 'farmerW', name: '农夫 · 耕作', preset: 'farmer', pos: new THREE.Vector3(cx + 1, y, cz + 2), yaw: 0.4, physics: P, wander: 3,
    talk: () => {
      const f = game.state.flags;
      if (f.coreActive) return ['哈哈，风车都转起来了！今年一定是个丰收年！'];
      return [
        '哟，城门居然开了！你是从城里来的？',
        '往南是草原，那些会蹦的[g]土偶[/g]最近越来越多，小心点。',
        '大路往东南一直通到峡谷的断桥。要是想去西边的森林，从路口往右走，河上有片[j]浅滩[/j]能涉水过河。',
        '浅滩再往南，山脚下有个[g]回音洞[/g]……老人们说里面藏着风之民的宝物。',
      ];
    },
  }));
}
// crop material (non-swaying)
import { defineMaterial } from '../gfx/materials.js';
defineMaterial('leaves_farm', () => toonMat({ vertexColors: true, color: 0xffffff, rim: 0.3, variation: [0.1, 0.4] }));

function buildShrine(z, B, P, game, H) {
  const x = -52, zz = 226, y = H(x, zz);
  // red torii
  const red = 0xc23a2a;
  const tx = x + 4, tz = zz + 2.5, ty = H(tx, tz);
  for (const s of [-1, 1]) { B.cyl('plain', tx + s * 1.6, ty + 1.9, tz, 0.16, 0.2, 3.8, 10, red, { collide: true, ry: 0 }); }
  B.box('plain', tx, ty + 3.9, tz, 4.8, 0.3, 0.34, 0, 0x2a2224);
  B.box('plain', tx, ty + 3.6, tz, 4.2, 0.22, 0.26, 0, red);
  B.box('plain', tx, ty + 3.0, tz, 3.6, 0.18, 0.2, 0, red);
  // small shrine (hokora)
  B.box('stone', x, y + 0.3, zz, 2.2, 0.6, 2.0, 0, 0xc8c4b4, { collide: true });
  B.box('wood', x, y + 1.2, zz, 1.4, 1.2, 1.2, 0, 0x8a5e3c, { collide: true });
  gableRoof(B, mat4(x, y, zz), 1.6, 1.6, 1.8, { pitch: 0.7, axis: 'x', roofColor: 0x4a4a52, gable: 0x8a5e3c });
  B.box('plain', x, y + 1.2, zz + 0.61, 0.8, 0.9, 0.02, 0, 0xf2e6c8);
  stoneLantern(B, P, x - 2.2, zz + 1.8, H(x - 2.2, zz + 1.8), 0.8);
  stoneLantern(B, P, x + 2.2, zz + 1.8, H(x + 2.2, zz + 1.8), 0.8);
  shimenawa(z, new THREE.Vector3(tx - 1.6, ty + 2.8, tz), new THREE.Vector3(tx + 1.6, ty + 2.8, tz), 0.35, 0.07);
  z.addEntity(new Interactable(game, {
    id: 'shrine', pos: new THREE.Vector3(x, y, zz + 1.8), radius: 2.6, prompt: '在神社前祈祷',
    act: (g2) => {
      g2.player.heal(99);
      g2.player.stamina = 1; g2.player.exhausted = false;
      g2.audio.sfx('chime');
      g2.fx.sparkle(g2.player.pos.clone().setY(g2.player.pos.y + 1), 0xffe9a0, 24, 1, 2);
      g2.player.lastSafe.copy(g2.player.pos);
      g2.talk([{ name: '', text: '你合掌祈祷。一阵温暖的风拂过——生命完全恢复了。' }]);
      g2.saveGame();
    },
  }));
  z.poi.push({ x, z: zz, color: '#e05a4a', r: 5 });
}

// ---------------------------------------------------------------------------
function buildBrokenBridge(z, B, P, game, H) {
  const X = BRIDGE_X, Y = RIM_Y;
  const stone = 0xd2cab6;
  // north stub (z 268..283), south stub (z 300..312)
  const stub = (z0, z1, broken) => {
    const len = z1 - z0, zc = (z0 + z1) / 2;
    B.box('stone', X, Y - 0.35, zc, 5.2, 0.7, len, 0, stone, { collide: true });
    B.box('flag', X, Y + 0.01, zc, 4.4, 0.04, len - 0.2, 0, 0xe8e0d0, { noShadow: true });
    for (const s of [-1, 1]) {
      B.box('stone', X + s * 2.45, Y + 0.45, zc, 0.5, 0.9, len, 0, stone);
      P.addBox(X + s * 2.45, Y + 0.6, zc, 0.25, 0.6, len / 2, 0, { walkable: false });
    }
    // pier down into the gorge
    const pz = broken < 0 ? z1 - 1.5 : z0 + 1.5;
    B.box('stone', X, (Y - 0.7 + -33) / 2, pz, 3.6, (Y - 0.7) + 33, 3.2, 0, 0xc4bca8, { ao: 10 });
    // jagged broken edge
    const ez = broken < 0 ? z1 : z0;
    for (let i = 0; i < 5; i++) B.box('stone', X - 2 + i, Y - 0.35 - (i % 2) * 0.3, ez + broken * (0.3 + (i % 3) * 0.25), 0.9, 0.7, 0.8, 0.3 * i, stone);
  };
  stub(268, 283, -1);
  stub(300, 312, 1);
  // debris at the gorge bottom
  for (let i = 0; i < 6; i++) B.box('stone', X - 3 + i * 1.2, -32.4, 289 + (i % 3) * 2, 1.6, 1.2, 1.4, i, stone);
  // the pillar
  const pivot = new THREE.Vector3(116.6, Y - 0.8, 281.4);
  const pg = new THREE.Group();
  pg.position.copy(pivot);
  const pmat = toonMat({ color: 0xd8d2c0, map: getTex('ruin'), rim: 0.3, moss: [0.45, 0.6, 0.3, 0.7], emissive: 0x7fe8d8, emissiveIntensity: 0 });
  const L = 19.4, R = 1.1;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.92, R, L, 16, 6), pmat);
  shaft.position.y = L / 2; shaft.castShadow = true; shaft.receiveShadow = true;
  pg.add(shaft);
  for (const yy of [0.5, L - 0.6]) { const ring = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.2, R * 1.2, 0.8, 16), pmat); ring.position.y = yy; ring.castShadow = true; pg.add(ring); }
  for (let i = 0; i < 4; i++) { const r = runeTile(14, 0x7fe8d8, 1.8, 1.4); const a = i * Math.PI / 2; r.position.set(Math.sin(a) * (R + 0.02), 6 + i * 2.5, Math.cos(a) * (R + 0.02)); r.rotation.y = a; r.material.opacity = 0.35; pg.add(r); }
  pg.rotation.x = 0.05;
  z.add(pg);
  B.box('stone', pivot.x, Y - 0.25, pivot.z, 3.4, 0.5, 3.4, 0.3, 0xc4bca8, { collide: true });
  const standing = P.addCyl(pivot.x, pivot.z, R * 1.1, Y - 1, Y + L);
  const bridgeCol = P.addBox(pivot.x, pivot.y, pivot.z + L / 2, 0.95, R, L / 2, 0, { enabled: false });
  const pillar = new TopplePillar(game, {
    id: 'pillar', object: pg, windPos: new THREE.Vector3(pivot.x, pivot.y + 6, pivot.z), radius: 2.5, dirYaw: 0, length: L,
    bridge: bridgeCol, standing: [standing], targetAng: Math.PI / 2 - 0.02,
    onFall: () => {
      game.state.flags.pillarFallen = true;
      game.audio.sfx('solve');
      game.hud.toast('古柱倒下，架成了一座桥！', 3);
      if (['to_ruins', 'cross_gorge'].includes(game.state.stage)) game.quest.set('ruins_barrier');
      game.saveGame();
    },
  });
  z.addEntity(pillar);
  return { pillar };
}

// ---------------------------------------------------------------------------
function buildRuins(z, B, P, game, H, rng) {
  const { x: CX, z: CZ, y: CY, r: R } = RUINS;
  const stone = 0xc9c7b6;
  // circular platform
  B.add('ruin', cylGeo(R, R + 0.8, 5.2, 48), mat4(CX, CY - 2.6, CZ), stone, { ao: 3 });
  B.add('flag', planarUV(new THREE.CircleGeometry(R - 0.2, 48).rotateX(-Math.PI / 2)), mat4(CX, CY + 0.012, CZ), 0xdcd8c8, { noShadow: true });
  B.add('ruin', new THREE.TorusGeometry(R - 0.1, 0.3, 6, 64), mat4(CX, CY + 0.1, CZ, Math.PI / 2), 0xb8b6a4);
  P.addCyl(CX, CZ, R, CY - 6, CY);
  // grand stairs on the north side (climbing toward +z)
  stairs(B, P, { x: 125, z: 349.6, ry: Math.PI, y0: -5, w: 8, steps: 18, rise: 0.25, run: 0.5, mat: 'ruin', color: 0xd0cebe });
  // torii-like stone gate
  const gx = 125, gz = 359.6;
  for (const s of [-1, 1]) {
    column(B, gx + s * 4.6, CY, gz, { r: 0.55, h: 7, color: 0xcfcdbd, mat: 'ruin', fluted: false });
    P.addCyl(gx + s * 4.6, gz, 0.6, CY, CY + 7);
  }
  B.box('ruin', gx, CY + 7.3, gz, 12.4, 0.6, 1.1, 0, 0xc4c2b0);
  B.box('ruin', gx, CY + 6.2, gz, 10.2, 0.45, 0.7, 0, 0xc4c2b0);
  shimenawa(z, new THREE.Vector3(gx - 4.2, CY + 5.6, gz + 0.5), new THREE.Vector3(gx + 4.2, CY + 5.6, gz + 0.5), 1.0, 0.18);
  // mist barrier across the gate
  const mist = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, 7, 24, 1, true, -Math.PI / 2, Math.PI), mistMaterial());
  mist.position.set(gx, CY + 3.5, gz + 0.2);
  mist.rotation.y = Math.PI;
  mist.renderOrder = 11;
  const mistGroup = new THREE.Group();
  mistGroup.add(mist);
  z.add(mistGroup);
  const mistCol = P.addBox(gx, CY + 3, gz - 0.6, 4.6, 3.5, 1.4, 0, { blockCam: false });
  const barrier = new Barrier(game, {
    id: 'ruinsBarrier', object: mistGroup, pos: new THREE.Vector3(gx, CY + 2.5, gz - 1), radius: 4.5, extent: 8, hits: 1, colliders: [mistCol], kind: 'mist',
    onDispel: () => {
      game.state.flags.ruinsBarrier = true;
      game.hud.toast('瘴雾被风吹散了！', 2.5);
      if (['to_ruins', 'cross_gorge', 'ruins_barrier'].includes(game.state.stage)) game.quest.set('ruins_pillars');
      game.saveGame();
    },
  });
  z.addEntity(barrier);

  // decorative broken columns around the rim
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + 0.1;
    const x = CX + Math.cos(a) * (R - 2.2), zz = CZ + Math.sin(a) * (R - 2.2);
    if (Math.hypot(x - gx, zz - gz) < 7) continue;
    if (Math.hypot(x - 130, zz - 404) < 9) continue;
    if (Math.hypot(x - 150, zz - 392) < 7) continue;
    const broken = rng.chance(0.6) ? rng.range(0.2, 0.7) : 0;
    column(B, x, CY, zz, { r: 0.5, h: 6, color: 0xd0cebe, mat: 'ruin', broken });
    P.addCyl(x, zz, 0.6, CY, CY + 6);
    if (broken && rng.chance(0.6)) {
      const fa = rng.range(0, 6.28);
      B.add('ruin', cylGeo(0.46, 0.46, 2.4, 12), mat4(x + Math.cos(fa) * 2.2, CY + 0.46, zz + Math.sin(fa) * 2.2, Math.PI / 2, fa, 0), 0xc8c6b4);
    }
  }
  // glowing floor runes (brighten as pillars wake)
  const floorRunes = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = runeTile([0, 1, 2, 3, 11, 13, 14, 7][i], 0x7fe8d8, 2.2, 1.6);
    r.rotation.x = -Math.PI / 2; r.position.set(CX + Math.cos(a) * 9, CY + 0.03, CZ + Math.sin(a) * 9);
    r.material.opacity = 0.12;
    z.add(r); floorRunes.push(r);
  }

  // --- altar with rising pedestal
  B.add('ruin', cylGeo(4, 4.4, 0.6, 24), mat4(CX, CY + 0.3, CZ), 0xd6d4c4);
  P.addCyl(CX, CZ, 4.2, CY, CY + 0.6);
  const ped = new THREE.Group();
  const pedMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 2.4, 10), toonMat({ color: 0xd8d6c6, map: getTex('ruin'), rim: 0.3, emissive: 0x7fe8d8, emissiveIntensity: 0 }));
  pedMesh.position.y = 1.2; pedMesh.castShadow = true;
  ped.add(pedMesh);
  ped.position.set(CX, CY + 0.6 - 2.4, CZ);
  z.add(ped);
  const pedCol = P.addCyl(CX, CZ, 1.2, CY - 2, CY + 0.6, { dynamic: false });
  const crystal = crystalObject(1);
  crystal.visible = false;
  const crystalPick = new Pickup(game, {
    id: 'crystal', kind: 'crystal', pos: new THREE.Vector3(CX, CY + 3.6, CZ), object: crystal, auto: false,
    onTake: () => {
      const f = game.state.flags;
      f.crystalTaken = true;
      game.audio.sfx('item');
      game.itemGet({ icon: 'crystal', name: '风之结晶', desc: '凝聚着远古之风的结晶，温暖而轻盈。<br>它似乎在呼唤着天鸣城的方向。<br><b>带着它返回天鸣城吧。</b>' }, () => { game.quest.set('return_city'); game.saveGame(); });
    },
  });
  crystalPick.interactRadius = 3.2;
  crystalPick.interactPos = () => new THREE.Vector3(CX, CY + 0.6, CZ);
  crystalPick.canInteract = () => crystal.visible && !crystalPick.taken;
  z.addEntity(crystalPick);
  let pedK = 0, pedUp = false;

  // --- pillar builder
  const pillarGlow = [];
  const makePillar = (id, x, y, zz, onAct) => {
    const g = new THREE.Group();
    g.position.set(x, y, zz);
    const smat = toonMat({ color: 0xcfcdbd, map: getTex('ruin'), rim: 0.3, moss: [0.45, 0.6, 0.3, 0.5] });
    const glow = glowToon(0xb8a070, 0x7fe8d8, { rim: 0.6, rimColor: 0xfff0c0 });
    const post = new THREE.Mesh(new THREE.LatheGeometry([[0.001, 0], [1.0, 0], [1.0, 0.4], [0.7, 0.6], [0.55, 1.2], [0.55, 3.0], [0.8, 3.3], [0.001, 3.3]].map((p) => new THREE.Vector2(p[0], p[1])), 12), smat);
    post.castShadow = true;
    g.add(post);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.08, 6, 24), glow);
    band.rotation.x = Math.PI / 2; band.position.y = 2.1;
    g.add(band);
    const rotor = new THREE.Group();
    rotor.position.y = 3.9;
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 1.9), smat);
      blade.position.set(Math.sin((i * Math.PI) / 2) * 1.1, 0, Math.cos((i * Math.PI) / 2) * 1.1);
      blade.rotation.set(0.5, (i * Math.PI) / 2, 0);
      blade.castShadow = true;
      rotor.add(blade);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.07, 6, 32), glow);
    ring.rotation.x = Math.PI / 2;
    rotor.add(ring);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), glow);
    rotor.add(orb);
    mergeGroup(rotor);
    g.add(rotor);
    z.add(g);
    P.addCyl(x, zz, 1.0, y, y + 3.3);
    const beam = makeBeam(0x9ff5e8, 60, 0.5);
    beam.position.set(x, y + 4, zz);
    beam.visible = false;
    z.add(beam);
    pillarGlow.push(glow);
    const sp = new Spinner(game, {
      id, object: g, rotor, axis: 'y', pos: new THREE.Vector3(x, y + 3.9, zz), radius: 1.8, maxSpeed: 5, impulse: 6, decay: 0.8, threshold: 4, latch: true,
      glowMats: [glow], glowMax: 2.4,
      onActivate: () => { beam.visible = true; onAct(); },
    });
    sp.beam = beam;
    z.addEntity(sp);
    return sp;
  };
  const checkAll = () => {
    const f = game.state.flags;
    if (f.pillarA && f.pillarB && f.pillarC && !f.crystalTaken && !pedUp) {
      game.after(1.0, () => allPillarsCutscene());
    }
  };
  const act = (flag) => () => {
    const f = game.state.flags;
    if (f[flag]) return;
    f[flag] = true;
    game.audio.sfx('activate');
    game.fx.ring(new THREE.Vector3(CX, CY + 0.1, CZ), 0x9ff5e8, 1, 14, 1.4, 0.7);
    const n = (f.pillarA ? 1 : 0) + (f.pillarB ? 1 : 0) + (f.pillarC ? 1 : 0);
    game.hud.toast(`风之塔柱苏醒了（${n}/3）`, 2.5);
    if (game.state.stage === 'ruins_barrier') game.quest.set('ruins_pillars');
    game.quest.refresh(true);
    game.saveGame();
    checkAll();
  };
  const pA = makePillar('pillarA', 115, CY, 383, act('pillarA'));

  // --- upper terrace with ivy (pillar B on top)
  const TX = 130, TZ = 405, TW = 14, TD = 9, TH = 5;
  B.box('ruin', TX, CY + TH / 2, TZ, TW, TH, TD, 0, 0xc4c2b0, { collide: true, ao: 3 });
  B.box('ruin', TX, CY + TH + 0.15, TZ, TW + 0.6, 0.3, TD + 0.6, 0, 0xb8b6a4);
  for (const [dx, dz] of [[-6, -3.5], [6, -3.5], [-6, 3.5], [6, 3.5]]) {
    column(B, TX + dx, CY + TH, TZ + dz, { r: 0.4, h: 4.5, color: 0xd0cebe, mat: 'ruin', broken: rng.chance(0.5) ? 0.4 : 0 });
    P.addCyl(TX + dx, TZ + dz, 0.5, CY + TH, CY + TH + 4.5);
  }
  const ivy = new THREE.Mesh(planeGeo(6, TH - 0.1), M('ivy'));
  ivy.position.set(TX, CY + TH / 2, TZ - TD / 2 - 0.06);
  ivy.rotation.y = Math.PI;
  z.add(ivy);
  z.addClimb({ x: TX, z: TZ - TD / 2, nx: 0, nz: -1, w: 6, y0: CY, y1: CY + TH, topY: CY + TH + 0.3 });
  const pB = makePillar('pillarB', TX + 2.5, CY + TH + 0.3, TZ + 1, act('pillarB'));
  // statue of a wind priest (broken) on the terrace edge
  const statue = new Avatar({ statue: true, hairStyle: 'short', outfit: 'robe', sleeves: 'wide', stoneColor: 0xc8c6b4 });
  statue.animate(0.016, { mode: 'idle' });
  statue.root.position.set(TX - 3.5, CY + TH + 0.3, TZ + 1);
  statue.root.scale.setScalar(1.3);
  statue.root.rotation.y = Math.PI;
  z.add(statue.root);

  // --- shrine with the sealed door (pillar C inside)
  const SX = 150.5, SZ = 392, SW = 7, SD = 7, SH = 5;
  const wallC = 0xc2c0ae;
  B.box('ruin', SX, CY + SH / 2, SZ - SD / 2, SW, SH, 0.8, 0, wallC, { collide: true, ao: 2 });
  B.box('ruin', SX, CY + SH / 2, SZ + SD / 2, SW, SH, 0.8, 0, wallC, { collide: true, ao: 2 });
  B.box('ruin', SX + SW / 2, CY + SH / 2, SZ, 0.8, SH, SD, 0, wallC, { collide: true, ao: 2 });
  // west wall with a door opening (2.8 wide)
  for (const s of [-1, 1]) B.box('ruin', SX - SW / 2, CY + SH / 2, SZ + s * (SD / 4 + 0.7), 0.8, SH, SD / 2 - 1.4, 0, wallC, { collide: true, ao: 2 });
  B.box('ruin', SX - SW / 2, CY + SH - 0.8, SZ, 0.8, 1.6, 2.8, 0, wallC, { collide: true });
  hipRoof(B, mat4(SX, CY + SH, SZ), SW, SD, 0, { h: 3.2, color: 0x6a8a7a, over: 0.4 });
  P.addBox(SX, CY + SH + 1.2, SZ, SW / 2, 1.2, SD / 2, 0, { walkable: false });
  const doorG = new THREE.Group();
  const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.3, 2.9), toonMat({ color: 0xbab8a6, map: getTex('ruin'), rim: 0.3 }));
  doorMesh.castShadow = true;
  doorG.add(doorMesh);
  const dr = runeTile(13, 0x7fe8d8, 2.0, 1.6);
  dr.position.set(-0.26, 0.2, 0); dr.rotation.y = -Math.PI / 2; dr.material.opacity = 0.5;
  doorG.add(dr);
  doorG.position.set(SX - SW / 2, CY + 1.65, SZ);
  z.add(doorG);
  const doorCol = P.addBox(SX - SW / 2, CY + 1.65, SZ, 0.3, 1.65, 1.45);
  const door = new Door(game, { id: 'ruinsDoor', object: doorG, colliders: [doorCol], mode: 'down', dist: 3.4, dur: 2.2 });
  z.addEntity(door);
  const pC = makePillar('pillarC', SX + 1, CY, SZ, act('pillarC'));

  // --- push-block puzzle in front of the shrine (5x4 cells of 2m)
  const blockedCells = new Set(['2,1', '1,3']);
  const grid = { x0: 134, z0: 380, size: 2, y: CY, w: 5, h: 4, blocked: (i, j) => blockedCells.has(i + ',' + j), blocks: [] };
  // floor tiles + rubble on blocked cells
  for (let i = 0; i < grid.w; i++) for (let j = 0; j < grid.h; j++) {
    const x = grid.x0 + (i + 0.5) * 2, zz = grid.z0 + (j + 0.5) * 2;
    B.box('ruin', x, CY + 0.03, zz, 1.9, 0.06, 1.9, 0, (i + j) % 2 ? 0xc8c6b6 : 0xbdbbaa, { noShadow: true });
    if (grid.blocked(i, j)) { column(B, x, CY, zz, { r: 0.55, h: 2.4, color: 0xc8c6b4, mat: 'ruin', broken: 0.3 }); P.addCyl(x, zz, 0.7, CY, CY + 1.8); }
  }
  const block = new PushBlock(game, { id: 'ruinsBlock', grid, i: 0, j: 0, physics: P });
  z.addEntity(block);
  const plateCell = [4, 2];
  const plate = new PressurePlate(game, {
    id: 'ruinsPlate', pos: new THREE.Vector3(grid.x0 + (plateCell[0] + 0.5) * 2, CY, grid.z0 + (plateCell[1] + 0.5) * 2), size: 1.9, grid, cell: plateCell, hidden: true, allowPlayer: false, latch: true,
    onPress: () => {
      game.state.flags.ruinsDoor = true;
      door.setOpen(true);
      game.audio.sfx('solve');
      game.hud.toast('石门缓缓沉入地下……', 2.5);
      game.saveGame();
    },
  });
  z.addEntity(plate);
  let plateHintShown = false;
  z.animated.push(() => {
    const p = game.player.pos;
    if (!plate.hidden && !plate.pressed && !plateHintShown && Math.abs(p.x - plate.pos.x) < 0.9 && Math.abs(p.z - plate.pos.z) < 0.9) { plateHintShown = true; game.hud.toast('石板纹丝不动……需要更重的东西压住它', 3); }
  });
  z.addTrigger({
    x: SX - SW / 2 - 2, z: SZ, r: 6,
    onEnter: () => { if (!game.state.flags.ruinsPlate && game.state.flags.ruinsBarrier) game.hud.toast('石门紧闭……旁边的地面上似乎有什么被尘土掩盖了', 3.5); },
  });
  const hint = new HiddenRune(game, {
    id: 'ruinsRune', pos: new THREE.Vector3(plate.pos.x, CY + 0.08, plate.pos.z), glyph: 8, size: 1.8, rotX: -Math.PI / 2, radius: 1.6,
    onReveal: () => {
      game.state.flags.ruinsPlate = true;
      plate.setHidden(false);
      game.hud.toast('隐藏的符文显现了——是一块压力石板！', 3);
      game.saveGame();
    },
  });
  z.addEntity(hint);
  // carved hint on the shrine wall: arrow + block glyph (visible)
  const wallHint = runeTile(13, 0xd8c890, 1.4, 1.2);
  wallHint.position.set(SX - SW / 2 - 0.42, CY + 3.6, SZ + 2.2); wallHint.rotation.y = -Math.PI / 2; wallHint.material.opacity = 0.6;
  z.add(wallHint);
  // reset stone for the block puzzle
  const resetStone = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.0, 8), toonMat({ color: 0xb8b6a4, rim: 0.3 }));
  resetStone.position.set(grid.x0 - 1.4, CY + 0.5, grid.z0 + 0.5);
  z.add(resetStone);
  const rsTile = runeTile(9, 0xd8c890, 1.6, 0.6); rsTile.position.set(grid.x0 - 1.4, CY + 1.05, grid.z0 + 0.5); rsTile.rotation.x = -Math.PI / 2; z.add(rsTile);
  P.addCyl(grid.x0 - 1.4, grid.z0 + 0.5, 0.45, CY, CY + 1);
  z.addEntity(new Interactable(game, {
    id: 'blockReset', pos: new THREE.Vector3(grid.x0 - 1.4, CY, grid.z0 + 0.5), radius: 2, prompt: '复位石块',
    can: () => !plate.pressed, act: () => { block.reset(); game.audio.sfx('thunk'); game.fx.sparkle(block.pos, 0xd8c890, 12, 1, 1); },
  }));

  // --- all pillars awake: pedestal rises with the crystal
  const allPillarsCutscene = () => {
    if (pedUp) return;
    pedUp = true;
    game.audio.sfx('solve');
    game.cutscene([
      { pos: [CX - 14, CY + 7, CZ - 16], pos2: [CX - 9, CY + 5, CZ - 11], look: [CX, CY + 2, CZ], look2: [CX, CY + 3, CZ], dur: 4.2, onStart: () => { for (const sp of [pA, pB, pC]) game.fx.windLines.add({ origin: sp.pos.clone(), dir: new THREE.Vector3(CX, CY + 3, CZ).sub(sp.pos), len: sp.pos.distanceTo(new THREE.Vector3(CX, CY + 3, CZ)), dur: 1.4, width: 0.2, swirl: 0.3, radius: 0.3, alpha: 1, trail: 0.6 }); game.audio.sfx('rumble'); game.cam.shake(0.4); } },
    ], () => game.quest.set('take_crystal'));
  };
  z.animated.push((dt, t) => {
    const target = pedUp ? 1 : 0;
    if (pedK !== target) {
      pedK = clamp(pedK + (target ? dt / 3 : -dt), 0, 1);
      ped.position.y = CY + 0.6 - 2.4 + easeInOut(pedK) * 2.4;
      pedCol.top = CY + 0.6 + easeInOut(pedK) * 2.4 - 0.001;
    }
    crystal.visible = pedK > 0.95 && !game.state.flags.crystalTaken;
    pedMesh.material.emissiveIntensity = pedUp ? 0.6 + Math.sin(t * 3) * 0.3 : 0;
    const f = game.state.flags;
    const n = (f.pillarA ? 1 : 0) + (f.pillarB ? 1 : 0) + (f.pillarC ? 1 : 0);
    for (const r of floorRunes) r.material.opacity = lerp(r.material.opacity, 0.12 + n * 0.25 + (f.coreActive ? 0.2 : 0), 1 - Math.exp(-2 * dt));
  });
  // ending beam from the altar
  const altarBeam = makeBeam(0x9ff5e8, 300, 2.4);
  altarBeam.position.set(CX, CY + 0.6, CZ);
  altarBeam.visible = false;
  z.add(altarBeam);

  const api = {
    apply(f) {
      if (f.ruinsBarrier) barrier.dispel(true);
      if (f.pillarA) pA.setActive(true, true);
      if (f.pillarB) pB.setActive(true, true);
      if (f.pillarC) pC.setActive(true, true);
      for (const sp of [pA, pB, pC]) if (sp.active) sp.beam.visible = true;
      if (f.ruinsPlate) { hint.reveal(true); plate.setHidden(false); }
      if (f.ruinsDoor) { door.setOpen(true, true); block.i = plateCell[0]; block.j = plateCell[1]; block.reset.call(Object.assign(block, { startI: plateCell[0], startJ: plateCell[1] })); plate.latched = true; plate.pressed = true; }
      if (f.pillarA && f.pillarB && f.pillarC) { pedUp = true; pedK = 1; ped.position.y = CY + 0.6; pedCol.top = CY + 3; }
      if (f.crystalTaken) { crystalPick.taken = true; crystal.visible = false; }
      altarBeam.visible = !!f.coreActive;
    },
    nextPillarPos() {
      const f = game.state.flags;
      if (!f.pillarA) return pA.pos.clone().setY(CY);
      if (!f.pillarB) return new THREE.Vector3(TX, CY, TZ - TD / 2 - 1);
      if (!f.pillarC) return f.ruinsDoor ? pC.pos.clone().setY(CY) : f.ruinsPlate ? block.pos.clone().setY(CY) : plate.pos.clone();
      return new THREE.Vector3(CX, CY, CZ);
    },
    pillars: [pA, pB, pC],
    altarBeam,
  };
  return api;
}

// ---------------------------------------------------------------------------
function buildCave(z, B, P, game, H, rng) {
  const cx = CAVE.x, cz = CAVE.z;
  const fy = H(cx, cz);
  const T = treeSet(640);
  const kit = new InstancedKit(z.scene, { chunk: 200 });
  // ring of big rocks (opening toward the north-east)
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const da = Math.atan2(Math.sin(a - (-Math.PI * 0.3)), Math.cos(a - (-Math.PI * 0.3)));
    if (Math.abs(da) < 0.5) continue;
    const r = 8.5;
    const x = cx + Math.cos(a) * r, zz = cz + Math.sin(a) * r;
    const s = rng.range(2.6, 3.4);
    kit.add(T.rock[i % 3].geo, M('rock'), trs(x, fy + s * 0.4, zz, a, s, 0, 0, s * 1.4));
    P.addCyl(x, zz, s * 0.95, fy - 2, fy + 8);
  }
  // roof slabs
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.6;
    const x = cx + Math.cos(a) * 3.4, zz = cz + Math.sin(a) * 3.4;
    kit.add(T.rock[i % 3].geo, M('rock'), trs(x, fy + 7.2, zz, a, 5.2, 0.15, 0.1, 1.6));
  }
  kit.add(T.rock[0].geo, M('rock'), trs(cx, fy + 7.6, cz, 0, 5.5, 0, 0, 1.5));
  P.addBox(cx, fy + 8.5, cz, 7, 1.2, 7, 0, { walkable: false });
  // rock dome roof with a gap facing the entrance (keeps the grotto in shadow)
  const entrance = -Math.PI * 0.3;
  const phiGap = Math.PI - entrance;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(9.6, 28, 10, phiGap + 0.55, Math.PI * 2 - 1.1, 0, Math.PI / 2),
    toonMat({ color: 0x6f6c62, rim: 0.15, side: THREE.DoubleSide, moss: [0.43, 0.6, 0.3, 0.6], variation: [0.12, 0.4] }),
  );
  dome.scale.set(1, 0.85, 1);
  dome.position.set(cx, fy - 0.2, cz);
  dome.castShadow = true; dome.receiveShadow = true;
  z.add(dome);
  kit.build();
  // glowing mushrooms & crystals (merged into a few meshes)
  const deco = new THREE.Group();
  const zAdd = (o) => deco.add(o);
  const mush = toonMat({ color: 0x9ff5e8, emissive: 0x5fd8c8, emissiveIntensity: 1.4, rim: 0.6 });
  const stem = toonMat({ color: 0xe8e2d0, rim: 0.3 });
  for (let i = 0; i < 14; i++) {
    const a = rng.range(0, 6.28), r = rng.range(4, 7);
    const x = cx + Math.cos(a) * r, zz = cz + Math.sin(a) * r, y = H(x, zz);
    const s = rng.range(0.6, 1.3);
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * s, 0.07 * s, 0.35 * s, 6), stem); st.position.set(x, y + 0.17 * s, zz); zAdd(st);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2 * s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mush); cap.position.set(x, y + 0.33 * s, zz); zAdd(cap);
  }
  const crystalM = toonMat({ color: 0xa8c8ff, emissive: 0x6a8ae8, emissiveIntensity: 1.2, rim: 0.8 });
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, 6.28), r = rng.range(5, 7);
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), crystalM);
    c.scale.set(0.6, 1.6, 0.6);
    c.position.set(cx + Math.cos(a) * r, H(cx + Math.cos(a) * r, cz + Math.sin(a) * r) + 0.5, cz + Math.sin(a) * r);
    c.rotation.z = rng.range(-0.4, 0.4);
    zAdd(c);
  }
  z.add(mergeGroup(deco));
  // hidden rune on the back wall -> a stone chest rises
  const backA = -Math.PI * 0.3 + Math.PI;
  const rx = cx + Math.cos(backA) * 6.2, rz = cz + Math.sin(backA) * 6.2;
  const chest = new Chest(game, {
    id: 'caveChest', pos: new THREE.Vector3(cx, fy - 1.4, cz), ry: -Math.PI * 0.3 - Math.PI / 2,
    onOpen: () => {
      game.state.flags.caveChest = true;
      game.state.stats.secrets++;
      game.player.maxHp += 2; game.player.hp = game.player.maxHp;
      game.itemGet({ icon: 'heart', name: '心之容器', desc: '生命上限 <b>+1</b>，并完全恢复了生命。<br>风之民将它藏在回音洞的深处。' }, () => game.saveGame());
    },
  });
  z.addEntity(chest);
  let rising = false, riseK = 0;
  chest.canInteract = () => riseK >= 1 && !chest.opened;
  const rune = new HiddenRune(game, {
    id: 'caveRune', pos: new THREE.Vector3(rx, fy + 1.8, rz), glyph: 11, size: 1.8, radius: 2,
    normal: new THREE.Vector3(cx - rx, 0, cz - rz).normalize(),
    onReveal: () => { rising = true; game.audio.sfx('rumble'); game.cam.shake(0.3); game.hud.toast('地面在震动……', 2); },
  });
  z.addEntity(rune);
  z.animated.push((dt) => {
    if (rising && riseK < 1) {
      riseK = Math.min(1, riseK + dt / 2.5);
      chest.object.position.y = fy - 1.4 + easeOutCubic(riseK) * 1.4;
      if (Math.random() < 0.5) game.fx.dust(chest.object.position, 1);
    }
  });
  z.poi.push({ x: cx, z: cz, color: '#9ff5e8', r: 5 });
  return {
    apply(f) {
      if (f.caveChest) { rune.reveal(true); rising = true; riseK = 1; chest.object.position.y = fy; chest.setOpened(); }
    },
  };
}

// ---------------------------------------------------------------------------
function buildFlowers(z, H, rng, blocked) {
  const g = makeFlowerGeo();
  const cols = [0xffffff, 0xf5d547, 0x8fb8ff, 0xf07aa0, 0xc8a0ff];
  const mats = cols.map((c) => toonMat({ color: c, vertexColors: true, rim: 0.3, variation: [0.05, 1] }));
  const lists = cols.map(() => []);
  let n = 0;
  for (let i = 0; i < 14000 && n < 3200; i++) {
    const x = rng.range(-190, 200), zz = rng.range(120, 460);
    if (wildsGrass(x, zz) < 0.7 || blocked(x, zz)) continue;
    // cluster in meadows
    const cl = Math.sin(x * 0.07) * Math.cos(zz * 0.05);
    if (cl < 0.2 && rng.chance(0.8)) continue;
    const k = rng.int(0, cols.length - 1);
    lists[k].push(trs(x, H(x, zz) - 0.02, zz, rng.range(0, 6), rng.range(0.8, 1.3)));
    n++;
  }
  lists.forEach((list, k) => {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(g, mats[k], list.length);
    list.forEach((mx, i) => m.setMatrixAt(i, mx));
    m.castShadow = false; m.receiveShadow = true;
    m.computeBoundingSphere();
    m.userData.noMap = true;
    z.add(m);
  });
}

// ---------------------------------------------------------------------------
function wildsEnding(z, game, ruins, farBeam, towers, done) {
  ruins.altarBeam.visible = true;
  for (const sp of ruins.pillars) { sp.setActive(true, true); sp.beam.visible = true; }
  farBeam.visible = true;
  M('farGold').emissiveIntensity = 1.6;
  for (const tw of towers) tw.on = true;
  const { x: CX, z: CZ, y: CY } = RUINS;
  playHeld(game, [
    { pos: [CX - 26, CY + 10, CZ - 30], pos2: [CX - 18, CY + 16, CZ - 22], look: [CX, CY + 4, CZ], look2: [CX, CY + 18, CZ], dur: 4.2, onStart: () => { game.audio.sfx('core'); } },
    { pos: [28, 9, 240], pos2: [42, 15, 254], look: [TOWER_FAR.x, 110, TOWER_FAR.z], look2: [TOWER_FAR.x, 180, TOWER_FAR.z], dur: 5.2, onStart: () => game.audio.sfx('bell') },
  ], () => done && done());
}
