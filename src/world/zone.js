// Base class for a playable map (city / wilds / undercroft).
import * as THREE from 'three';
import { Physics } from '../game/physics.js';
import { Sky, SunRig } from '../gfx/sky.js';
import { U } from '../gfx/materials.js';

export const ENV_DAY = {
  zenith: 0x3d8ee0, fog: 0xc3dff2, fogSun: 0xfff0d6, ground: 0x9fb4c4, fogDensity: 0.0032, fogStart: 30, fogHeight: 0.01, fogBase: -12, fogMax: 0.93,
  sunDir: [-0.42, 0.66, 0.62], sunColor: 0xfff0dc, sunIntensity: 1.8, hemiSky: 0xbad4f2, hemiGround: 0x9a8e70, hemiIntensity: 1.8,
  cloud: 0.55, cloudLit: 0xffffff, cloudShade: 0xc4d3ea, sunDisk: 0xfff1d0, exposure: 1.0, sat: 1.1, bloom: 0.55, wind: [0.85, 0.35], mountains: true,
};

export class Zone {
  constructor(game, id, cfg) {
    this.game = game;
    this.id = id;
    this.name = cfg.name || id;
    this.subtitle = cfg.subtitle || '';
    this.scene = new THREE.Scene();
    this.physics = new Physics(cfg.ground);
    this.env = Object.assign({}, ENV_DAY, cfg.env || {});
    this.sky = new Sky({ zenith: this.env.zenith, ground: this.env.ground, cloud: this.env.cloud, cloudLit: this.env.cloudLit, cloudShade: this.env.cloudShade, sunDisk: this.env.sunDisk, mountains: this.env.mountains });
    this.scene.add(this.sky.group);
    this.sun = new SunRig({ color: this.env.sunColor, intensity: this.env.sunIntensity, hemiSky: this.env.hemiSky, hemiGround: this.env.hemiGround, hemiIntensity: this.env.hemiIntensity, range: cfg.shadowRange || 44, mapSize: game.engine.q.shadow });
    this.sun.addTo(this.scene);
    this.entities = [];
    this.enemies = [];
    this.npcs = [];
    this.interactables = [];
    this.windReceivers = [];
    this.triggers = [];
    this.climbs = [];
    this.breakables = [];
    this.animated = [];
    this.spawns = {};
    this.surface = cfg.surface || 'stone';
    this.killY = cfg.killY !== undefined ? cfg.killY : -80;
    this.bounds = cfg.bounds || { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
    this.mapCanvas = null;
    this.camMaxDist = cfg.camMaxDist || 11;
    this.ambientWind = cfg.ambientWind !== undefined ? cfg.ambientWind : 0.6;
    this.music = cfg.music || id;
    this.time = 0;
  }

  add(o) { this.scene.add(o); return o; }

  addEntity(e) {
    e.zone = this;
    this.entities.push(e);
    if (e.onWind) this.windReceivers.push(e);
    if (e.interact) this.interactables.push(e);
    if (e.object && !e.object.parent) this.scene.add(e.object);
    return e;
  }
  removeEntity(e) {
    const rm = (arr) => { const i = arr.indexOf(e); if (i >= 0) arr.splice(i, 1); };
    rm(this.entities); rm(this.windReceivers); rm(this.interactables);
    if (e.object && e.object.parent) e.object.parent.remove(e.object);
  }
  addEnemy(e) { e.zone = this; this.enemies.push(e); if (e.object) this.scene.add(e.object); return e; }
  addNPC(n) { n.zone = this; this.npcs.push(n); this.interactables.push(n); this.scene.add(n.avatar.root); return n; }

  // box trigger {minX,maxX,minZ,maxZ,minY,maxY} or sphere {x,y,z,r}
  addTrigger(t) { t.inside = false; this.triggers.push(t); return t; }

  // climb surface: base centre (x,z), outward normal (nx,nz), width, y0..y1 climbable, topY walkable top
  addClimb(c) {
    const l = Math.hypot(c.nx, c.nz); c.nx /= l; c.nz /= l;
    c.rx = c.nz; c.rz = -c.nx;
    this.climbs.push(c);
    return c;
  }

  applyEnv() {
    const e = this.env;
    U.uSunDir.value.set(...e.sunDir).normalize();
    U.uFogColor.value.set(e.fog);
    U.uFogSunColor.value.set(e.fogSun);
    U.uFogDensity.value = e.fogDensity;
    U.uFogStart.value = e.fogStart;
    U.uFogHeight.value = e.fogHeight;
    U.uFogBase.value = e.fogBase;
    U.uFogMax.value = e.fogMax;
    U.uWind.value.set(e.wind[0], e.wind[1]);
    this.sun.light.color.set(e.sunColor);
    this.sun.light.intensity = e.sunIntensity;
    this.sun.hemi.color.set(e.hemiSky);
    this.sun.hemi.groundColor.set(e.hemiGround);
    this.sun.hemi.intensity = e.hemiIntensity;
    this.sun.syncUniforms();
    const su = this.sky.uniforms;
    su.uZenith.value.set(e.zenith);
    su.uGround.value.set(e.ground);
    su.uCloud.value = e.cloud;
    su.uCloudLit.value.set(e.cloudLit);
    su.uCloudShade.value.set(e.cloudShade);
    su.uSunDisk.value.set(e.sunDisk);
    const P = this.game.engine.post;
    P.uExposure.value = e.exposure;
    P.uSat.value = e.sat;
    P.uBloom.value = e.bloom;
  }

  // blend environment toward another env preset (used by ending sunset)
  lerpEnv(target, k) {
    const a = this.env, out = {};
    for (const key of Object.keys(target)) {
      const va = a[key], vb = target[key];
      if (typeof vb === 'number' && typeof va === 'number' && key.match(/(zenith|fog$|fogSun|ground|sunColor|hemiSky|hemiGround|cloudLit|cloudShade|sunDisk)/)) {
        out[key] = new THREE.Color(va).lerp(new THREE.Color(vb), k).getHex();
      } else if (typeof vb === 'number' && typeof va === 'number') out[key] = va + (vb - va) * k;
      else if (Array.isArray(vb)) out[key] = va.map((x, i) => x + (vb[i] - x) * k);
      else out[key] = vb;
    }
    const saved = this.env;
    this.env = Object.assign({}, saved, out);
    this.applyEnv();
    this.env = saved;
  }

  onEnter() {}
  onExit() {}

  updateTriggers(p) {
    for (const t of this.triggers) {
      if (t.enabled === false) continue;
      let inside;
      if (t.r !== undefined) {
        const dx = p.x - t.x, dy = p.y - (t.y !== undefined ? t.y : p.y), dz = p.z - t.z;
        inside = dx * dx + dy * dy + dz * dz < t.r * t.r;
      } else {
        inside = p.x >= t.minX && p.x <= t.maxX && p.z >= t.minZ && p.z <= t.maxZ &&
          (t.minY === undefined || p.y >= t.minY) && (t.maxY === undefined || p.y <= t.maxY);
      }
      if (inside && !t.inside) { t.inside = true; if (t.onEnter) t.onEnter(t); if (t.once) t.enabled = false; }
      else if (!inside && t.inside) { t.inside = false; if (t.onExit) t.onExit(t); }
      if (inside && t.onStay) t.onStay(t);
    }
  }

  update(dt) {
    this.time += dt;
    for (const e of this.entities) if (e.update) e.update(dt);
    for (const a of this.animated) a(dt, this.time);
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update(dt);
      if (e.removeMe) { if (e.object && e.object.parent) e.object.parent.remove(e.object); this.enemies.splice(i, 1); }
    }
    for (const n of this.npcs) n.update(dt);
  }

  // top-down snapshot for the minimap (north = -z up)
  buildMap(res = 1024) {
    const b = this.bounds;
    const w = b.maxX - b.minX, h = b.maxZ - b.minZ;
    const aspect = w / h;
    const W = aspect >= 1 ? res : Math.round(res * aspect);
    const H = aspect >= 1 ? Math.round(res / aspect) : res;
    const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 1, 1200);
    cam.up.set(0, 0, -1);
    cam.position.set((b.minX + b.maxX) / 2, 500, (b.minZ + b.maxZ) / 2);
    cam.lookAt(cam.position.x, 0, cam.position.z);
    const hideList = [];
    this.scene.traverse((o) => { if (o.userData.noMap && o.visible) { hideList.push(o); o.visible = false; } });
    this.sky.group.visible = false;
    const saved = { d: U.uFogDensity.value };
    U.uFogDensity.value = 0;
    const sunSaved = this.sun.light.castShadow;
    this.sun.light.castShadow = false;
    const buf = this.game.engine.snapshot(this.scene, cam, W, H);
    this.sun.light.castShadow = sunSaved;
    U.uFogDensity.value = saved.d;
    this.sky.group.visible = true;
    for (const o of hideList) o.visible = true;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4, dst = y * W * 4;
      for (let x = 0; x < W * 4; x += 4) {
        // parchment tint
        const r = buf[src + x], g = buf[src + x + 1], bb = buf[src + x + 2];
        const l = 0.3 * r + 0.59 * g + 0.11 * bb;
        img.data[dst + x] = r * 0.7 + l * 0.18 + 30;
        img.data[dst + x + 1] = g * 0.7 + l * 0.18 + 24;
        img.data[dst + x + 2] = bb * 0.62 + l * 0.14 + 10;
        img.data[dst + x + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.mapCanvas = c;
    return c;
  }
}
