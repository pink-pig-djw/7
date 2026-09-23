// 风脉回廊 — the small underground ruin beneath the temple (3-5 minute wind puzzle).
import * as THREE from 'three';
import { Zone } from './zone.js';
import { Batcher, boxGeo, cylGeo, mat4, planeGeo, mergeGroup, planarUV } from './geom.js';
import { column, stairs } from './kit.js';
import { M, toonMat, glowMat, U, defineMaterial } from '../gfx/materials.js';
import { getTex } from '../gfx/textures.js';
import { Spinner, Door, Interactable, HiddenRune, PushBlock, PressurePlate, RunePedestal, WindDuct, runeTile, crystalObject, makeBeam, glowToon } from '../game/entities.js';
import { Haniwa, Wisp } from '../game/enemies.js';
import { UC_RETURN, ENV_SUNSET } from './city.js';
import { ENV_DAY } from './zone.js';
import { RNG, clamp, lerp, easeInOut } from '../core/util.js';
import { playHeld } from '../game/camera.js';

const PIT = { z0: -66, z1: -54 };
defineMaterial('runeStrip', () => glowMat(0x7fe8d8, 2.0));
const CORE = new THREE.Vector3(0, 0, -102);
const CORE_R = 18;

function ucGround() {
  return {
    height: (x, z) => (z > PIT.z0 && z < PIT.z1 && Math.abs(x) < 11.5 ? -16 : 0),
    normal: (x, z, o) => o.set(0, 1, 0),
    water: () => -Infinity,
  };
}

export function buildUndercroft(game) {
  const z = new Zone(game, 'undercroft', {
    name: '风脉回廊', subtitle: 'WIND VEIN UNDERCROFT', ground: ucGround(), surface: 'stone', killY: -12,
    bounds: { minX: -26, maxX: 26, minZ: -126, maxZ: 18 }, camMaxDist: 7.5, ambientWind: 0, shadowRange: 30, music: 'undercroft',
    env: {
      zenith: 0x071014, fog: 0x0f2226, fogSun: 0x173338, ground: 0x05080a, fogDensity: 0.02, fogStart: 10, fogHeight: 0.0, fogBase: 0, fogMax: 0.85,
      sunDir: [0.25, 0.9, 0.35], sunColor: 0x9fd0e8, sunIntensity: 1.05, hemiSky: 0x5a7a88, hemiGround: 0x2a2018, hemiIntensity: 1.6,
      cloud: 2, mountains: false, exposure: 1.08, sat: 1.05, bloom: 0.9, wind: [0.2, 0.1],
    },
  });
  z.sky.group.visible = true;
  const P = z.physics;
  const B = new Batcher(P, { cell: 96 });
  const rng = new RNG(4242);
  z.marks = {};
  z.portalTo = {};
  z.poi = [];
  const wallC = 0x9a9e94, floorC = 0xb8b4a4, darkC = 0x6f7470;
  const H = 9;

  // helpers
  const wall = (x0, z0, x1, z1, h = H, c = wallC) => {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = Math.abs(x1 - x0) || 1, d = Math.abs(z1 - z0) || 1;
    B.box('ruin', cx, h / 2, cz, w, h, d, 0, c, { collide: true, ao: 3 });
  };
  const floor = (x0, x1, z0, z1, c = floorC) => {
    const g = planeGeo(x1 - x0, z1 - z0).rotateX(-Math.PI / 2);
    B.add('flag', g, mat4((x0 + x1) / 2, 0.01, (z0 + z1) / 2), c, { noShadow: true });
  };
  const ceil = (x0, x1, z0, z1) => B.box('ruin', (x0 + x1) / 2, H + 0.5, (z0 + z1) / 2, x1 - x0, 1, z1 - z0, 0, darkC, { noShadow: true });
  const strip = (x, y, zz, w, d, ry = 0) => B.add('runeStrip', boxGeo(w, 0.1, d), mat4(x, y, zz, 0, ry, 0), 0xffffff, { noShadow: true });

  // -------------------------------------------------------------------------
  // ENTRANCE stairs (up to the temple) + Room 1
  floor(-12, 12, -30, 4);
  ceil(-12, 12, -30, 16);
  wall(-12.5, -30, -12, 16); wall(12, -30, 12.5, 16);
  stairs(B, P, { x: 0, z: 4.5, ry: Math.PI, y0: 0, w: 7, steps: 16, rise: 0.3, run: 0.6, mat: 'ruin', color: 0xa8a698 });
  wall(-12, 14.2, 12, 14.8, H);
  wall(-12, 4, -3.8, 14.2, H); wall(3.8, 4, 12, 14.2, H);
  for (const s of [-1, 1]) for (let zz = -26; zz <= 0; zz += 6.5) {
    column(B, s * 10.6, 0, zz, { r: 0.55, h: H, color: 0xb0ae9e, mat: 'ruin', fluted: false });
    P.addCyl(s * 10.6, zz, 0.6, 0, H);
    strip(s * 11.9, 5.5, zz + 3.2, 0.15, 3.5);
  }
  // floor mosaic
  const mosaic = runeTile(3, 0x6fd8c8, 1.2, 9);
  mosaic.rotation.x = -Math.PI / 2; mosaic.position.set(0, 0.03, -14); mosaic.material.opacity = 0.35;
  z.add(mosaic);
  z.addTrigger({ minX: -3.2, maxX: 3.2, minZ: 11.5, maxZ: 14, minY: 3.2, onEnter: () => game.travel('city', UC_RETURN.pos.clone(), UC_RETURN.yaw) });
  z.portalTo.city = new THREE.Vector3(0, 4, 12);
  z.spawns.start = { pos: new THREE.Vector3(0, 0, 1.5), yaw: Math.PI };

  // Door A (rune order)
  wall(-12, -30.6, -3.2, -29.4); wall(3.2, -30.6, 12, -29.4);
  B.box('ruin', 0, H - 1.5, -30, 6.6, 3, 1.2, 0, wallC, { collide: true });
  const doorA = makeStoneDoor(z, P, 0, -30, 6.4, H - 3);
  const sockets = [];
  for (let i = 0; i < 3; i++) {
    const r = runeTile([1, 2, 0][i], 0x7fe8d8, 2.6, 1.1);
    r.position.set(-2 + i * 2, 4.3, -29.3); r.material.opacity = 0.15;
    doorA.object.add(r); r.position.z = 0.36; r.position.y = 4.3 - (H - 3) / 2;
    sockets.push(r);
  }
  const order = [1, 2, 0];
  const seq = [];
  const pedestals = [];
  const ped = (glyph, x, zz) => {
    const p = new RunePedestal(game, {
      id: 'ped' + glyph, pos: new THREE.Vector3(x, 0, zz), glyph,
      onHit: (pp) => {
        const f = game.state.flags;
        if (f.ucHall) return;
        seq.push(glyph);
        const ok = seq.every((g, i) => g === order[i]);
        if (!ok) {
          game.after(0.6, () => {
            game.audio.sfx('error');
            game.hud.toast('符文的光熄灭了……顺序似乎不对', 2.6);
            for (const q of pedestals) q.setLit(false);
            seq.length = 0;
            for (const s of sockets) s.material.opacity = 0.15;
          });
          return;
        }
        sockets[seq.length - 1].material.opacity = 1;
        if (seq.length === 3) {
          f.ucHall = true;
          game.after(0.5, () => { doorA.setOpen(true); game.audio.sfx('solve'); game.hud.toast('石门开启了', 2); game.saveGame(); });
        }
        void pp;
      },
    });
    // narrow beam: only the pedestal on the gust axis reacts
    const base = p.onWind.bind(p);
    p.onWind = (info) => {
      const wp = p.windPoint();
      const dx = wp.x - info.origin.x, dz = wp.z - info.origin.z;
      const lat = Math.abs(dx * info.hdir.z - dz * info.hdir.x);
      if (lat > 2.2) return false;
      return base(info);
    };
    z.addEntity(p);
    P.addCyl(x, zz, 0.6, 0, 2.4);
    pedestals.push(p);
    return p;
  };
  ped(0, -7, -12);
  ped(1, 7, -12);
  ped(2, 0, -21);
  // hidden hint panels
  const panel = (x, y, zz, nx, nz, num, sym) => {
    const n = new THREE.Vector3(nx, 0, nz);
    const side = new THREE.Vector3(-nz, 0, nx);
    const a = new HiddenRune(game, { id: 'hint' + num, pos: new THREE.Vector3(x, y, zz).addScaledVector(side, -0.75), glyph: num, size: 1.3, normal: n, radius: 1.6 });
    const b = new HiddenRune(game, { id: 'hintS' + num, pos: new THREE.Vector3(x, y, zz).addScaledVector(side, 0.75), glyph: sym, size: 1.3, normal: n, radius: 1.6, aimable: false });
    z.addEntity(a); z.addEntity(b);
    // backing slab sits between the wall and the runes
    B.box('ruin', x - nx * 0.15, y, zz - nz * 0.15, Math.abs(nz) > 0.5 ? 3.4 : 0.2, 1.8, Math.abs(nx) > 0.5 ? 3.4 : 0.2, 0, 0x8a8e84);
    return [a, b];
  };
  const hints = [
    ...panel(11.75, 3.2, -9.75, -1, 0, 4, 1),
    ...panel(-11.75, 3.2, -9.75, 1, 0, 5, 2),
    ...panel(-6.5, 3.4, -29.3, 0, 1, 6, 0),
  ];
  // braziers
  const brazier = (x, zz) => {
    B.cyl('ruin', x, 0.55, zz, 0.45, 0.35, 1.1, 8, 0x8a8e84, { collide: true });
    B.cyl('metal', x, 1.2, zz, 0.6, 0.4, 0.3, 10, 0x4a4a50);
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), glowMat(0x6fe8ff, 2.2));
    fl.position.set(x, 1.5, zz);
    fl.scale.y = 1.4;
    z.add(fl);
    z.animated.push((dt, t) => {
      fl.scale.set(1 + Math.sin(t * 9 + x) * 0.08, 1.4 + Math.sin(t * 13 + zz) * 0.2, 1);
      if (Math.random() < dt * 10) game.fx.glow.emit({ pos: { x: x + (Math.random() - 0.5) * 0.3, y: 1.6, z: zz + (Math.random() - 0.5) * 0.3 }, vel: { x: 0, y: 1.2 + Math.random(), z: 0 }, life: 0.7, size: 0.35, size2: 0.05, color: new THREE.Color(0x7fe8ff), alpha: 0.9, frame: 0 });
    });
  };
  brazier(-5, 1); brazier(5, 1); brazier(-8, -27); brazier(8, -27);

  // corridor 1
  floor(-3.2, 3.2, -36, -30);
  wall(-3.8, -36, -3.2, -30.6); wall(3.2, -36, 3.8, -30.6);
  ceil(-3.8, 3.8, -36, -30);

  // -------------------------------------------------------------------------
  // ROOM 2 — block puzzle, fan, pit bridge
  floor(-11, 11, PIT.z1, -36);
  floor(-11, 11, -80, PIT.z0);
  ceil(-11.5, 11.5, -80, -36);
  wall(-11.5, -80, -11, -36); wall(11, -80, 11.5, -36);
  wall(-11, -36.6, -3.8, -36); wall(3.8, -36.6, 11, -36);
  // pit walls (visual depth)
  for (const zz of [PIT.z0, PIT.z1]) B.box('ruin', 0, -8, zz + (zz === PIT.z0 ? -0.2 : 0.2), 22, 16, 0.4, 0, darkC);
  B.box('ruin', 0, -16.2, (PIT.z0 + PIT.z1) / 2, 22, 0.4, 12, 0, 0x3a3e3c, { noShadow: true });
  const abyss = new THREE.Mesh(new THREE.PlaneGeometry(22, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x050809 }));
  abyss.position.set(0, -10, (PIT.z0 + PIT.z1) / 2);
  z.add(abyss);
  // block grid
  const blocked = new Set(['2,1', '1,0']);
  const grid = { x0: -5, z0: -47, size: 2, y: 0, w: 5, h: 4, blocked: (i, j) => blocked.has(i + ',' + j), blocks: [] };
  for (let i = 0; i < grid.w; i++) for (let j = 0; j < grid.h; j++) {
    const x = grid.x0 + (i + 0.5) * 2, zz = grid.z0 + (j + 0.5) * 2;
    B.box('ruin', x, 0.04, zz, 1.92, 0.06, 1.92, 0, (i + j) % 2 ? 0xa8a698 : 0x9a988a, { noShadow: true });
    if (grid.blocked(i, j)) { column(B, x, 0, zz, { r: 0.6, h: 2, color: 0x9a9e94, mat: 'ruin', broken: 0.2 }); P.addCyl(x, zz, 0.75, 0, 1.8); }
  }
  // grid outline strips
  strip(0, 0.06, grid.z0 - 0.1, 10.2, 0.12); strip(0, 0.06, grid.z0 + 8.1, 10.2, 0.12);
  strip(grid.x0 - 0.1, 0.06, grid.z0 + 4, 0.12, 8.2); strip(grid.x0 + 10.1, 0.06, grid.z0 + 4, 0.12, 8.2);
  const block = new PushBlock(game, { id: 'ucBlock', grid, i: 0, j: 3, physics: P });
  z.addEntity(block);
  // fan + grate on the east wall
  const fanPos = new THREE.Vector3(10.2, 3.2, -52);
  const fanG = new THREE.Group();
  fanG.position.copy(fanPos);
  const fanRotor = new THREE.Group();
  fanG.add(fanRotor);
  const fanGlow = glowToon(0xb8a070, 0x7fe8d8, { rim: 0.6 });
  const fanStone = toonMat({ color: 0xb0ae9e, map: getTex('ruin'), rim: 0.3 });
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.2, 0.5), fanStone);
    b.position.set(0, Math.cos((i * Math.PI) / 3) * 0.9, Math.sin((i * Math.PI) / 3) * 0.9);
    b.rotation.x = -(i * Math.PI) / 3; b.rotation.y = 0.5;
    fanRotor.add(b);
  }
  const fanRing = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.08, 6, 32), fanGlow);
  fanRing.rotation.y = Math.PI / 2;
  fanG.add(fanRing);
  const fanHub = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), fanGlow);
  fanRotor.add(fanHub);
  mergeGroup(fanRotor);
  z.add(fanG);
  B.box('ruin', 10.8, 3.2, -52, 0.6, 4.2, 4.2, 0, 0x8a8e84);
  const timerRing = new THREE.Mesh(new THREE.RingGeometry(1.75, 1.95, 40), glowMat(0x9ff5e8, 2, { transparent: true, opacity: 0.9, additive: true }));
  timerRing.position.set(fanPos.x - 0.3, fanPos.y, fanPos.z); timerRing.rotation.y = -Math.PI / 2; timerRing.visible = false;
  z.add(timerRing);
  const grateG = new THREE.Group();
  const iron = toonMat({ color: 0x3a3a42, rim: 0.5 });
  for (let i = 0; i < 7; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4, 0.12), iron); b.position.set(0, 0, -1.8 + i * 0.6); grateG.add(b); }
  for (let j = 0; j < 4; j++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 4), iron); b.position.set(0.05, -1.5 + j, 0); grateG.add(b); }
  grateG.position.set(9.3, 3.2, -52);
  mergeGroup(grateG);
  z.add(grateG);
  const grateCol = P.addBox(9.3, 3.2, -52, 0.2, 2, 2);
  const grate = new Door(game, { id: 'ucGrate', object: grateG, colliders: [grateCol], mode: 'up', dist: 4.2, dur: 1.4 });
  z.addEntity(grate);
  const plate = new PressurePlate(game, {
    id: 'ucPlate', pos: new THREE.Vector3(grid.x0 + 9, 0, grid.z0 + 1), size: 1.9, grid, cell: [4, 0], allowPlayer: false,
    onPress: () => { grate.setOpen(true); if (!game.state.flags.ucGrate) { game.hud.toast('铁栅升起了！', 2); } },
    onRelease: () => { if (!game.state.flags.ucGrate) grate.setOpen(false); },
  });
  z.addEntity(plate);
  // floating bridge slabs
  const slabs = [];
  const slabMat = toonMat({ color: 0xc8c6b6, map: getTex('ruin'), rim: 0.3, emissive: 0x7fe8d8, emissiveIntensity: 0.3 });
  for (let i = 0; i < 5; i++) {
    const zz = PIT.z1 - 1.2 - i * 2.4;
    const m = new THREE.Mesh(new THREE.BoxGeometry(4, 0.6, 2.3), slabMat);
    m.castShadow = true; m.receiveShadow = true;
    m.position.set(0, -7, zz);
    z.add(m);
    const col = P.addBox(0, -0.3, zz, 2, 0.3, 1.15, 0, { enabled: false });
    const r = runeTile(14, 0x7fe8d8, 1.8, 1.8);
    r.rotation.x = -Math.PI / 2; r.position.y = 0.31; r.material.opacity = 0.6;
    m.add(r);
    slabs.push({ m, col, k: 0 });
  }
  let bridgeUp = false;
  const fan = new Spinner(game, {
    id: 'ucFan', object: fanG, rotor: fanRotor, axis: 'x', pos: fanPos.clone(), radius: 1.8, maxSpeed: 12, impulse: 12, decay: 2, threshold: 6, activeTime: 16,
    glowMats: [fanGlow], glowMax: 2.2, ring: timerRing, locked: () => !grate.open,
    onActivate: () => { game.hud.toast('风扇转动，石板浮了起来！快过桥！', 2.6); game.audio.sfx('activate'); },
  });
  fan.onLockedHit = () => game.hud.toast('铁栅挡住了风扇……得先把它打开', 2.4);
  z.addEntity(fan);
  // PushBlock onMoved -> nothing extra; plate handles it
  z.addTrigger({ minX: -11, maxX: 11, minZ: -80, maxZ: PIT.z0 - 1, onEnter: () => { const f = game.state.flags; if (!f.ucCrossed) { f.ucCrossed = true; f.ucGrate = true; game.saveGame(); } } });
  z.animated.push((dt, t) => {
    const f = game.state.flags;
    bridgeUp = fan.active || f.ucCrossed;
    slabs.forEach((s, i) => {
      const target = bridgeUp ? 1 : 0;
      const delay = i * 0.12;
      s.k = clamp(s.k + (target ? dt / (0.8 + delay) : -dt / 1.2), 0, 1);
      let y = lerp(-7, -0.3, easeInOut(s.k));
      if (!f.ucCrossed && fan.active && fan.timer < 3) y += Math.sin(t * 40 + i) * 0.04;
      s.m.position.y = y;
      s.col.enabled = s.k > 0.92;
    });
  });
  z.hazard = (p) => p.z > PIT.z0 - 0.3 && p.z < PIT.z1 + 0.3 && p.y < -3;
  z.unsafe = (p) => p.z > PIT.z0 - 1.5 && p.z < PIT.z1 + 1.5;
  // far landing + Door B
  wall(-11, -80.6, -2.6, -80); wall(2.6, -80.6, 11, -80);
  B.box('ruin', 0, H - 1.5, -80.3, 5.4, 3, 0.6, 0, wallC, { collide: true });
  const doorB = makeStoneDoor(z, P, 0, -80.3, 5.2, H - 3);
  doorB.setOpen(true, true);
  brazier(-7, -76); brazier(7, -76); brazier(-7, -40); brazier(7, -40);

  // corridor 2
  floor(-2.6, 2.6, -84.5, -80.6);
  wall(-3.2, -84.5, -2.6, -80.6); wall(2.6, -84.5, 3.2, -80.6);
  ceil(-3.2, 3.2, -84.5, -80.6);

  // -------------------------------------------------------------------------
  // ROOM 3 — core chamber (round)
  {
    const g = planarUV(new THREE.CircleGeometry(CORE_R, 48).rotateX(-Math.PI / 2));
    B.add('flag', g, mat4(CORE.x, 0.01, CORE.z), floorC, { noShadow: true });
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = CORE.x + Math.cos(a) * (CORE_R + 0.5), zz = CORE.z + Math.sin(a) * (CORE_R + 0.5);
      // leave the entrance (south, +z) open
      if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.12) continue;
      B.box('ruin', x, H / 2 + 1, zz, 1.2, H + 2, (2 * Math.PI * (CORE_R + 0.5)) / n + 0.3, -a, wallC, { collide: true, ao: 3 });
    }
    B.add('ruin', cylGeo(CORE_R + 1, CORE_R + 1, 1, 32), mat4(CORE.x, H + 1.5, CORE.z), darkC, { noShadow: true });
    // skylight shaft glow in the ceiling
    const shaftBeam = makeBeam(0xcff8ff, 11, 3.5);
    shaftBeam.position.set(CORE.x, 0, CORE.z);
    shaftBeam.material.uniforms.uOpacity.value = 0.12;
    z.add(shaftBeam);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2; strip(CORE.x + Math.cos(a) * (CORE_R - 0.4), 5, CORE.z + Math.sin(a) * (CORE_R - 0.4), 2.5, 0.15, -a + Math.PI / 2); }
  }
  // core machine
  const core = buildCore(z, B, P, game);
  // T1 floor turbine (west)
  const makeTurbine = (id, pos, axis, facingRy) => {
    const g = new THREE.Group();
    g.position.copy(pos);
    g.rotation.y = facingRy;
    const rot = new THREE.Group();
    g.add(rot);
    const glow = glowToon(0xb8a070, 0x7fe8d8, { rim: 0.6 });
    const stoneM = toonMat({ color: 0xb8b6a6, map: getTex('ruin'), rim: 0.3 });
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.55), stoneM);
      const a = (i / 5) * Math.PI * 2;
      b.position.set(Math.cos(a) * 0.95, Math.sin(a) * 0.95, 0);
      b.rotation.z = a; b.rotation.x = 0.5;
      b.castShadow = true;
      rot.add(b);
    }
    rot.add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), glow));
    mergeGroup(rot);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.09, 6, 36), glow);
    g.add(ring);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.2, 0.5), stoneM);
    frame.position.set(0, -1.9, -0.4); g.add(frame);
    const tRing = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.15, 40), glowMat(0x9ff5e8, 2, { transparent: true, opacity: 0.9, additive: true }));
    tRing.position.z = 0.25; tRing.visible = false;
    g.add(tRing);
    z.add(g);
    const sp = new Spinner(game, {
      id, object: g, rotor: rot, axis: 'z', pos: pos.clone(), radius: 1.8, maxSpeed: 11, impulse: 11, decay: 2, threshold: 6, activeTime: 25,
      glowMats: [glow], glowMax: 2.2, ring: tRing,
      locked: () => !game.state.flags.ucArena,
      onActivate: () => { game.audio.sfx('activate'); core.check(); },
      onDeactivate: () => { game.audio.sfx('error'); },
    });
    sp.onLockedHit = () => game.hud.toast('风轮被某种力量封住了……先击败守卫！', 2.4);
    z.addEntity(sp);
    return sp;
  };
  const T1 = makeTurbine('T1', new THREE.Vector3(CORE.x - 14.5, 3.2, CORE.z), 'z', Math.PI / 2);
  B.box('ruin', CORE.x - 15.4, 1.5, CORE.z, 1.4, 3, 3.2, 0, 0x8a8e84, { collide: true });
  // T2 on the east ledge (climb up)
  B.box('ruin', 13.2, 2.6, -108, 7, 5.2, 12, 0, 0x9a9e94, { collide: true, ao: 3 });
  const ivy = new THREE.Mesh(planeGeo(5.4, 5), M('ivy'));
  ivy.position.set(9.66, 2.55, -106.5); ivy.rotation.y = -Math.PI / 2;
  z.add(ivy);
  z.addClimb({ x: 9.7, z: -106.5, nx: -1, nz: 0, w: 5.4, y0: 0, y1: 5.2, topY: 5.2 });
  const T2 = makeTurbine('T2', new THREE.Vector3(14.5, 8.4, -110), 'z', -Math.PI / 2 + 0.35);
  // T3 caged in the north alcove, fed by a duct
  B.box('ruin', 0, 3.5, -121.6, 7, 7, 1, 0, 0x8a8e84, { collide: true });
  const T3 = makeTurbine('T3', new THREE.Vector3(0, 3.6, -120.3), 'z', 0);
  const bars = new THREE.Group();
  for (let i = 0; i < 9; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 6, 0.12), iron); b.position.set(-2.4 + i * 0.6, 3, 0); bars.add(b); }
  bars.position.set(0, 0, -118.6);
  mergeGroup(bars);
  z.add(bars);
  P.addBox(0, 3, -118.6, 2.6, 3, 0.2);
  for (const s of [-1, 1]) B.box('ruin', s * 3.1, 3.5, -120, 0.8, 7, 3.4, 0, 0x8a8e84, { collide: true });
  T3.aimable = false;
  // the bars block direct gusts: T3 only turns with wind arriving through the duct
  const t3Wind = T3.onWind.bind(T3);
  let barsHint = false;
  T3.onWind = (info) => {
    if (!info.fromDuct) { if (!barsHint) { barsHint = true; game.hud.toast('铁栏挡住了风……也许有别的通风口？', 2.6); } return false; }
    return t3Wind(info);
  };
  const inlet = new THREE.Vector3(-8, 1.1, -114);
  B.box('ruin', inlet.x, 0.9, inlet.z - 0.6, 2.4, 1.8, 1.2, 0.5, 0x8a8e84, { collide: true });
  const mouth = runeTile(12, 0x9ff5e8, 1.6, 1.4);
  mouth.position.set(inlet.x + Math.sin(0.5) * 0.02, 1.0, inlet.z + 0.02); mouth.rotation.y = 0.5; mouth.material.opacity = 0.5;
  z.add(mouth);
  const ductPts = [inlet.clone(), new THREE.Vector3(-8.5, 4.5, -116.5), new THREE.Vector3(-4, 6.2, -119.5), new THREE.Vector3(0, 3.8, -120.2)];
  const curve = new THREE.CatmullRomCurve3(ductPts);
  const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.45, 8, false), toonMat({ color: 0x8a8e84, map: getTex('ruin'), rim: 0.25 }));
  pipe.castShadow = true;
  z.add(pipe);
  const duct = new WindDuct(game, { id: 'duct', pos: inlet, path: ductPts, target: T3, radius: 1.4 });
  const ductWind = duct.onWind.bind(duct);
  duct.onWind = (info) => { if (!game.state.flags.ucArena) { game.hud.toast('风道被某种力量封住了……先击败守卫！', 2.4); return false; } return ductWind(info); };
  z.addEntity(duct);
  core.turbines = [T1, T2, T3];

  // arena
  const arena = { started: false, enemies: [] };
  z.addTrigger({
    x: CORE.x, z: CORE.z, r: CORE_R - 3,
    onEnter: () => {
      const f = game.state.flags;
      if (f.ucArena || arena.started) return;
      arena.started = true;
      doorB.setOpen(false);
      game.quest.refresh();
      game.hud.setObjective('击败守护风之心的魔物', true);
      game.audio.sfx('rumble');
      const spots = [[-6, -96, 'h'], [6, -96, 'h'], [0, -110, 'w']];
      spots.forEach(([x, zz, t], i) => game.after(0.6 + i * 0.5, () => {
        const pos = new THREE.Vector3(x, 0, zz);
        game.fx.poof(pos, 0x4a2e5a, 20);
        const e = t === 'h' ? new Haniwa(game, z, { id: null, pos, yaw: 0, variant: 1, aggro: 40, leash: 40, permanent: false }) : new Wisp(game, z, { id: null, pos: pos.clone().setY(2), aggro: 40, leash: 40, permanent: false });
        e.onDeath = () => {
          arena.enemies = arena.enemies.filter((q) => q !== e);
          if (!arena.enemies.length) {
            f.ucArena = true;
            doorB.setOpen(true);
            game.audio.sfx('solve');
            game.quest.set('core');
            game.hud.toast('守卫被击退了！风轮的封印解除', 3);
            game.saveGame();
          }
        };
        arena.enemies.push(e);
        z.addEnemy(e);
      }));
    },
  });
  z.resetEnemies = () => {
    // on death inside the arena: clear and allow a retry
    for (const e of z.enemies) { if (e.object.parent) e.object.parent.remove(e.object); }
    z.enemies.length = 0;
    arena.enemies.length = 0;
    arena.started = false;
    if (!game.state.flags.ucArena) doorB.setOpen(true, true);
  };
  z.checkpoint = () => {
    const f = game.state.flags;
    if (f.ucCrossed) return { pos: new THREE.Vector3(0, 0, -74), yaw: Math.PI };
    if (f.ucHall) return { pos: new THREE.Vector3(0, 0, -38), yaw: Math.PI };
    return z.spawns.start;
  };

  // marks
  z.marks.next = () => {
    const f = game.state.flags;
    if (!f.ucHall) {
      // guide toward undiscovered hint panels, never straight to the answer
      const hidden = hints.find((h) => !h.revealed && h.aimable !== false);
      return hidden ? hidden.pos.clone().setY(0) : new THREE.Vector3(0, 0, -24);
    }
    if (!f.ucCrossed) {
      if (!grate.open && !plate.pressed) return block.pos.clone().setY(0);
      if (!fan.active) return fanPos.clone().setY(1);
      return new THREE.Vector3(0, 0, -70);
    }
    return CORE.clone();
  };
  z.marks.core = () => {
    const f = game.state.flags;
    if (!f.ucArena) return CORE.clone();
    if (core.open) return CORE.clone();
    const t = core.turbines.find((q) => !q.active);
    if (t === T3) return inlet.clone().setY(0);
    if (t) return t.pos.clone().setY(t === T2 ? 5.2 : 0);
    return CORE.clone();
  };

  B.build(z.scene);
  const runeStripMat = M('runeStrip');
  z.animated.push((dt, t) => { runeStripMat.color.setRGB(0.5, 1.0, 0.92).multiplyScalar(1.8 + Math.sin(t * 1.5) * 0.4); });

  z.applyState = (s) => {
    const f = s.flags;
    if (f.ucHall) { doorA.setOpen(true, true); for (const p of pedestals) p.setLit(true); for (const sk of sockets) sk.material.opacity = 1; for (const h of hints) h.reveal(true); }
    if (f.ucCrossed) { grate.setOpen(true, true); for (const sl of slabs) { sl.k = 1; } }
    if (f.coreActive) core.setOpen(true, true);
  };
  z.onEnter = () => {
    if (game.state.stage === 'temple' || game.state.stage === 'return_city') game.quest.set('undercroft');
    if (!game.state.flags.ucHall) game.after(2.5, () => game.hud.toast('石门上有三个符文凹槽……墙上似乎也刻着什么，用风吹一吹？', 4));
  };
  z.core = core;
  return z;
}

// sliding stone door (up)
function makeStoneDoor(z, P, x, zz, w, h) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.7), toonMat({ color: 0xb4b2a2, map: getTex('ruin'), rim: 0.3 }));
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  const r = runeTile(3, 0x7fe8d8, 1.6, Math.min(w, h) * 0.55);
  r.position.set(0, 0.6, 0.36); r.material.opacity = 0.35;
  g.add(r);
  const r2 = r.clone(); r2.position.z = -0.36; r2.rotation.y = Math.PI; g.add(r2);
  g.position.set(x, h / 2, zz);
  z.add(g);
  const col = P.addBox(x, h / 2, zz, w / 2, h / 2, 0.35);
  const d = new Door(z.game, { id: 'door', object: g, colliders: [col], mode: 'up', dist: h - 0.3, dur: 2.2 });
  z.addEntity(d);
  return d;
}

// ---------------------------------------------------------------------------
function buildCore(z, B, P, game) {
  const g = new THREE.Group();
  g.position.copy(CORE);
  z.add(g);
  B.add('ruin', cylGeo(4.2, 4.8, 0.8, 24), mat4(CORE.x, 0.4, CORE.z), 0xa8a698);
  B.add('ruin', cylGeo(3.2, 3.6, 0.7, 24), mat4(CORE.x, 1.15, CORE.z), 0xb4b2a2);
  P.addCyl(CORE.x, CORE.z, 3.4, 0, 1.5);
  P.addCyl(CORE.x, CORE.z, 4.5, 0, 0.8);
  const stoneM = toonMat({ color: 0xc8c6b6, map: getTex('ruin'), rim: 0.35, emissive: 0x7fe8d8, emissiveIntensity: 0 });
  const petals = [];
  for (let i = 0; i < 4; i++) {
    const pg = new THREE.Group();
    pg.rotation.y = (i * Math.PI) / 2;
    pg.position.y = 1.5;
    // quarter dome centred on +z so the hinge at z=+1.6 is its outer edge
    const petal = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12, Math.PI / 4, Math.PI / 2, 0, Math.PI / 2 + 0.3), stoneM);
    petal.material.side = THREE.DoubleSide;
    petal.castShadow = true;
    const hinge = new THREE.Group();
    hinge.position.set(0, 0, 1.6);
    petal.position.set(0, 0, -1.6);
    hinge.add(petal);
    pg.add(hinge);
    g.add(pg);
    petals.push(hinge);
  }
  const heart = crystalObject(1.4);
  heart.position.y = 3.2;
  heart.visible = false;
  g.add(heart);
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(3 + i * 0.9, 0.12, 8, 48), glowToon(0xd9ad4f, 0x9ff5e8, { rim: 0.8 }));
    r.position.y = 3.2;
    r.rotation.x = Math.PI / 2 + i * 0.4;
    g.add(r);
    rings.push(r);
  }
  const beam = makeBeam(0x9ff5e8, 60, 2.2);
  beam.position.set(CORE.x, 1.5, CORE.z);
  beam.visible = false;
  z.add(beam);
  const coreCol = P.addCyl(CORE.x, CORE.z, 2.4, 1.5, 4.5);
  let openK = 0;
  const api = {
    open: false, turbines: [],
    check() {
      if (api.open) return;
      if (api.turbines.length && api.turbines.every((t) => t.active)) {
        api.open = true;
        game.audio.sfx('solve');
        game.hud.toast('三座风轮同时转动——天鸣之心开启了！', 3);
        game.cutscene([{ pos: [CORE.x + 9, 5, CORE.z + 9], pos2: [CORE.x + 7, 6, CORE.z + 7], look: [CORE.x, 2.5, CORE.z], look2: [CORE.x, 3, CORE.z], dur: 3.2 }]);
      }
    },
    setOpen(v, instant = false) { api.open = v; if (instant) openK = v ? 1 : 0; },
  };
  z.animated.push((dt, t) => {
    openK = clamp(openK + (api.open ? dt / 2.5 : -dt / 2), 0, 1);
    const e = easeInOut(openK);
    for (const h of petals) h.rotation.x = e * 1.1;
    stoneM.emissiveIntensity = 0.2 + e * 0.8;
    const f = game.state.flags;
    const on = f.coreActive;
    rings.forEach((r, i) => { r.rotation.z += dt * (0.2 + i * 0.1) * (on ? 4 : 1); r.material.emissiveIntensity = on ? 2.4 : e * 0.8; });
    heart.visible = on;
    beam.visible = on;
    coreCol.enabled = !api.open;
    // turbines losing sync while not all active: nothing else to do
  });
  z.addEntity(new Interactable(game, {
    id: 'coreSocket', pos: new THREE.Vector3(CORE.x, 1.5, CORE.z + 2.6), radius: 4.2,
    can: () => api.open && !game.state.flags.coreActive,
    prompt: '将风之结晶放入天鸣之心',
    act: () => runEnding(game),
  }));
  return api;
}

// ---------------------------------------------------------------------------
export function runEnding(game) {
  const f = game.state.flags;
  if (f.coreActive) return;
  f.coreActive = true;
  f.ending = true;
  game.quest.set('free', false);
  game.controlEnabled = false;
  const uc = game.zones.undercroft;
  game.audio.sfx('core');
  game.cineBars.classList.add('on');
  playHeld(game, [
    { pos: [CORE.x + 8, 3, CORE.z + 8], pos2: [CORE.x + 5, 4, CORE.z + 5], look: [CORE.x, 3, CORE.z], look2: [CORE.x, 4, CORE.z], dur: 2.6, onStart: () => { game.fx.sparkle(new THREE.Vector3(CORE.x, 3.2, CORE.z), 0xbff8ee, 60, 2, 3); game.cam.shake(0.5); } },
    { pos: [CORE.x + 5, 4, CORE.z + 5], pos2: [CORE.x + 2, 2, CORE.z + 12], look: [CORE.x, 4, CORE.z], look2: [CORE.x, 30, CORE.z], dur: 2.2, onStart: () => game.engine.post.uFlash.value = 0.0 },
  ], () => {
    game.fadeTo(1, 0.8, () => {
      game.mode = 'ending';
      game.player.avatar.setVisible(false);
      game.setZone('city');
      game.zones.city.applyState(game.state);
      game.audio.setMusic('ending');
      game.fadeTo(0, 1.0);
      game.zones.city.playEnding(() => {
        game.fadeTo(1, 0.8, () => {
          game.setZone('wilds');
          game.zones.wilds.env = Object.assign({}, game.zones.wilds.env);
          game.zones.wilds.lerpEnv(ENV_SUNSET, 0.7);
          game.zones.wilds.applyState(game.state);
          game.audio.setMusic('ending');
          game.fadeTo(0, 1.0);
          game.zones.wilds.playEnding(() => {
            game.fadeTo(1, 1.2, () => {
              game.cineBars.classList.remove('on');
              game.menus.showEnding(true, game.state.stats);
              game.input.exitLock();
              game.fadeTo(0, 1.0, null, '#000');
              game.saveGame();
            }, '#fff');
          });
        }, '#fff');
      });
    }, '#fff');
  });
  void uc;
}

export function afterEnding(game) {
  // golden afternoon for free exploration
  const warm = (env) => { const out = Object.assign({}, env); for (const k of Object.keys(ENV_SUNSET)) { const a = ENV_DAY[k], b = ENV_SUNSET[k]; if (typeof a === 'number' && typeof b === 'number' && /(zenith|fog$|fogSun|ground|sunColor|hemiSky|hemiGround|cloudLit|cloudShade|sunDisk)/.test(k)) out[k] = new THREE.Color(a).lerp(new THREE.Color(b), 0.45).getHex(); else if (Array.isArray(b)) out[k] = ENV_DAY[k].map((x, i) => x + (b[i] - x) * 0.45); else if (typeof b === 'number') out[k] = a + (b - a) * 0.45; } return out; };
  game.zones.city.env = warm(game.zones.city.env);
  game.zones.wilds.env = warm(game.zones.wilds.env);
}
export { ENV_DAY };
