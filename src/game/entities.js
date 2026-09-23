// Interactive / wind-reactive world objects.
import * as THREE from 'three';
import { toonMat, glowMat, M, U } from '../gfx/materials.js';
import { getTex } from '../gfx/textures.js';
import { clamp, lerp, easeOutCubic, easeInOut, RNG } from '../core/util.js';
import { mergeGroup } from '../world/geom.js';

const _v = new THREE.Vector3();

function runeTile(index, color = 0x7fe8d8, intensity = 2.4, size = 1) {
  const t = getTex('runes').clone();
  t.needsUpdate = true;
  t.repeat.set(0.25, 0.25);
  t.offset.set((index % 4) * 0.25, 1 - 0.25 - Math.floor(index / 4) * 0.25);
  const m = new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(color).multiplyScalar(intensity), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1, side: THREE.DoubleSide });
  m.fog = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
  mesh.renderOrder = 8;
  return mesh;
}
export { runeTile };

// glow-able toon material (own instance)
export function glowToon(color = 0x9aa0a0, glow = 0x7fe8d8, opts = {}) {
  return toonMat(Object.assign({ color, emissive: glow, emissiveIntensity: 0, rim: 0.3 }, opts));
}

// ---------------------------------------------------------------------------
export class Spinner {
  constructor(game, o) {
    this.game = game;
    this.id = o.id;
    this.object = o.object;
    this.rotor = o.rotor;
    this.axis = o.axis || 'z';
    this.pos = o.pos.clone();
    this.windRadius = o.radius || 1.5;
    this.maxSpeed = o.maxSpeed || 9;
    this.impulse = o.impulse || 5;
    this.decay = o.decay !== undefined ? o.decay : 1.2;
    this.threshold = o.threshold || 4;
    this.latch = !!o.latch;
    this.activeTime = o.activeTime || 0;
    this.timer = 0;
    this.idle = o.idle || 0;
    this.speed = o.startSpeed || 0;
    this.angle = 0;
    this.active = false;
    this.locked = o.locked || null; // function -> truthy if blocked
    this.onActivate = o.onActivate || null;
    this.onDeactivate = o.onDeactivate || null;
    this.onGust = o.onGust || null;
    this.glowMats = o.glowMats || [];
    this.glowMax = o.glowMax || 2.2;
    this.ring = o.ring || null; // timer ring mesh
    this.aimWeight = o.aimWeight || 1.2;
    this.hitsNeeded = o.hits || 1;
    this.hits = 0;
    this.sfx = o.sfx !== false;
    this.dir = o.dir || 1;
  }
  windPoint() { return this.pos; }
  windDone() { return this.latch && this.active; }
  setActive(v, silent = false) {
    if (v === this.active) return;
    this.active = v;
    if (v) {
      if (this.latch) this.speed = this.maxSpeed;
      if (!silent && this.onActivate) this.onActivate(this);
    } else if (!silent && this.onDeactivate) this.onDeactivate(this);
  }
  onWind(info) {
    const g = this.game;
    if (this.locked && this.locked()) {
      g.fx.sparkle(this.pos, 0x9a7ab0, 6, 1.2, 0.5);
      if (this.onLockedHit) this.onLockedHit();
      return false;
    }
    this.speed = Math.min(this.maxSpeed * 1.2, this.speed + this.impulse * (info.strength || 1));
    this.hits++;
    if (this.sfx) g.audio.sfx('spin');
    g.fx.sparkle(this.pos, 0xbff8ee, 8, this.windRadius, 1);
    if (this.onGust) this.onGust(this, info);
    if (this.activeTime) this.timer = this.activeTime;
    if (!this.active && this.speed >= this.threshold && this.hits >= this.hitsNeeded) this.setActive(true);
    return true;
  }
  update(dt) {
    if (this.active && this.latch) this.speed = Math.max(this.speed, this.maxSpeed * 0.85);
    else if (this.active && this.activeTime) {
      this.timer -= dt;
      this.speed = Math.max(this.speed, this.maxSpeed * 0.8);
      if (this.timer <= 0) { this.setActive(false); this.speed = this.maxSpeed * 0.5; }
    } else {
      this.speed = Math.max(this.idle, this.speed - this.decay * dt);
      if (this.active && !this.latch && this.speed < this.threshold * 0.5) this.setActive(false);
    }
    this.angle += this.speed * dt * this.dir;
    if (this.rotor) this.rotor.rotation[this.axis] = this.angle;
    const k = this.active ? 1 : clamp(this.speed / this.maxSpeed, 0, 1) * 0.4;
    for (const m of this.glowMats) {
      if (m.emissiveIntensity !== undefined && m.isMeshToonMaterial) m.emissiveIntensity = lerp(m.emissiveIntensity, k * this.glowMax, 1 - Math.exp(-4 * dt));
      else if (m.opacity !== undefined) m.opacity = lerp(m.opacity, k, 1 - Math.exp(-4 * dt));
    }
    if (this.ring) {
      const t = this.activeTime && this.active ? clamp(this.timer / this.activeTime, 0, 1) : 0;
      this.ring.visible = t > 0;
      if (t > 0) this.ring.scale.setScalar(0.4 + t * 0.6);
    }
  }
}

// ---------------------------------------------------------------------------
// Mist / thorn barrier dispelled by wind
export class Barrier {
  constructor(game, o) {
    this.game = game;
    this.id = o.id;
    this.object = o.object;
    this.pos = o.pos.clone();
    this.windRadius = o.radius || 3;
    this.colliders = o.colliders || [];
    this.hitsLeft = o.hits || 1;
    this.onDispel = o.onDispel || null;
    this.kind = o.kind || 'mist';
    this.dispelled = false;
    this.t = 0;
    this.fade = 0;
    this.aimWeight = 1.5;
    this.smokeT = 0;
    this.extent = o.extent || this.windRadius;
    this.mats = [];
    this.object.traverse((c) => { if (c.material && !this.mats.includes(c.material)) this.mats.push(c.material); });
  }
  windPoint() { return this.pos; }
  windDone() { return this.dispelled; }
  onWind(info) {
    if (this.dispelled) return false;
    const g = this.game;
    this.hitsLeft--;
    g.fx.smoke(this.pos, 0x3a2848, 6, this.extent * 0.5);
    g.fx.leaves(this.pos, info.hdir, 6, 0x5a3a5a);
    this.shake = 0.5;
    if (this.hitsLeft <= 0) this.dispel();
    else g.audio.sfx('crack');
    return true;
  }
  dispel(silent = false) {
    if (this.dispelled) return;
    this.dispelled = true;
    for (const c of this.colliders) c.enabled = false;
    if (silent) { this.object.visible = false; this.fade = 1; return; }
    const g = this.game;
    g.audio.sfx('dispel');
    for (let i = 0; i < 4; i++) g.fx.poof(new THREE.Vector3(this.pos.x + (Math.random() - 0.5) * this.extent, this.pos.y - 1, this.pos.z + (Math.random() - 0.5) * this.extent), 0x4a2e5a, 10);
    g.fx.sparkle(this.pos, 0xbff8ee, 30, this.extent, 2);
    if (this.onDispel) this.onDispel(this);
  }
  update(dt) {
    this.t += dt;
    if (this.dispelled) {
      if (this.fade < 1) {
        this.fade = Math.min(1, this.fade + dt * 1.2);
        const s = 1 - easeOutCubic(this.fade) * 0.6;
        this.object.scale.set(s, 1 - easeOutCubic(this.fade), s);
        for (const m of this.mats) { m.transparent = true; m.opacity = 1 - this.fade; }
        if (this.fade >= 1) this.object.visible = false;
      }
      return;
    }
    if (this.shake > 0) {
      this.shake -= dt;
      this.object.position.x = this.baseX === undefined ? (this.baseX = this.object.position.x) : this.baseX + Math.sin(this.t * 60) * 0.06 * this.shake;
    }
    const p = this.game.player.pos;
    if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 40) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.25;
        const a = Math.random() * Math.PI * 2;
        this.game.fx.smoke(new THREE.Vector3(this.pos.x + Math.cos(a) * this.extent * 0.6, this.pos.y - 1 + Math.random() * 2, this.pos.z + Math.sin(a) * this.extent * 0.6), 0x3a2448, 1, 1.4);
      }
    }
    for (const m of this.mats) if (m.uniforms && m.uniforms.uT) m.uniforms.uT.value = this.t;
  }
}

// dark swirling mist dome material
export function mistMaterial(color = 0x3a2450) {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uColor: { value: new THREE.Color(color) }, uTime: U.uTime },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`uniform float uTime; uniform vec3 uColor; varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - abs(dot(normalize(vN), V)), 2.0);
        vec2 p = vW.xz * 0.35 + vec2(vW.y * 0.3, 0.0);
        float n = noise(p + vec2(uTime * 0.3, -uTime * 0.2)) * 0.6 + noise(p * 2.3 - uTime * 0.4) * 0.4;
        float swirl = smoothstep(0.35, 0.75, n);
        vec3 c = mix(uColor, uColor * 2.6 + vec3(0.15, 0.05, 0.25), swirl * 0.7 + fres * 0.8);
        float a = clamp(0.35 + fres * 0.5 + swirl * 0.25, 0.0, 0.9);
        gl_FragColor = vec4(c, a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

// thorny bramble cluster
export function makeBrambles(rng, { w = 4, h = 3, d = 1, count = 14 } = {}) {
  const g = new THREE.Group();
  const vine = toonMat({ color: 0x4a2e3e, rim: 0.4, rimColor: 0xb07ad0, band: [-0.1, 0.2] });
  const thorn = toonMat({ color: 0x6a3a5a, rim: 0.3 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb06ae0).multiplyScalar(1.6) });
  for (let i = 0; i < count; i++) {
    const pts = [];
    let x = rng.range(-w / 2, w / 2), y = rng.range(0, h * 0.3), z = rng.range(-d / 2, d / 2);
    for (let k = 0; k < 6; k++) {
      pts.push(new THREE.Vector3(x, y, z));
      x += rng.range(-0.8, 0.8); y += rng.range(0.2, h / 4); z += rng.range(-0.4, 0.4);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, rng.range(0.06, 0.12), 5, false), vine);
    tube.castShadow = true;
    g.add(tube);
    for (let k = 0; k < 6; k++) {
      const p = curve.getPoint(rng.next());
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.25, 4), thorn);
      c.position.copy(p);
      c.rotation.set(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6));
      g.add(c);
    }
    if (rng.chance(0.4)) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), glow);
      b.position.copy(curve.getPoint(rng.next()));
      g.add(b);
    }
  }
  return mergeGroup(g);
}

// ---------------------------------------------------------------------------
export class HiddenRune {
  constructor(game, o) {
    this.game = game;
    this.id = o.id;
    this.pos = o.pos.clone();
    this.windRadius = o.radius || 1.5;
    this.permanent = o.permanent !== false;
    this.duration = o.duration || 14;
    this.onReveal = o.onReveal || null;
    this.revealed = false;
    this.t = 0;
    this.k = 0;
    this.aimable = o.aimable !== undefined ? o.aimable : true;
    this.aimWeight = 0.8;
    this.object = new THREE.Group();
    const tile = runeTile(o.glyph || 0, o.color || 0x7fe8d8, o.intensity || 2.6, o.size || 1.4);
    tile.material.opacity = 0;
    this.tile = tile;
    this.object.add(tile);
    this.object.position.copy(this.pos);
    if (o.normal) this.object.lookAt(this.pos.clone().add(o.normal));
    if (o.rotX !== undefined) this.object.rotation.x = o.rotX;
    this.hintT = Math.random() * 2;
    this.extra = o.extra || [];
  }
  windPoint() { return this.pos; }
  windDone() { return this.revealed && this.permanent; }
  onWind() {
    if (this.revealed && this.permanent) return false;
    const first = !this.revealed;
    this.revealed = true;
    this.t = 0;
    if (first || !this.permanent) {
      this.game.audio.sfx('reveal');
      this.game.fx.sparkle(this.pos, 0xbff8ee, 16, this.windRadius, 1);
      if (this.onReveal) this.onReveal(this);
    }
    return true;
  }
  reveal(silent = true) { this.revealed = true; this.k = 1; this.tile.material.opacity = 1; if (!silent && this.onReveal) this.onReveal(this); }
  hide() { this.revealed = false; }
  update(dt) {
    this.t += dt;
    let target = this.revealed ? 1 : 0;
    if (this.revealed && !this.permanent && this.t > this.duration) { this.revealed = false; target = 0; }
    this.k = lerp(this.k, target, 1 - Math.exp(-3 * dt));
    const pulse = 0.85 + Math.sin(this.t * 3) * 0.15;
    this.tile.material.opacity = this.k * pulse;
    for (const e of this.extra) e.visible = this.k > 0.2;
    // faint hint sparkles when hidden and the player is near
    if (!this.revealed) {
      this.hintT -= dt;
      const p = this.game.player.pos;
      if (this.hintT <= 0 && p.distanceTo(this.pos) < 14) {
        this.hintT = 1.6 + Math.random() * 1.5;
        this.game.fx.sparkle(this.pos, 0x9ff5e8, 2, this.windRadius, 0.3);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Grid-based stone block pushed one cell per gust
export class PushBlock {
  constructor(game, o) {
    this.game = game;
    this.id = o.id;
    this.grid = o.grid; // {x0, z0, size, y, w, h, blocked(i,j), blocks: []}
    this.i = o.i; this.j = o.j;
    this.startI = o.i; this.startJ = o.j;
    this.size = this.grid.size * 0.92;
    this.object = new THREE.Group();
    const g = new THREE.BoxGeometry(this.size, this.size, this.size);
    const mat = toonMat({ map: getTex('ruin'), color: 0xd8d4c4, rim: 0.3, emissive: 0x7fe8d8, emissiveIntensity: 0.0 });
    this.mat = mat;
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    this.object.add(m);
    for (let s = 0; s < 4; s++) {
      const r = runeTile(2, 0x7fe8d8, 1.8, this.size * 0.6);
      const a = (s * Math.PI) / 2;
      r.position.set(Math.sin(a) * (this.size / 2 + 0.01), 0, Math.cos(a) * (this.size / 2 + 0.01));
      r.rotation.y = a;
      r.material.opacity = 0.55;
      this.object.add(r);
    }
    this.moving = null;
    this.windRadius = this.size * 0.7;
    this.aimWeight = 1.3;
    this.onMoved = o.onMoved || null;
    this.physics = o.physics;
    const p = this.cellPos(this.i, this.j);
    this.object.position.copy(p);
    this.col = this.physics.addBox(p.x, p.y, p.z, this.size / 2, this.size / 2, this.size / 2, 0, { dynamic: true });
    this.grid.blocks.push(this);
  }
  cellPos(i, j) { return new THREE.Vector3(this.grid.x0 + (i + 0.5) * this.grid.size, this.grid.y + this.size / 2, this.grid.z0 + (j + 0.5) * this.grid.size); }
  get pos() { return this.object.position; }
  windPoint() { return this.object.position; }
  free(i, j) {
    if (i < 0 || j < 0 || i >= this.grid.w || j >= this.grid.h) return false;
    if (this.grid.blocked(i, j)) return false;
    for (const b of this.grid.blocks) if (b !== this && b.i === i && b.j === j) return false;
    return true;
  }
  onWind(info) {
    if (this.moving) return false;
    const c = info.caster ? info.caster.pos : info.origin;
    const dx = this.object.position.x - c.x, dz = this.object.position.z - c.z;
    let di = 0, dj = 0;
    if (Math.abs(dx) > Math.abs(dz)) di = Math.sign(dx); else dj = Math.sign(dz);
    const ni = this.i + di, nj = this.j + dj;
    const g = this.game;
    if (!this.free(ni, nj)) { g.audio.sfx('thunk'); g.cam.shake(0.12); this.nudge = 0.25; this.nudgeDir = [di, dj]; return true; }
    this.moving = { from: this.object.position.clone(), to: this.cellPos(ni, nj), t: 0 };
    this.i = ni; this.j = nj;
    g.audio.sfx('thunk');
    return true;
  }
  reset() {
    this.i = this.startI; this.j = this.startJ;
    const p = this.cellPos(this.i, this.j);
    this.object.position.copy(p);
    this.physics.moveBox(this.col, p.x, p.y, p.z);
    this.moving = null;
  }
  update(dt) {
    const p = this.object.position;
    if (this.moving) {
      const m = this.moving;
      m.t += dt / 0.42;
      const k = easeInOut(Math.min(1, m.t));
      p.lerpVectors(m.from, m.to, k);
      this.mat.emissiveIntensity = 0.8 * (1 - k);
      if (Math.random() < 0.5) this.game.fx.dust(new THREE.Vector3(p.x, this.grid.y, p.z), 1, 0xcfc3a8);
      if (m.t >= 1) {
        this.moving = null;
        this.game.cam.shake(0.15);
        if (this.onMoved) this.onMoved(this);
      }
    } else if (this.nudge > 0) {
      this.nudge -= dt;
      const k = Math.sin((this.nudge / 0.25) * Math.PI) * 0.08;
      const b = this.cellPos(this.i, this.j);
      p.set(b.x + this.nudgeDir[0] * k, b.y, b.z + this.nudgeDir[1] * k);
    }
    this.physics.moveBox(this.col, p.x, p.y, p.z);
  }
}

// ---------------------------------------------------------------------------
export class PressurePlate {
  constructor(game, o) {
    this.game = game;
    this.id = o.id;
    this.pos = o.pos.clone();
    this.size = o.size || 1.8;
    this.grid = o.grid || null;
    this.cell = o.cell || null;
    this.allowPlayer = o.allowPlayer !== false;
    this.onPress = o.onPress || null;
    this.onRelease = o.onRelease || null;
    this.pressed = false;
    this.hidden = !!o.hidden;
    this.object = new THREE.Group();
    this.object.position.copy(this.pos);
    this.mat = toonMat({ color: 0xb8b8a8, map: getTex('ruin'), rim: 0.2, emissive: 0x7fe8d8, emissiveIntensity: 0 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(this.size, 0.16, this.size), this.mat);
    slab.position.y = 0.08;
    slab.receiveShadow = true;
    this.slab = slab;
    this.object.add(slab);
    this.glyph = runeTile(8, 0x7fe8d8, 2.2, this.size * 0.9);
    this.glyph.rotation.x = -Math.PI / 2;
    this.glyph.position.y = 0.17;
    this.glyph.material.opacity = 0.35;
    this.object.add(this.glyph);
    this.object.visible = !this.hidden;
    this.k = 0;
    this.latched = false;
    this.latch = !!o.latch;
  }
  setHidden(v) { this.hidden = v; this.object.visible = !v; }
  update(dt) {
    if (this.hidden) return;
    let on = false;
    if (this.grid && this.cell) for (const b of this.grid.blocks) if (!b.moving && b.i === this.cell[0] && b.j === this.cell[1]) on = true;
    if (!on && this.allowPlayer) {
      const p = this.game.player.pos;
      if (Math.abs(p.x - this.pos.x) < this.size / 2 && Math.abs(p.z - this.pos.z) < this.size / 2 && Math.abs(p.y - this.pos.y - 0.16) < 0.5) on = true;
    }
    if (this.latched) on = true;
    if (on !== this.pressed) {
      this.pressed = on;
      this.game.audio.sfx(on ? 'activate' : 'thunk');
      if (on && this.onPress) this.onPress(this);
      if (!on && this.onRelease) this.onRelease(this);
      if (on && this.latch) this.latched = true;
    }
    this.k = lerp(this.k, this.pressed ? 1 : 0, 1 - Math.exp(-8 * dt));
    this.slab.position.y = 0.08 - this.k * 0.07;
    this.glyph.position.y = 0.17 - this.k * 0.07;
    this.mat.emissiveIntensity = this.k * 0.8;
    this.glyph.material.opacity = 0.35 + this.k * 0.65;
  }
}

// ---------------------------------------------------------------------------
export class Door {
  constructor(game, o) {
    this.game = game;
    this.id = o.id;
    this.object = o.object;
    this.colliders = o.colliders || [];
    this.mode = o.mode || 'up';
    this.dist = o.dist || 4;
    this.dur = o.dur || 1.6;
    this.base = this.object.position.clone();
    this.open = false;
    this.k = 0;
    this.onOpened = o.onOpened || null;
    this.sound = o.sound !== false;
  }
  setOpen(v, instant = false) {
    if (this.open === v && !instant) return;
    this.open = v;
    for (const c of this.colliders) c.enabled = !v;
    if (instant) { this.k = v ? 1 : 0; this.apply(); return; }
    if (this.sound) this.game.audio.sfx('door');
    this.game.cam.shake(0.2);
  }
  apply() {
    const k = easeInOut(this.k);
    const o = this.object.position;
    o.copy(this.base);
    if (this.mode === 'up') o.y += k * this.dist;
    else if (this.mode === 'down') o.y -= k * this.dist;
    else if (this.mode === 'slideX') o.x += k * this.dist;
    else if (this.mode === 'slideZ') o.z += k * this.dist;
  }
  update(dt) {
    const t = this.open ? 1 : 0;
    if (this.k !== t) {
      const prev = this.k;
      this.k = clamp(this.k + (t > this.k ? 1 : -1) * dt / this.dur, 0, 1);
      this.apply();
      if (Math.random() < 0.4) this.game.fx.dust(_v.set(this.base.x + (Math.random() - 0.5) * 3, this.base.y, this.base.z), 1, 0xcfc3a8);
      if (prev < 1 && this.k >= 1 && this.onOpened) this.onOpened(this);
    }
  }
}

// ---------------------------------------------------------------------------
// Tall pillar that topples over a gap when hit by wind, becoming a bridge
export class TopplePillar {
  constructor(game, o) {
    this.game = game;
    this.id = o.id;
    this.object = o.object; // group positioned at the pivot (base), pillar extends +y
    this.pos = o.windPos.clone();
    this.windRadius = o.radius || 2;
    this.dirYaw = o.dirYaw; // topple direction (yaw)
    this.length = o.length;
    this.onFall = o.onFall || null;
    this.bridge = o.bridge; // collider (disabled until fallen)
    this.standing = o.standing || []; // colliders while upright
    this.fallen = false;
    this.falling = false;
    this.ang = 0; this.vel = 0;
    this.aimWeight = 1.5;
    this.targetAng = o.targetAng || Math.PI / 2 - 0.05;
    this.bounced = false;
  }
  windPoint() { return this.pos; }
  windDone() { return this.fallen || this.falling; }
  onWind() {
    if (this.fallen || this.falling) return false;
    this.falling = true;
    this.vel = 0.35;
    this.game.audio.sfx('crack');
    this.game.cam.shake(0.3);
    return true;
  }
  setFallen() {
    this.fallen = true; this.falling = false; this.ang = this.targetAng;
    this.apply();
    if (this.bridge) this.bridge.enabled = true;
    for (const c of this.standing) c.enabled = false;
  }
  apply() {
    // rotate about the horizontal axis perpendicular to the topple direction
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(this.dirYaw), 0, -Math.sin(this.dirYaw)), this.ang);
    this.object.quaternion.copy(q);
  }
  update(dt) {
    if (!this.falling) return;
    this.vel += Math.sin(this.ang + 0.15) * 3.2 * dt;
    this.ang += this.vel * dt;
    if (this.ang >= this.targetAng) {
      if (!this.bounced && this.vel > 0.6) {
        this.bounced = true;
        this.ang = this.targetAng;
        this.vel = -this.vel * 0.12;
        this.game.audio.sfx('rumble');
        this.game.cam.shake(0.9);
        const tip = new THREE.Vector3(Math.sin(this.dirYaw) * this.length, 0, Math.cos(this.dirYaw) * this.length).add(this.object.position);
        for (let i = 0; i < 6; i++) this.game.fx.dust(new THREE.Vector3(lerp(this.object.position.x, tip.x, i / 5), tip.y + 0.5, lerp(this.object.position.z, tip.z, i / 5)), 5, 0xd8ccb0);
      } else if (this.bounced && this.vel >= 0) {
        this.setFallen();
        if (this.onFall) this.onFall(this);
      }
    }
    this.apply();
  }
}

// ---------------------------------------------------------------------------
export class Chest {
  constructor(game, o) {
    this.game = game;
    this.id = o.id;
    this.pos = o.pos.clone();
    this.opened = false;
    this.onOpen = o.onOpen;
    this.object = new THREE.Group();
    this.object.position.copy(this.pos);
    this.object.rotation.y = o.ry || 0;
    const wood = toonMat({ color: 0x8a5a36, map: getTex('wood'), rim: 0.3 });
    const gold = M('gold');
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 0.8), wood);
    base.position.y = 0.3; base.castShadow = true;
    this.object.add(base);
    for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.82), gold); b.position.set(s * 0.45, 0.3, 0); this.object.add(b); }
    this.lid = new THREE.Group();
    this.lid.position.set(0, 0.6, -0.4);
    const lidMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.2, 12, 1, false, 0, Math.PI), wood);
    lidMesh.rotation.z = Math.PI / 2; lidMesh.position.z = 0.4; lidMesh.castShadow = true;
    this.lid.add(lidMesh);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.06), gold);
    lock.position.set(0, 0.05, 0.82);
    this.lid.add(lock);
    this.object.add(this.lid);
    this.k = 0;
    this.interactRadius = 2.0;
  }
  canInteract() { return !this.opened; }
  prompt() { return '打开宝箱'; }
  interact() {
    if (this.opened) return;
    this.opened = true;
    this.game.audio.sfx('door');
    this.game.fx.sparkle(this.pos.clone().setY(this.pos.y + 1), 0xffe9a0, 20, 0.8, 2);
    this.game.after(0.5, () => this.onOpen && this.onOpen(this));
  }
  setOpened() { this.opened = true; this.k = 1; this.lid.rotation.x = -1.9; }
  update(dt) {
    if (this.opened && this.k < 1) { this.k = Math.min(1, this.k + dt * 2); this.lid.rotation.x = -easeOutCubic(this.k) * 1.9; }
  }
}

// ---------------------------------------------------------------------------
export class Pickup {
  constructor(game, o) {
    this.game = game;
    this.id = o.id;
    this.kind = o.kind; // 'heart' | 'crystal'
    this.pos = o.pos.clone();
    this.object = o.object;
    this.object.position.copy(this.pos);
    this.taken = false;
    this.t = Math.random() * 5;
    this.onTake = o.onTake || null;
    this.auto = o.auto !== undefined ? o.auto : this.kind === 'heart';
    this.interactRadius = 2.2;
    this.life = o.life || 0;
  }
  canInteract() { return !this.taken && !this.auto && this.object.visible; }
  prompt() { return this.kind === 'crystal' ? '取得风之结晶' : '拾取'; }
  interact() { this.take(); }
  take() {
    if (this.taken) return;
    this.taken = true;
    this.object.visible = false;
    if (this.kind === 'heart') { this.game.player.heal(2); this.game.audio.sfx('heart'); this.game.fx.sparkle(this.pos, 0xff8a8a, 10, 0.5, 1.5); }
    if (this.onTake) this.onTake(this);
  }
  update(dt) {
    if (this.taken) return;
    this.t += dt;
    this.object.position.y = this.pos.y + Math.sin(this.t * 2.2) * 0.12;
    this.object.rotation.y += dt * 1.5;
    if (this.life) { this.life -= dt; if (this.life <= 0) { this.taken = true; this.object.visible = false; } }
    if (this.auto && this.object.visible) {
      const p = this.game.player.pos;
      if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 1.1 && Math.abs(p.y + 0.8 - this.pos.y) < 1.6) this.take();
    }
  }
}

export function heartObject() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.22); s.bezierCurveTo(-0.05, -0.14, -0.3, -0.02, -0.28, 0.12); s.bezierCurveTo(-0.26, 0.26, -0.06, 0.28, 0, 0.14);
  s.bezierCurveTo(0.06, 0.28, 0.26, 0.26, 0.28, 0.12); s.bezierCurveTo(0.3, -0.02, 0.05, -0.14, 0, -0.22);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
  g.translate(0, 0, -0.05);
  const m = new THREE.Mesh(g, toonMat({ color: 0xe8403a, emissive: 0xff4a3a, emissiveIntensity: 0.5, rim: 0.6 }));
  const grp = new THREE.Group();
  grp.add(m);
  return grp;
}

export function crystalObject(scale = 1) {
  const grp = new THREE.Group();
  const g = new THREE.OctahedronGeometry(0.42 * scale, 0);
  g.scale(0.75, 1.45, 0.75);
  const mat = toonMat({ color: 0x9ff5e8, emissive: 0x6fe8d8, emissiveIntensity: 1.5, rim: 1.0, rimColor: 0xffffff });
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  grp.add(m);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.62 * scale, 0.03 * scale, 6, 32), glowMat(0x9ff5e8, 2.2));
  halo.rotation.x = Math.PI / 2;
  grp.add(halo);
  const halo2 = halo.clone(); halo2.rotation.set(Math.PI / 2.6, 0.5, 0); grp.add(halo2);
  grp.userData.mat = mat;
  return grp;
}

// ---------------------------------------------------------------------------
// Generic interactable (steles, altars, signs, core)
export class Interactable {
  constructor(game, o) {
    this.game = game;
    this.id = o.id;
    this.pos = o.pos.clone();
    this.object = o.object || null;
    this.promptText = o.prompt || '调查';
    this.can = o.can || null;
    this.act = o.act;
    this.interactRadius = o.radius || 2.4;
    this.onUpdate = o.update || null;
  }
  canInteract() { return this.can ? this.can() : true; }
  prompt() { return typeof this.promptText === 'function' ? this.promptText() : this.promptText; }
  interact(g) { this.act(g, this); }
  update(dt) { if (this.onUpdate) this.onUpdate(dt, this); }
}

// ---------------------------------------------------------------------------
// Rune pedestal for order puzzles: lights up when hit by wind
export class RunePedestal {
  constructor(game, o) {
    this.game = game;
    this.id = o.id;
    this.pos = o.pos.clone();
    this.glyph = o.glyph;
    this.onHit = o.onHit;
    this.object = new THREE.Group();
    this.object.position.copy(o.base || this.pos);
    const stone = toonMat({ color: 0xcfcab8, map: getTex('ruin'), rim: 0.25, moss: [0.45, 0.6, 0.3, 0.4] });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 1.5, 8), stone);
    col.position.y = 0.75; col.castShadow = true;
    this.object.add(col);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 1.0), stone);
    top.position.y = 1.9; top.castShadow = true;
    this.object.add(top);
    this.tiles = [];
    for (let s = 0; s < 4; s++) {
      const r = runeTile(this.glyph, 0x7fe8d8, 2.8, 0.75);
      const a = (s * Math.PI) / 2;
      r.position.set(Math.sin(a) * 0.51, 1.9, Math.cos(a) * 0.51);
      r.rotation.y = a;
      r.material.opacity = 0.12;
      this.object.add(r);
      this.tiles.push(r);
    }
    this.lit = false;
    this.k = 0;
    this.windRadius = 0.9;
  }
  windPoint() { return _v.copy(this.object.position).setY(this.object.position.y + 1.9); }
  windDone() { return this.lit; }
  onWind() {
    if (this.lit) return false;
    this.setLit(true);
    this.game.audio.sfx('activate');
    this.game.fx.sparkle(this.windPoint(), 0xbff8ee, 12, 0.8, 1.5);
    if (this.onHit) this.onHit(this);
    return true;
  }
  setLit(v) { this.lit = v; }
  update(dt) {
    this.k = lerp(this.k, this.lit ? 1 : 0, 1 - Math.exp(-5 * dt));
    for (const t of this.tiles) t.material.opacity = 0.12 + this.k * 0.88;
  }
}

// relays a gust through a channel to a target spinner
export class WindDuct {
  constructor(game, o) {
    this.game = game;
    this.id = o.id;
    this.pos = o.pos.clone();
    this.path = o.path; // array of Vector3
    this.target = o.target;
    this.windRadius = o.radius || 1.2;
    this.aimWeight = 1.2;
    this.object = o.object || null;
  }
  windPoint() { return this.pos; }
  windDone() { return this.target && this.target.active && this.target.latch; }
  onWind(info) {
    const g = this.game;
    for (let i = 0; i < this.path.length - 1; i++) {
      const a = this.path[i], b = this.path[i + 1];
      g.after(i * 0.12, () => g.fx.windLines.add({ origin: a, dir: b.clone().sub(a), len: a.distanceTo(b), dur: 0.5, width: 0.1, swirl: 0.8, radius: 0.25, phase: Math.random() * 6, alpha: 0.9, trail: 0.5 }));
    }
    g.after(this.path.length * 0.12, () => { if (this.target) this.target.onWind({ strength: 1, origin: this.path[this.path.length - 1], dir: info.dir, hdir: info.hdir, fromDuct: true }); });
    g.audio.sfx('gust');
    return true;
  }
}

// breakable pot
export class Breakable {
  constructor(game, o) {
    this.game = game;
    this.id = o.id;
    this.pos = o.pos.clone();
    this.radius = 0.45;
    this.broken = false;
    this.object = new THREE.Group();
    this.object.position.copy(this.pos);
    const mat = toonMat({ color: o.color || 0xc27a50, rim: 0.3 });
    const g = new THREE.LatheGeometry([[0.001, 0], [0.26, 0.04], [0.36, 0.3], [0.3, 0.58], [0.18, 0.7], [0.2, 0.78], [0.001, 0.78]].map((p) => new THREE.Vector2(p[0], p[1])), 12);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    this.object.add(m);
    this.col = o.physics ? o.physics.addCyl(this.pos.x, this.pos.z, 0.36, this.pos.y, this.pos.y + 0.78, { walkable: true }) : null;
    this.drop = o.drop !== undefined ? o.drop : 0.5;
    this.windRadius = 0.5;
    this.aimable = false;
  }
  hit() {
    if (this.broken) return;
    this.broken = true;
    this.object.visible = false;
    if (this.col) this.col.enabled = false;
    this.game.audio.sfx('crack');
    this.game.fx.poof(this.pos, 0xc9a07a, 8);
    if (Math.random() < this.drop && this.zone) {
      const h = new Pickup(this.game, { id: null, kind: 'heart', pos: this.pos.clone().setY(this.pos.y + 0.5), object: heartObject(), life: 20 });
      this.zone.addEntity(h);
    }
  }
  windPoint() { return this.pos; }
  onWind() { this.hit(); return true; }
}

// decorative chime that rings when wind blows
export class WindChime {
  constructor(game, o) {
    this.game = game;
    this.pos = o.pos.clone();
    this.object = new THREE.Group();
    this.object.position.copy(this.pos);
    this.bell = new THREE.Group();
    this.object.add(this.bell);
    const glass = toonMat({ color: o.color || 0x9fe0e8, rim: 0.8, rimColor: 0xffffff, emissive: 0x2a6070, emissiveIntensity: 0.3 });
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), glass);
    b.position.y = -0.1;
    this.bell.add(b);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.005), M('paper'));
    strip.position.y = -0.38;
    this.bell.add(strip);
    this.t = Math.random() * 10;
    this.swing = 0;
    this.windRadius = 1.2;
    this.aimable = false;
  }
  windPoint() { return this.pos; }
  onWind() { this.swing = 1; if (Math.random() < 0.7) this.game.audio.sfx('chime'); return false; }
  update(dt) {
    this.t += dt;
    this.swing = Math.max(0.12, this.swing - dt * 0.5);
    this.bell.rotation.z = Math.sin(this.t * 2.3) * 0.15 * this.swing * 3;
    this.bell.rotation.x = Math.sin(this.t * 1.7 + 1) * 0.1 * this.swing * 3;
  }
}

// vertical light beam (objective / ending)
export function makeBeam(color = 0x9ff5e8, h = 120, r = 1.2) {
  // brightest along the silhouette centre (facing ratio), fading with height
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(1.5) }, uOpacity: { value: 0.8 }, uTime: U.uTime },
    vertexShader: 'varying vec3 vN; varying vec3 vW; varying float vY; void main(){ vY = uv.y; vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; uniform float uTime; varying vec3 vN; varying vec3 vW; varying float vY; void main(){ vec3 V = normalize(cameraPosition - vW); float f = pow(abs(dot(normalize(vN), V)), 1.6); float fade = (1.0 - vY) * smoothstep(0.0, 0.03, vY); float flick = 0.85 + 0.15*sin(uTime*3.0 + vY*20.0); gl_FragColor = vec4(uColor, f * fade * uOpacity * flick); }',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const g = new THREE.CylinderGeometry(r, r * 1.2, h, 16, 1, true);
  g.translate(0, h / 2, 0);
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 30;
  mesh.userData.noMap = true;
  return mesh;
}

export { RNG };
