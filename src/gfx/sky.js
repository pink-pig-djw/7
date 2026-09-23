// Sky dome with painted 2-tone clouds, distant faceted mountain rings, and the sun rig.
import * as THREE from 'three';
import { U } from './materials.js';
import { makeNoise2D, fbm, RNG } from '../core/util.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uFogColor;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunDisk;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uCloud;
uniform float uTime;
uniform float uStars;
varying vec3 vDir;
float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float noise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1, 0 ) ), f.x ), mix( hash( i + vec2( 0, 1 ) ), hash( i + vec2( 1, 1 ) ), f.x ), f.y );
}
float fbm( vec2 p ) { float s = 0.0, a = 0.5; for ( int i = 0; i < 5; i++ ) { s += a * noise( p ); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize( vDir );
  float h = d.y;
  float t = clamp( h, 0.0, 1.0 );
  vec3 col = mix( uFogColor, uZenith, pow( t, 0.5 ) );
  col = mix( col, uFogColor * 1.04, exp( -abs( h ) * 16.0 ) * 0.45 );
  col = mix( col, uGround, smoothstep( 0.0, -0.3, h ) );
  float sd = max( dot( d, uSunDir ), 0.0 );
  col += uSunDisk * ( smoothstep( 0.99935, 0.9996, sd ) * 5.0 + pow( sd, 350.0 ) * 1.0 + pow( sd, 9.0 ) * 0.16 );
  if ( h > 0.005 ) {
    vec2 uv = d.xz / ( h + 0.09 );
    uv = uv * 0.32 + vec2( uTime * 0.005, uTime * 0.0018 );
    float n = fbm( uv * 1.25 );
    float dens = smoothstep( uCloud, uCloud + 0.07, n );
    float n2 = fbm( uv * 1.25 + uSunDir.xz * 0.07 );
    float lit = smoothstep( 0.42, 0.58, 0.5 + ( n - n2 ) * 7.0 );
    vec3 cc = mix( uCloudShade, uCloudLit, lit );
    cc += uSunDisk * pow( sd, 10.0 ) * 0.25;
    float fade = smoothstep( 0.005, 0.2, h );
    col = mix( col, cc, dens * fade );
  }
  gl_FragColor = vec4( col, 0.0 );
}`;

const MTN_VERT = /* glsl */`
attribute vec3 color;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vW;
void main() {
  vCol = color;
  vN = normalize( mat3( modelMatrix ) * normal );
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const MTN_FRAG = /* glsl */`
uniform vec3 uFogColor;
uniform vec3 uSunDir;
uniform vec3 uLit;
uniform vec3 uShade;
uniform float uHaze;
uniform float uSnow;
uniform vec3 uOrigin;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 n = normalize( vN );
  float l = smoothstep( 0.02, 0.12, dot( n, uSunDir ) );
  float y = vW.y - uOrigin.y;
  float snow = smoothstep( uSnow - 8.0, uSnow + 4.0, y + vCol.r * 30.0 - 15.0 );
  vec3 base = mix( uShade, uLit, l );
  vec3 sn = mix( vec3( 0.72, 0.8, 0.92 ), vec3( 1.0, 0.99, 0.97 ), l );
  vec3 c = mix( base, sn, snow );
  float hz = clamp( uHaze + ( 1.0 - smoothstep( -40.0, 140.0, y ) ) * 0.45, 0.0, 0.97 );
  c = mix( c, uFogColor, hz );
  gl_FragColor = vec4( c, 0.0 );
}`;

export function makeMountainRing({ radius = 1100, minH = 60, maxH = 260, seed = 3, haze = 0.45, lit = 0x8fa6c0, shade = 0x62789a, snow = 170, segs = 220, gaps = [] } = {}) {
  const noise = makeNoise2D(seed);
  const rng = new RNG(seed);
  const pos = [];
  const col = [];
  const heights = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    let h = fbm(noise, Math.cos(a) * 3.0 + 10, Math.sin(a) * 3.0 + 10, 4) * 0.5 + 0.5;
    h = Math.pow(h, 1.6);
    let gapMul = 1;
    for (const g of gaps) {
      let d = Math.abs(((a - g.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      gapMul = Math.min(gapMul, 1 - g.depth * Math.max(0, 1 - d / g.w));
    }
    heights.push((minH + (maxH - minH) * h) * gapMul + rng.range(-8, 8));
  }
  // build flat-shaded triangles between base row, mid row and top row
  const pushTri = (a, b, c, k) => {
    pos.push(...a, ...b, ...c);
    for (let j = 0; j < 3; j++) col.push(k, 0, 0);
  };
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const h0 = heights[i], h1 = heights[i + 1];
    const k = rng.next();
    const P = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
    const b0 = P(a0, radius, -60), b1 = P(a1, radius, -60);
    const am = (a0 + a1) / 2 + (rng.next() - 0.5) * 0.004;
    const m0 = P(a0, radius + 40, h0 * 0.55), m1 = P(a1, radius + 40, h1 * 0.55);
    const t0 = P(a0, radius + 90, h0), t1 = P(a1, radius + 90, h1);
    pushTri(b0, m0, b1, k); pushTri(b1, m0, m1, k);
    pushTri(m0, t0, m1, k); pushTri(m1, t0, t1, k);
    void am;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    vertexShader: MTN_VERT, fragmentShader: MTN_FRAG,
    uniforms: {
      uFogColor: U.uFogColor, uSunDir: U.uSunDir,
      uLit: { value: new THREE.Color(lit) }, uShade: { value: new THREE.Color(shade) },
      uHaze: { value: haze }, uSnow: { value: snow }, uOrigin: { value: new THREE.Vector3() },
    },
    side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -90;
  return mesh;
}

export class Sky {
  constructor({ zenith = 0x3f8fe0, ground = 0x9fb4c4, sunDisk = 0xfff1d0, cloud = 0.56, cloudLit = 0xffffff, cloudShade = 0xc3d2e8, mountains = true } = {}) {
    this.group = new THREE.Group();
    this.uniforms = {
      uZenith: { value: new THREE.Color(zenith) },
      uFogColor: U.uFogColor,
      uGround: { value: new THREE.Color(ground) },
      uSunDir: U.uSunDir,
      uSunDisk: { value: new THREE.Color(sunDisk) },
      uCloudLit: { value: new THREE.Color(cloudLit) },
      uCloudShade: { value: new THREE.Color(cloudShade) },
      uCloud: { value: cloud },
      uTime: U.uTime,
      uStars: { value: 0 },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1900, 48, 24),
      new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false })
    );
    dome.renderOrder = -100;
    dome.frustumCulled = false;
    this.group.add(dome);
    this.dome = dome;
    this.rings = [];
    if (mountains) {
      const far = makeMountainRing({ radius: 1450, minH: 90, maxH: 380, seed: 7, haze: 0.62, lit: 0x9fb2cc, shade: 0x7488aa, snow: 250 });
      const near = makeMountainRing({ radius: 1000, minH: 30, maxH: 190, seed: 19, haze: 0.4, lit: 0x86a57e, shade: 0x5d7a78, snow: 175 });
      this.group.add(far, near);
      this.rings.push(far, near);
    }
  }
  setBaseY(y) { for (const r of this.rings) { r.position.y = y; r.material.uniforms.uOrigin.value.set(0, y, 0); } }
  update(camera) {
    this.dome.position.copy(camera.position);
    for (const r of this.rings) { r.position.x = camera.position.x; r.position.z = camera.position.z; r.material.uniforms.uOrigin.value.set(r.position.x, r.position.y, r.position.z); }
  }
}

// Sun + hemisphere light with a shadow camera that follows a focus point.
export class SunRig {
  constructor({ color = 0xfff1dc, intensity = 1.75, hemiSky = 0xb9d3f2, hemiGround = 0x8f8468, hemiIntensity = 1.75, range = 42, mapSize = 2048 } = {}) {
    this.light = new THREE.DirectionalLight(color, intensity);
    this.light.castShadow = true;
    const cam = this.light.shadow.camera;
    cam.left = -range; cam.right = range; cam.top = range; cam.bottom = -range;
    cam.near = 1; cam.far = 260;
    this.light.shadow.mapSize.set(mapSize, mapSize);
    this.light.shadow.bias = -0.0004;
    this.light.shadow.normalBias = 0.035;
    this.light.shadow.radius = 2;
    this.range = range;
    this.hemi = new THREE.HemisphereLight(hemiSky, hemiGround, hemiIntensity);
    this.target = this.light.target;
    this._r = new THREE.Vector3(); this._u = new THREE.Vector3(); this._f = new THREE.Vector3();
    this.syncUniforms();
  }
  addTo(scene) { scene.add(this.light, this.target, this.hemi); }
  setMapSize(n) {
    this.light.shadow.mapSize.set(n, n);
    if (this.light.shadow.map) { this.light.shadow.map.dispose(); this.light.shadow.map = null; }
  }
  syncUniforms() {
    U.uSunColor.value.copy(this.light.color).multiplyScalar(this.light.intensity);
  }
  update(focus) {
    const d = U.uSunDir.value;
    // snap focus to shadow texel grid in light space to avoid shimmering
    const texel = (this.range * 2) / this.light.shadow.mapSize.x;
    const up = Math.abs(d.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const r = this._r.crossVectors(up, d).normalize();
    const u = this._u.crossVectors(d, r).normalize();
    const fr = Math.round(focus.dot(r) / texel) * texel;
    const fu = Math.round(focus.dot(u) / texel) * texel;
    const fd = focus.dot(d);
    const f = this._f.copy(r).multiplyScalar(fr).addScaledVector(u, fu).addScaledVector(d, fd);
    this.target.position.copy(f);
    this.light.position.copy(f).addScaledVector(d, 120);
    this.target.updateMatrixWorld();
    this.syncUniforms();
  }
}
