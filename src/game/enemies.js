// Enemies: Haniwa clay guardian (melee) and Wisp mist spirit (ranged, wind-only).
import * as THREE from 'three';
import { toonMat, glowMat } from '../gfx/materials.js';
import { makeMaskTexture } from '../gfx/textures.js';
import { Body } from './physics.js';
import { clamp, lerp, dampAngle, wrapAngle } from '../core/util.js';
import { Pickup, heartObject } from './entities.js';
import { mergeGroup } from '../world/geom.js';

const _v = new THREE.Vector3();
let maskTex = null;

function healthBar() {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.1), new THREE.MeshBasicMaterial({ color: 0x1a1216, transparent: true, opacity: 0.8, depthTest: false }));
  const fg = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.06), new THREE.MeshBasicMaterial({ color: 0xe8443a, depthTest: false }));
  fg.position.z = 0.001;
  bg.renderOrder = 40; fg.renderOrder = 41;
  g.add(bg, fg);
  g.userData.fg = fg;
  g.visible = false;
  return g;
}

function alertSprite() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#ffd24a'; x.strokeStyle = '#3a1a10'; x.lineWidth = 6;
  x.font = 'bold 54px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.strokeText('!', 32, 34); x.fillText('!', 32, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(0.6, 0.6, 0.6);
  s.renderOrder = 42;
  s.visible = false;
  return s;
}

class Enemy {
  constructor(game, zone, o) {
    this.game = game;
    this.zone = zone;
    this.id = o.id || null;
    this.home = o.pos.clone();
    this.pos = new THREE.Vector3().copy(o.pos);
    this.facing = o.yaw || 0;
    this.alive = true;
    this.state = 'idle';
    this.stateT = 0;
    this.object = new THREE.Group();
    this.hpBar = healthBar();
    this.alert = alertSprite();
    this.object.add(this.hpBar, this.alert);
    this.hurtFlash = 0;
    this.onDeath = o.onDeath || null;
    this.permanent = o.permanent !== false;
    this.aggroRange = o.aggro || 12;
    this.leash = o.leash || 24;
    this.mats = [];
  }
  aimPoint() { return _v.set(this.pos.x, this.pos.y + 1, this.pos.z); }
  setState(s) { this.state = s; this.stateT = 0; }
  distToPlayer() { const p = this.game.player.pos; return Math.hypot(p.x - this.pos.x, p.z - this.pos.z); }
  playerYaw() { const p = this.game.player.pos; return Math.atan2(p.x - this.pos.x, p.z - this.pos.z); }
  updateBar(camera) {
    if (!this.hpBar.visible) return;
    this.hpBar.quaternion.copy(camera.quaternion);
    const k = Math.max(0, this.hp / this.maxHp);
    this.hpBar.userData.fg.scale.x = Math.max(0.001, k);
    this.hpBar.userData.fg.position.x = -(1 - k) * 0.43;
  }
  flash(dt) {
    if (this.hurtFlash > 0) {
      this.hurtFlash -= dt;
      const k = Math.max(0, this.hurtFlash) * 6;
      for (const m of this.mats) { m.emissive.setRGB(1, 0.9, 0.8); m.emissiveIntensity = k; }
    }
  }
  die() {
    if (!this.alive) return;
    this.alive = false;
    const g = this.game;
    g.state.stats.kills++;
    if (this.id && this.permanent) g.state.done[this.id] = true;
    g.audio.sfx('enemyDie');
    g.fx.poof(this.pos, this.poofColor || 0x5a3a7a, 18);
    if (Math.random() < (this.dropChance !== undefined ? this.dropChance : 0.5)) {
      const h = new Pickup(g, { kind: 'heart', pos: this.pos.clone().setY(this.pos.y + 0.6), object: heartObject(), life: 25 });
      this.zone.addEntity(h);
    }
    this.object.visible = false;
    this.removeMe = true;
    if (this.onDeath) this.onDeath(this);
  }
  resetToHome() {
    if (!this.alive) return;
    this.pos.copy(this.home);
    this.hp = this.maxHp;
    this.hpBar.visible = false;
    this.setState('idle');
    if (this.body) { this.body.pos.copy(this.home); this.body.vel.set(0, 0, 0); }
  }
}

// ---------------------------------------------------------------------------
export class Haniwa extends Enemy {
  constructor(game, zone, o) {
    super(game, zone, o);
    this.maxHp = o.hp || 4;
    this.hp = this.maxHp;
    this.radius = 0.55;
    this.body = new Body(zone.physics, { radius: 0.5, height: 1.5, stepUp: 0.4, gravity: 25 });
    this.body.pos.copy(o.pos);
    this.pos = this.body.pos;
    this.hopT = Math.random() * 3;
    this.wanderT = 1 + Math.random() * 3;
    this.wanderTarget = this.home.clone();
    this.poofColor = 0x7a4a36;
    this.build(o.variant || 0);
    this.stun = 0;
    this.tilt = 0;
    this.hitDone = false;
    this.speedMul = o.speed || 1;
  }
  build(variant) {
    const clay = toonMat({ color: variant ? 0xb87a58 : 0xcf8a5c, rim: 0.35, band: [-0.05, 0.12], variation: [0.08, 3] });
    const dark = toonMat({ color: 0x8a4e34, rim: 0.2 });
    this.mats.push(clay, dark);
    const g = this.model = new THREE.Group();
    this.object.add(g);
    const lath = (pts, seg = 16) => new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg);
    const body = new THREE.Mesh(lath([[0.001, 0], [0.42, 0.0], [0.4, 0.12], [0.3, 0.35], [0.27, 0.7], [0.29, 0.95], [0.001, 0.97]]), clay);
    body.castShadow = true; g.add(body);
    for (const y of [0.18, 0.62]) { const band = new THREE.Mesh(new THREE.TorusGeometry(y < 0.3 ? 0.36 : 0.28, 0.025, 6, 20), dark); band.rotation.x = Math.PI / 2; band.position.y = y; g.add(band); }
    this.head = new THREE.Group();
    this.head.position.y = 0.97;
    g.add(this.head);
    const head = new THREE.Mesh(lath([[0.001, 0], [0.2, 0.0], [0.24, 0.2], [0.22, 0.38], [0.14, 0.48], [0.001, 0.5]]), clay);
    head.castShadow = true; this.head.add(head);
    const hole = new THREE.MeshBasicMaterial({ color: 0x1a0c08 });
    this.eyes = [];
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.CircleGeometry(0.055, 12), hole);
      e.scale.y = 0.6; e.position.set(s * 0.085, 0.27, 0.228); e.rotation.x = -0.1;
      this.head.add(e);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), glowMat(0xffa040, 3));
      glow.position.set(s * 0.085, 0.27, 0.215);
      glow.visible = false;
      glow.userData.keep = true;
      this.head.add(glow);
      this.eyes.push(glow);
    }
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), hole);
    mouth.position.set(0, 0.14, 0.235);
    this.head.add(mouth);
    // hair loops (haniwa style)
    for (const s of [-1, 1]) {
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.03, 6, 12), clay);
      loop.position.set(s * 0.25, 0.2, 0); loop.rotation.y = Math.PI / 2;
      this.head.add(loop);
    }
    // arms: one raised, one holding a club
    this.armL = new THREE.Group(); this.armL.position.set(0.3, 0.72, 0); g.add(this.armL);
    const aL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.4, 8), clay); aL.position.y = 0.18; aL.rotation.z = -0.3; this.armL.add(aL);
    this.armR = new THREE.Group(); this.armR.position.set(-0.3, 0.7, 0); g.add(this.armR);
    const aR = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.36, 8), clay); aR.position.y = -0.14; this.armR.add(aR);
    const club = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.05, 0.85, 8), toonMat({ color: 0x7a5236, rim: 0.2 }));
    club.position.set(0, -0.3, 0.3); club.rotation.x = Math.PI / 2 - 0.3;
    this.armR.add(club);
    this.hpBar.position.y = 1.85;
    this.alert.position.y = 2.2;
    // dizzy stars
    this.stars = new THREE.Group();
    for (let i = 0; i < 3; i++) { const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), glowMat(0xffe070, 2)); st.position.set(Math.cos(i * 2.09) * 0.3, 0, Math.sin(i * 2.09) * 0.3); this.stars.add(st); }
    this.stars.position.y = 1.65; this.stars.visible = false;
    this.object.add(this.stars);
    // merge static parts per animated group
    for (const grp of [g, this.head, this.armL, this.armR]) mergeGroup(grp, false);
    this.stars.visible = true; mergeGroup(this.stars); this.stars.visible = false;
  }

  hit(dmg, dir, knock) {
    if (!this.alive || this.state === 'dead') return false;
    const g = this.game;
    this.hp -= dmg;
    this.hurtFlash = 0.15;
    this.hpBar.visible = true;
    g.audio.sfx('hit'); g.audio.sfx('clay');
    g.fx.hit(this.aimPoint());
    this.body.vel.x = dir.x * knock; this.body.vel.z = dir.z * knock; this.body.vel.y = 3;
    this.body.grounded = false;
    if (this.hp <= 0) { this.setState('dying'); return true; }
    if (this.state !== 'stunned') this.setState(dmg >= 2 ? 'stunned' : 'hurt');
    this.stun = dmg >= 2 ? 1.0 : 0;
    return true;
  }
  onWind(info) {
    if (!this.alive) return;
    const d = info.hdir;
    const k = 13 * (info.strength || 1);
    this.body.vel.set(d.x * k, 6, d.z * k);
    this.body.grounded = false;
    this.setState('stunned');
    this.stun = 1.8;
    this.hpBar.visible = true;
    this.hp -= 0.5;
    this.hurtFlash = 0.1;
    this.game.audio.sfx('clay');
    if (this.hp <= 0) this.setState('dying');
  }

  update(dt) {
    if (!this.alive) return;
    const g = this.game, B = this.body;
    this.stateT += dt;
    const d = this.distToPlayer();
    const p = g.player;
    let want = 0, speed = 0;
    const s = this.state;
    const pAlive = p.state !== 'dead' && g.mode === 'play';
    if (s === 'idle') {
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = 2 + Math.random() * 4;
        this.wanderTarget.set(this.home.x + (Math.random() - 0.5) * 8, this.home.y, this.home.z + (Math.random() - 0.5) * 8);
      }
      const dx = this.wanderTarget.x - this.pos.x, dz = this.wanderTarget.z - this.pos.z;
      if (Math.hypot(dx, dz) > 0.6) { want = Math.atan2(dx, dz); speed = 1.2; }
      if (pAlive && d < this.aggroRange && Math.abs(p.pos.y - this.pos.y) < 4) { this.setState('notice'); g.audio.sfx('clay'); this.alert.visible = true; }
    } else if (s === 'notice') {
      want = this.playerYaw();
      if (this.stateT > 0.6) { this.alert.visible = false; this.setState('chase'); }
    } else if (s === 'chase') {
      want = this.playerYaw();
      speed = 3.4 * this.speedMul;
      const hd = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z);
      if (!pAlive || d > this.aggroRange * 1.6 || hd > this.leash) this.setState('return');
      else if (d < 2.3) this.setState('windup');
    } else if (s === 'return') {
      want = Math.atan2(this.home.x - this.pos.x, this.home.z - this.pos.z);
      speed = 2.6;
      if (Math.hypot(this.home.x - this.pos.x, this.home.z - this.pos.z) < 1) { this.setState('idle'); this.hp = this.maxHp; this.hpBar.visible = false; }
      if (pAlive && d < this.aggroRange * 0.7) this.setState('chase');
    } else if (s === 'windup') {
      want = this.playerYaw();
      if (this.stateT > 0.6) { this.setState('attack'); this.hitDone = false; g.audio.sfx('swing2'); }
    } else if (s === 'attack') {
      speed = this.stateT < 0.22 ? 7 : 0;
      want = this.facing;
      if (!this.hitDone && this.stateT > 0.08 && this.stateT < 0.3) {
        const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
        const dd = Math.hypot(dx, dz);
        const dot = (dx * Math.sin(this.facing) + dz * Math.cos(this.facing)) / (dd || 1);
        if (dd < 1.9 && dot > 0.3 && Math.abs(p.pos.y - this.pos.y) < 1.6) { this.hitDone = true; p.damage(2, this.pos, 8); }
      }
      if (this.stateT > 0.35) this.setState('recover');
    } else if (s === 'recover') {
      if (this.stateT > 0.8) this.setState('chase');
    } else if (s === 'hurt') {
      if (this.stateT > 0.35) this.setState('chase');
    } else if (s === 'stunned') {
      this.stun -= dt;
      if (this.stun <= 0 && B.grounded) this.setState('chase');
    } else if (s === 'dying') {
      if (this.stateT > 0.35) this.die();
    }

    // movement
    if (speed > 0) this.facing = dampAngle(this.facing, want, s === 'attack' ? 20 : 8, dt);
    const control = s !== 'stunned' && s !== 'hurt' && s !== 'dying';
    if (control) {
      const tx = Math.sin(this.facing) * speed, tz = Math.cos(this.facing) * speed;
      const k = 1 - Math.exp(-(B.grounded ? 10 : 2) * dt);
      B.vel.x += (tx - B.vel.x) * k; B.vel.z += (tz - B.vel.z) * k;
    } else if (B.grounded) {
      const k = Math.exp(-4 * dt);
      B.vel.x *= k; B.vel.z *= k;
    }
    // hop while moving
    if (control && speed > 0.5 && B.grounded) { this.hopT += dt * (speed > 2 ? 3.2 : 2); }
    B.move(dt);
    // separation from player
    const px = p.pos.x - this.pos.x, pz = p.pos.z - this.pos.z;
    const pd = Math.hypot(px, pz);
    if (pd < 0.9 && pd > 0.001 && Math.abs(p.pos.y - this.pos.y) < 1.5) {
      const push = (0.9 - pd) * 0.5;
      this.pos.x -= (px / pd) * push; this.pos.z -= (pz / pd) * push;
    }
    // hazards
    const z = this.zone;
    if ((z.killY !== undefined && this.pos.y < z.killY) || (z.hazard && z.hazard(this.pos))) { this.die(); return; }
    const w = z.physics.water(this.pos.x, this.pos.z);
    if (w > this.pos.y + 1.2) { g.fx.splash(new THREE.Vector3(this.pos.x, w, this.pos.z)); this.die(); return; }

    // visuals
    const hop = control && speed > 0.5 ? Math.abs(Math.sin(this.hopT * Math.PI)) * 0.22 : 0;
    this.model.position.y = hop;
    if (s === 'stunned' || s === 'dying') this.tilt = lerp(this.tilt, 1.2, 1 - Math.exp(-8 * dt));
    else this.tilt = lerp(this.tilt, 0, 1 - Math.exp(-6 * dt));
    const lean = s === 'windup' ? -0.35 : s === 'attack' ? 0.35 : 0;
    this.model.rotation.x = lerp(this.model.rotation.x, lean, 1 - Math.exp(-12 * dt)) + 0;
    this.model.rotation.z = this.tilt;
    this.armR.rotation.x = s === 'windup' ? lerp(this.armR.rotation.x, -2.6, 1 - Math.exp(-10 * dt)) : s === 'attack' ? lerp(this.armR.rotation.x, 0.6, 1 - Math.exp(-25 * dt)) : lerp(this.armR.rotation.x, -0.3 + Math.sin(this.hopT * 3) * 0.1, 1 - Math.exp(-6 * dt));
    this.armL.rotation.z = Math.sin(this.hopT * 3.1) * 0.15;
    const aggressive = s === 'chase' || s === 'windup' || s === 'attack' || s === 'notice';
    for (const e of this.eyes) { e.visible = aggressive; e.scale.setScalar(s === 'windup' ? 1.6 + Math.sin(this.stateT * 30) * 0.3 : 1); }
    this.stars.visible = s === 'stunned';
    if (this.stars.visible) this.stars.rotation.y += dt * 5;
    this.object.position.copy(this.pos);
    this.object.rotation.y = this.facing;
    this.flash(dt);
    this.updateBar(g.camera);
    this.alert.visible = this.alert.visible && s === 'notice';
  }
}

// ---------------------------------------------------------------------------
export class Wisp extends Enemy {
  constructor(game, zone, o) {
    super(game, zone, o);
    this.maxHp = 1; this.hp = 1;
    this.radius = 0.6;
    this.hover = o.hover || 1.9;
    this.t = Math.random() * 10;
    this.shotT = 2 + Math.random();
    this.orbs = [];
    this.poofColor = 0x3a2450;
    this.dropChance = 0.35;
    this.build();
    this.pos.y = this.groundY() + this.hover;
    this.warned = false;
    this.aggroRange = o.aggro || 15;
  }
  groundY() { return this.zone.physics.groundAt(this.pos.x, this.pos.z, this.pos.y + 1, 2).h; }
  build() {
    if (!maskTex) maskTex = makeMaskTexture();
    const g = this.model = new THREE.Group();
    this.object.add(g);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), toonMat({ color: 0x2a1838, emissive: 0x6a3a9a, emissiveIntensity: 0.8, rim: 1.0, rimColor: 0xd8a8ff }));
    g.add(core);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), glowMat(0x9a5ad8, 0.9, { transparent: true, opacity: 0.35, additive: true }));
    g.add(halo);
    this.halo = halo;
    const maskMat = toonMat({ map: maskTex, rim: 0.4, band: [-0.2, 0.2] });
    this.mats.push(maskMat);
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12, Math.PI / 2 - 0.9, 1.8, 0.35, 2.2), maskMat);
    mask.position.z = 0.08;
    mask.castShadow = true;
    g.add(mask);
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 6), toonMat({ color: 0xe8e0d0, rim: 0.4 }));
      horn.position.set(s * 0.2, 0.36, 0.1); horn.rotation.z = -s * 0.4;
      g.add(horn);
    }
    this.hpBar.position.y = 1.0;
    this.alert.position.y = 1.2;
    this.orbGeo = new THREE.SphereGeometry(0.22, 12, 10);
    this.orbMat = glowMat(0xc080ff, 2.2);
  }
  aimPoint() { return _v.copy(this.pos); }
  hit(dmg, dir) {
    if (!this.alive) return false;
    const g = this.game;
    g.fx.sparkle(this.pos, 0xc8a0ff, 8, 0.6, 1);
    this.pos.x += dir.x * 0.6; this.pos.z += dir.z * 0.6;
    g.audio.sfx('orb');
    if (!this.warned) { this.warned = true; g.hud.toast('剑穿过了怨灵！用「风之符文」吹散它！', 3.5); }
    return false;
  }
  onWind() {
    if (!this.alive) return;
    this.game.fx.sparkle(this.pos, 0xbff8ee, 24, 1, 2);
    this.die();
  }
  update(dt) {
    const g = this.game;
    this.t += dt;
    // orbs
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.life -= dt;
      const p = g.player.pos;
      _v.set(p.x - o.m.position.x, p.y + 1.1 - o.m.position.y, p.z - o.m.position.z);
      const dd = _v.length();
      if (dd > 0.01) o.vel.addScaledVector(_v.normalize(), dt * 2.2).clampLength(0, 5.5);
      o.m.position.addScaledVector(o.vel, dt);
      o.m.scale.setScalar(1 + Math.sin(this.t * 20) * 0.1);
      if (Math.random() < 0.5) g.fx.glowOrb(o.m.position.clone(), 0x9a5ad8, 0.4, 0.3);
      let pop = o.life <= 0 || dd < 0.75;
      if (dd < 0.75) g.player.damage(1, o.m.position, 5);
      if (o.m.position.y < this.zone.physics.terrain(o.m.position.x, o.m.position.z)) pop = true;
      // wind destroys orbs
      if (o.windCheck !== g.wind.casts) {
        o.windCheck = g.wind.casts;
        const dx = o.m.position.x - p.x, dz = o.m.position.z - p.z;
        if (Math.hypot(dx, dz) < 9 && g.player.state === 'cast') pop = true;
      }
      if (pop) { g.fx.sparkle(o.m.position, 0xc080ff, 8, 0.3, 1); this.zone.scene.remove(o.m); this.orbs.splice(i, 1); }
    }
    if (!this.alive) return;
    this.stateT += dt;
    const d = this.distToPlayer();
    const p = g.player;
    const pAlive = p.state !== 'dead' && g.mode === 'play';
    let tx = this.home.x + Math.sin(this.t * 0.4) * 3, tz = this.home.z + Math.cos(this.t * 0.33) * 3;
    if (this.state === 'idle') {
      if (pAlive && d < this.aggroRange) { this.setState('engage'); this.alert.visible = true; }
    } else if (this.state === 'engage') {
      if (this.stateT > 0.8) this.alert.visible = false;
      const yaw = this.playerYaw();
      const keep = 7;
      tx = p.pos.x - Math.sin(yaw) * keep + Math.cos(this.t * 0.8) * 2;
      tz = p.pos.z - Math.cos(yaw) * keep - Math.sin(this.t * 0.8) * 2;
      this.shotT -= dt;
      if (this.shotT <= 0 && d < 16) {
        this.shotT = 2.6 + Math.random() * 1.2;
        const m = new THREE.Mesh(this.orbGeo, this.orbMat);
        m.position.copy(this.pos);
        this.zone.scene.add(m);
        const v = new THREE.Vector3(p.pos.x - this.pos.x, p.pos.y + 1.1 - this.pos.y, p.pos.z - this.pos.z).normalize().multiplyScalar(4.5);
        this.orbs.push({ m, vel: v, life: 4.5 });
        g.audio.sfx('orb');
      }
      if (!pAlive || Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z) > this.leash) this.setState('idle');
    }
    const k = 1 - Math.exp(-1.5 * dt);
    this.pos.x += (tx - this.pos.x) * k;
    this.pos.z += (tz - this.pos.z) * k;
    const gy = this.groundY();
    this.pos.y = lerp(this.pos.y, gy + this.hover + Math.sin(this.t * 2) * 0.25, 1 - Math.exp(-3 * dt));
    this.facing = dampAngle(this.facing, this.state === 'engage' ? this.playerYaw() : Math.atan2(tx - this.pos.x, tz - this.pos.z), 5, dt);
    this.object.position.copy(this.pos);
    this.object.rotation.y = this.facing;
    this.halo.scale.setScalar(1 + Math.sin(this.t * 4) * 0.08);
    if (Math.random() < dt * 8) g.fx.smoke(this.pos.clone().setY(this.pos.y - 0.3), 0x2a1a38, 1, 0.8);
    this.flash(dt);
    void wrapAngle; void clamp;
  }
}
