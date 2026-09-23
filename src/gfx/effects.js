// Particles, wind ribbons, slash trails and one-shot effect presets.
import * as THREE from 'three';
import { U } from './materials.js';
import { getTex } from './textures.js';
import { clamp, lerp } from '../core/util.js';

const FOG_GLSL = /* glsl */`
uniform vec3 uFogColor; uniform vec3 uFogSunColor; uniform vec3 uSunDir;
uniform float uFogDensity; uniform float uFogStart; uniform float uFogHeight; uniform float uFogBase; uniform float uFogMax;
vec3 wrFog( vec3 col, vec3 wp ) {
  vec3 fv = wp - cameraPosition; float fd = length( fv ); vec3 fdir = fv / max( fd, 0.001 );
  float fa = 1.0 - exp( -max( fd - uFogStart, 0.0 ) * uFogDensity );
  fa *= mix( 0.45, 1.0, exp( -max( wp.y - uFogBase, 0.0 ) * uFogHeight ) );
  vec3 fc = mix( uFogColor, uFogSunColor, pow( max( dot( fdir, uSunDir ), 0.0 ), 6.0 ) * 0.75 );
  return mix( col, fc, clamp( fa, 0.0, uFogMax ) );
}`;
const fogUniforms = () => ({
  uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uSunDir: U.uSunDir, uFogDensity: U.uFogDensity,
  uFogStart: U.uFogStart, uFogHeight: U.uFogHeight, uFogBase: U.uFogBase, uFogMax: U.uFogMax,
});

// ---------------------------------------------------------------------------
export class ParticleSystem {
  constructor(max = 1500, { additive = false } = {}) {
    this.max = max;
    this.n = 0;
    const F = (k) => new Float32Array(max * k);
    this.pos = F(3); this.vel = F(3); this.col = F(4); this.size = F(1); this.frame = F(1); this.rot = F(1);
    this.life = F(1); this.maxLife = F(1); this.s0 = F(1); this.s1 = F(1); this.a0 = F(1); this.rotV = F(1);
    this.grav = F(1); this.drag = F(1); this.fadeIn = F(1);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aFrame = new THREE.BufferAttribute(this.frame, 1).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aFrame', this.aFrame);
    g.setAttribute('aRot', this.aRot);
    g.setDrawRange(0, 0);
    this.uniforms = Object.assign({ tAtlas: { value: getTex('particles') }, uScale: { value: 600 } }, fogUniforms());
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        attribute vec4 aColor; attribute float aSize; attribute float aFrame; attribute float aRot;
        uniform float uScale;
        varying vec4 vColor; varying float vFrame; varying float vRot; varying vec3 vWorldPos;
        void main() {
          vColor = aColor; vFrame = aFrame; vRot = aRot;
          vec4 wp = modelMatrix * vec4( position, 1.0 );
          vWorldPos = wp.xyz;
          vec4 mv = viewMatrix * wp;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp( aSize * uScale / max( -mv.z, 0.1 ), 0.0, 512.0 );
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tAtlas;
        varying vec4 vColor; varying float vFrame; varying float vRot; varying vec3 vWorldPos;
        ${FOG_GLSL}
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float c = cos( vRot ), s = sin( vRot );
          p = vec2( c * p.x - s * p.y, s * p.x + c * p.y ) + 0.5;
          if ( p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 ) discard;
          float fx = mod( vFrame, 4.0 ), fy = floor( vFrame / 4.0 );
          vec2 uv = vec2( ( fx + p.x ) / 4.0, 1.0 - ( fy + p.y ) / 2.0 );
          vec4 t = texture2D( tAtlas, uv );
          vec4 col = vec4( vColor.rgb * t.rgb, vColor.a * t.a );
          if ( col.a < 0.01 ) discard;
          col.rgb = wrFog( col.rgb, vWorldPos );
          gl_FragColor = col;
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 10;
  }

  emit(o) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const p = o.pos, v = o.vel || { x: 0, y: 0, z: 0 };
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    const c = o.color || { r: 1, g: 1, b: 1 };
    this.col[i * 4] = c.r; this.col[i * 4 + 1] = c.g; this.col[i * 4 + 2] = c.b; this.col[i * 4 + 3] = 0;
    this.a0[i] = o.alpha !== undefined ? o.alpha : 1;
    this.life[i] = 0; this.maxLife[i] = o.life || 1;
    this.s0[i] = o.size || 0.3; this.s1[i] = o.size2 !== undefined ? o.size2 : this.s0[i];
    this.frame[i] = o.frame || 0;
    this.rot[i] = o.rot !== undefined ? o.rot : Math.random() * 6.28;
    this.rotV[i] = o.rotV || 0;
    this.grav[i] = o.gravity || 0;
    this.drag[i] = o.drag || 0;
    this.fadeIn[i] = o.fadeIn || 0.08;
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) { this._kill(i); continue; }
      const k = this.life[i] / this.maxLife[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = lerp(this.s0[i], this.s1[i], k);
      const fi = this.fadeIn[i] > 0 ? Math.min(1, k / this.fadeIn[i]) : 1;
      this.col[i * 4 + 3] = this.a0[i] * fi * Math.min(1, (1 - k) * 3);
      this.rot[i] += this.rotV[i] * dt;
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true;
    this.aFrame.needsUpdate = true; this.aRot.needsUpdate = true;
  }

  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    const cp = (arr, k) => { for (let q = 0; q < k; q++) arr[i * k + q] = arr[j * k + q]; };
    cp(this.pos, 3); cp(this.vel, 3); cp(this.col, 4);
    for (const a of [this.size, this.frame, this.rot, this.life, this.maxLife, this.s0, this.s1, this.a0, this.rotV, this.grav, this.drag, this.fadeIn]) a[i] = a[j];
  }
  clear() { this.n = 0; }
}

// ---------------------------------------------------------------------------
// Stylised wind ribbons: each line follows a parametric curve, drawn as an additive strip.
export class WindLines {
  constructor(max = 48, segs = 18) {
    this.max = max; this.segs = segs;
    this.lines = [];
    const vcount = max * (segs + 1) * 2;
    this.P = new Float32Array(vcount * 3);
    this.A = new Float32Array(vcount);
    const idx = [];
    for (let l = 0; l < max; l++) {
      const b = l * (segs + 1) * 2;
      for (let s = 0; s < segs; s++) { const a = b + s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    this.aP = new THREE.BufferAttribute(this.P, 3).setUsage(THREE.DynamicDrawUsage);
    this.aA = new THREE.BufferAttribute(this.A, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aP);
    g.setAttribute('aAlpha', this.aA);
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uColor: { value: new THREE.Color(0.85, 1.0, 0.96) } }, fogUniforms()),
      vertexShader: /* glsl */`attribute float aAlpha; varying float vA; varying vec3 vWorldPos;
        void main(){ vA = aAlpha; vec4 wp = modelMatrix * vec4(position,1.0); vWorldPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */`uniform vec3 uColor; varying float vA; varying vec3 vWorldPos; ${FOG_GLSL}
        void main(){ if (vA < 0.005) discard; gl_FragColor = vec4( wrFog(uColor, vWorldPos) * 1.4, vA ); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 25;
    this._c = new THREE.Vector3();
    this._p = new THREE.Vector3(); this._q = new THREE.Vector3();
  }
  // path(s, line) -> Vector3 for s in [0,1]
  add({ origin, dir, len = 8, dur = 0.7, width = 0.12, swirl = 0.6, up = 0.2, radius = 0.5, phase = 0, alpha = 0.8, trail = 0.35 }) {
    if (this.lines.length >= this.max) this.lines.shift();
    const d = dir.clone().normalize();
    const side = new THREE.Vector3(-d.z, 0, d.x).normalize();
    const upv = new THREE.Vector3().crossVectors(side, d).normalize();
    this.lines.push({ o: origin.clone(), d, side, upv, len, dur, t: 0, width, swirl, up, radius, phase, alpha, trail });
  }
  _path(L, s, out) {
    const a = L.phase + s * L.swirl * Math.PI * 2;
    out.copy(L.o).addScaledVector(L.d, s * L.len)
      .addScaledVector(L.side, Math.cos(a) * L.radius * (0.3 + s))
      .addScaledVector(L.upv, Math.sin(a) * L.radius * (0.3 + s) + s * L.up * L.len * 0.2);
    return out;
  }
  update(dt, camera) {
    const segs = this.segs;
    this.A.fill(0);
    let li = 0;
    for (let k = this.lines.length - 1; k >= 0; k--) {
      const L = this.lines[k];
      L.t += dt;
      if (L.t >= L.dur) { this.lines.splice(k, 1); }
    }
    const camPos = camera.position;
    for (const L of this.lines) {
      const head = clamp(L.t / L.dur * (1 + L.trail), 0, 1 + L.trail);
      const tail = head - L.trail;
      const base = li * (segs + 1) * 2;
      for (let s = 0; s <= segs; s++) {
        const u = s / segs;
        const ss = lerp(Math.max(0, tail), Math.min(1, head), u);
        const p = this._path(L, ss, this._p);
        const p2 = this._path(L, Math.min(1, ss + 0.01), this._q);
        const t = p2.sub(p).normalize();
        const toCam = this._c.copy(camPos).sub(p).normalize();
        const w = new THREE.Vector3().crossVectors(t, toCam).normalize().multiplyScalar(L.width * Math.sin(u * Math.PI));
        const vi = base + s * 2;
        this.P[vi * 3] = p.x + w.x; this.P[vi * 3 + 1] = p.y + w.y; this.P[vi * 3 + 2] = p.z + w.z;
        this.P[vi * 3 + 3] = p.x - w.x; this.P[vi * 3 + 4] = p.y - w.y; this.P[vi * 3 + 5] = p.z - w.z;
        const fade = Math.sin(u * Math.PI) * L.alpha * Math.min(1, (L.dur - L.t) * 4);
        this.A[vi] = fade; this.A[vi + 1] = fade;
      }
      li++;
    }
    // collapse unused lines
    for (let l = li; l < this.max; l++) {
      const base = l * (segs + 1) * 2 * 3;
      for (let q = 0; q < (segs + 1) * 2 * 3; q++) this.P[base + q] = 0;
    }
    this.aP.needsUpdate = true; this.aA.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
class SlashTrail {
  constructor() {
    this.N = 14;
    this.samples = [];
    const P = new Float32Array(this.N * 2 * 3), A = new Float32Array(this.N * 2);
    const idx = [];
    for (let i = 0; i < this.N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    this.aP = new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage);
    this.aA = new THREE.BufferAttribute(A, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aP); g.setAttribute('aAlpha', this.aA); g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: 'attribute float aAlpha; varying float vA; void main(){ vA=aAlpha; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(vec3(0.85,1.0,1.0)*1.6, vA*0.7); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 26;
    this.active = false;
    this.player = null;
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
  }
  start(player) { this.player = player; this.active = true; this.samples.length = 0; }
  end() { this.active = false; }
  update(dt) {
    if (this.active && this.player && this.player.avatar.sword && !this.player.avatar.sheathed) {
      const sw = this.player.avatar.sword;
      sw.updateMatrixWorld(true);
      const a = sw.localToWorld(this._a.copy(sw.userData.baseLocal));
      const b = sw.localToWorld(this._b.copy(sw.userData.tipLocal));
      this.samples.unshift({ a: a.clone(), b: b.clone(), age: 0 });
    }
    for (const s of this.samples) s.age += dt;
    while (this.samples.length > this.N || (this.samples.length && this.samples[this.samples.length - 1].age > 0.14)) this.samples.pop();
    const P = this.aP.array, A = this.aA.array;
    A.fill(0);
    const n = this.samples.length;
    for (let i = 0; i < this.N; i++) {
      const s = this.samples[Math.min(i, n - 1)];
      if (!s) { for (let q = 0; q < 6; q++) P[i * 6 + q] = 0; continue; }
      P[i * 6] = s.a.x; P[i * 6 + 1] = s.a.y; P[i * 6 + 2] = s.a.z;
      P[i * 6 + 3] = s.b.x; P[i * 6 + 4] = s.b.y; P[i * 6 + 5] = s.b.z;
      const f = i < n ? (1 - i / this.N) * (1 - s.age / 0.14) : 0;
      A[i * 2] = f * 0.1; A[i * 2 + 1] = f;
    }
    this.aP.needsUpdate = true; this.aA.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
const C = (hex) => new THREE.Color(hex);

export class Effects {
  constructor(game) {
    this.game = game;
    this.root = new THREE.Group();
    this.normal = new ParticleSystem(2200, { additive: false });
    this.glow = new ParticleSystem(1800, { additive: true });
    this.windLines = new WindLines(56);
    this.slash = new SlashTrail();
    this.root.add(this.normal.points, this.glow.points, this.windLines.mesh, this.slash.mesh);
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 48);
    this.ambientT = 0;
    this.v = new THREE.Vector3();
  }
  attach(scene) { scene.add(this.root); }
  clear() {
    this.normal.clear(); this.glow.clear(); this.windLines.lines.length = 0;
    for (const r of this.rings) this.root.remove(r.mesh);
    this.rings.length = 0;
  }
  setScale(h, fov) {
    const s = (h * 0.5) / Math.tan((fov * Math.PI) / 360);
    this.normal.uniforms.uScale.value = s;
    this.glow.uniforms.uScale.value = s;
  }
  update(dt, camera) {
    this.normal.update(dt);
    this.glow.update(dt);
    this.windLines.update(dt, camera);
    this.slash.update(dt);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) { this.root.remove(r.mesh); r.mesh.material.dispose(); this.rings.splice(i, 1); continue; }
      const s = lerp(r.r0, r.r1, 1 - Math.pow(1 - k, 2.2));
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = (1 - k) * r.alpha;
      if (r.face) r.mesh.quaternion.copy(camera.quaternion);
    }
  }

  // --- presets ------------------------------------------------------------
  dust(p, n = 5, color = 0xd8ccb0) {
    const c = C(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28;
      this.normal.emit({ pos: { x: p.x + Math.cos(a) * 0.2, y: p.y + 0.1, z: p.z + Math.sin(a) * 0.2 }, vel: { x: Math.cos(a) * 1.5, y: 0.6 + Math.random(), z: Math.sin(a) * 1.5 }, life: 0.6 + Math.random() * 0.4, size: 0.35, size2: 0.9, color: c, alpha: 0.45, frame: 4, drag: 3, rotV: 1 });
    }
  }
  splash(p) {
    const c = C(0xeefcff);
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * 6.28, sp = 1 + Math.random() * 3;
      this.normal.emit({ pos: { x: p.x, y: p.y + 0.05, z: p.z }, vel: { x: Math.cos(a) * sp, y: 3 + Math.random() * 4, z: Math.sin(a) * sp }, life: 0.7, size: 0.18, size2: 0.08, color: c, alpha: 0.9, frame: 7, gravity: 14 });
    }
    this.ring(p, 0xffffff, 0.3, 2.2, 0.8, 0.5, false);
  }
  ripple(p) { this.ring(p, 0xffffff, 0.2, 1.3, 1.0, 0.35, false); }
  sparkle(p, color = 0x9ff5e8, n = 10, spread = 0.6, up = 1.5) {
    const c = C(color);
    for (let i = 0; i < n; i++) {
      this.glow.emit({ pos: { x: p.x + (Math.random() - 0.5) * spread, y: p.y + (Math.random() - 0.5) * spread, z: p.z + (Math.random() - 0.5) * spread }, vel: { x: (Math.random() - 0.5) * 1.2, y: Math.random() * up, z: (Math.random() - 0.5) * 1.2 }, life: 0.6 + Math.random() * 0.8, size: 0.25 + Math.random() * 0.2, size2: 0.02, color: c, alpha: 1, frame: 3, drag: 1.5, rotV: 2 });
    }
  }
  hit(p, color = 0xfff2c0) {
    const c = C(color);
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * 6.28, b = (Math.random() - 0.3) * 2;
      this.glow.emit({ pos: { x: p.x, y: p.y, z: p.z }, vel: { x: Math.cos(a) * 6, y: b * 3, z: Math.sin(a) * 6 }, life: 0.25, size: 0.3, size2: 0.05, color: c, alpha: 1, frame: 3, drag: 6 });
    }
    this.glow.emit({ pos: p, life: 0.18, size: 1.4, size2: 2.2, color: c, alpha: 0.9, frame: 0 });
  }
  poof(p, color = 0x5a3a7a, n = 16) {
    const c = C(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, sp = 1 + Math.random() * 2.5;
      this.normal.emit({ pos: { x: p.x, y: p.y + Math.random() * 1.2, z: p.z }, vel: { x: Math.cos(a) * sp, y: 1 + Math.random() * 2, z: Math.sin(a) * sp }, life: 0.8 + Math.random() * 0.5, size: 0.6, size2: 1.6, color: c, alpha: 0.85, frame: 4, drag: 2.5, rotV: 1.5 });
    }
    this.sparkle({ x: p.x, y: p.y + 0.8, z: p.z }, 0xd6a8ff, 10, 1.2, 2);
  }
  leaves(p, dir, n = 8, color = 0x7fbf4a) {
    for (let i = 0; i < n; i++) {
      const c = C(color).offsetHSL((Math.random() - 0.5) * 0.06, 0, (Math.random() - 0.5) * 0.15);
      this.normal.emit({ pos: { x: p.x + (Math.random() - 0.5), y: p.y + Math.random(), z: p.z + (Math.random() - 0.5) }, vel: { x: dir.x * (3 + Math.random() * 4) + (Math.random() - 0.5) * 2, y: 1 + Math.random() * 2.5, z: dir.z * (3 + Math.random() * 4) + (Math.random() - 0.5) * 2 }, life: 1.4 + Math.random(), size: 0.22, color: c, alpha: 1, frame: 1, gravity: 2.5, drag: 1.2, rotV: (Math.random() - 0.5) * 8 });
    }
  }
  petals(p, dir, n = 6) {
    for (let i = 0; i < n; i++) {
      const c = C(0xffc4d8).offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);
      this.normal.emit({ pos: { x: p.x + (Math.random() - 0.5) * 4, y: p.y + Math.random() * 3, z: p.z + (Math.random() - 0.5) * 4 }, vel: { x: dir.x * 1.5 + (Math.random() - 0.5), y: -0.3 - Math.random() * 0.5, z: dir.z * 1.5 + (Math.random() - 0.5) }, life: 3 + Math.random() * 2, size: 0.16, color: c, alpha: 1, frame: 2, drag: 0.2, rotV: (Math.random() - 0.5) * 5, fadeIn: 0.2 });
    }
  }
  smoke(p, color = 0x6a4a8a, n = 2, size = 1.2) {
    const c = C(color);
    for (let i = 0; i < n; i++) this.normal.emit({ pos: { x: p.x + (Math.random() - 0.5) * size, y: p.y + (Math.random() - 0.5) * size * 0.5, z: p.z + (Math.random() - 0.5) * size }, vel: { x: (Math.random() - 0.5) * 0.5, y: 0.4 + Math.random() * 0.6, z: (Math.random() - 0.5) * 0.5 }, life: 1.5 + Math.random(), size: size * 0.6, size2: size * 1.4, color: c, alpha: 0.55, frame: 4, rotV: 0.6, fadeIn: 0.25 });
  }
  glowOrb(p, color, size = 0.6, life = 0.12) { this.glow.emit({ pos: p, life, size, size2: size, color: C(color), alpha: 1, frame: 0, fadeIn: 0 }); }

  ring(p, color = 0x9ff5e8, r0 = 0.5, r1 = 4, dur = 0.6, alpha = 0.8, face = false, flatUp = true) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: C(color).multiplyScalar(1.6), transparent: true, opacity: alpha, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.position.set(p.x, p.y + 0.05, p.z);
    if (!face && flatUp) m.rotation.x = -Math.PI / 2;
    m.renderOrder = 22;
    this.root.add(m);
    this.rings.push({ mesh: m, t: 0, dur, r0, r1, alpha, face });
  }

  windBurst(origin, dir, strength = 1) {
    const d = dir.clone().normalize();
    for (let i = 0; i < 9; i++) {
      const o = origin.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6));
      const dd = d.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.45, (Math.random() - 0.3) * 0.25, (Math.random() - 0.5) * 0.45)).normalize();
      this.windLines.add({ origin: o, dir: dd, len: 9 + Math.random() * 5 * strength, dur: 0.55 + Math.random() * 0.3, width: 0.07 + Math.random() * 0.06, swirl: 0.4 + Math.random() * 0.6, radius: 0.25 + Math.random() * 0.5, phase: Math.random() * 6.28, alpha: 0.75, trail: 0.4 });
    }
    // swirl ring in front of the hand
    const rm = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: C(0xbff8ee).multiplyScalar(1.8), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    rm.position.copy(origin).addScaledVector(d, 0.6);
    rm.lookAt(origin.clone().addScaledVector(d, 2));
    rm.renderOrder = 22;
    this.root.add(rm);
    this.rings.push({ mesh: rm, t: 0, dur: 0.35, r0: 0.3, r1: 1.8, alpha: 0.9, face: false });
    const c = C(0xd8fff6);
    for (let i = 0; i < 26; i++) {
      const sp = 8 + Math.random() * 10;
      const dd = d.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.7, (Math.random() - 0.4) * 0.4, (Math.random() - 0.5) * 0.7)).normalize();
      this.glow.emit({ pos: origin, vel: { x: dd.x * sp, y: dd.y * sp, z: dd.z * sp }, life: 0.45 + Math.random() * 0.3, size: 0.18, size2: 0.02, color: c, alpha: 0.9, frame: 3, drag: 3 });
    }
  }

  // gentle ambient wind streaks drifting across open areas near the focus point
  ambientWind(dt, focus, dir, rate = 0.6) {
    this.ambientT -= dt;
    if (this.ambientT > 0) return;
    this.ambientT = (0.6 + Math.random() * 1.2) / rate;
    const o = new THREE.Vector3(focus.x + (Math.random() - 0.5) * 30 - dir.x * 10, focus.y + 1 + Math.random() * 5, focus.z + (Math.random() - 0.5) * 30 - dir.y * 10);
    this.windLines.add({ origin: o, dir: new THREE.Vector3(dir.x, 0.05, dir.y), len: 14 + Math.random() * 10, dur: 2.2 + Math.random() * 1.2, width: 0.05, swirl: 0.25 + Math.random() * 0.5, radius: 0.35, phase: Math.random() * 6, alpha: 0.35, trail: 0.5 });
  }

  startSlash(player) { this.slash.start(player); }
  endSlash() { this.slash.end(); }
}
