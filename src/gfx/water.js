// Stylised toon water + builders (river strips, rectangles, discs, waterfalls).
import * as THREE from 'three';
import { U } from './materials.js';

const WATER_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vWorldPos;
uniform float uTime;
uniform float uWave;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  wp.y += ( sin( wp.x * 0.7 + uTime * 1.6 ) + sin( wp.z * 0.9 - uTime * 1.3 ) ) * 0.025 * uWave;
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const WATER_FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uSky;
uniform float uFlow;
uniform float uStreak;
uniform sampler2D tHeight;
uniform vec4 uHRect;
uniform float uUseHeight;
uniform float uConstDepth;
uniform float uEdgeFoam;
uniform float uWidth;
uniform float uOpacity;
uniform vec3 uSunDir;
uniform vec3 uFogColor; uniform vec3 uFogSunColor;
uniform float uFogDensity; uniform float uFogStart; uniform float uFogHeight; uniform float uFogBase; uniform float uFogMax;
varying vec2 vUv;
varying vec3 vWorldPos;
float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float noise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1, 0 ) ), f.x ), mix( hash( i + vec2( 0, 1 ) ), hash( i + vec2( 1, 1 ) ), f.x ), f.y );
}
vec3 wrFog( vec3 col, vec3 wp ) {
  vec3 fv = wp - cameraPosition; float fd = length( fv ); vec3 fdir = fv / max( fd, 0.001 );
  float fa = 1.0 - exp( -max( fd - uFogStart, 0.0 ) * uFogDensity );
  fa *= mix( 0.45, 1.0, exp( -max( wp.y - uFogBase, 0.0 ) * uFogHeight ) );
  vec3 fc = mix( uFogColor, uFogSunColor, pow( max( dot( fdir, uSunDir ), 0.0 ), 6.0 ) * 0.75 );
  return mix( col, fc, clamp( fa, 0.0, uFogMax ) );
}
void main() {
  float depth = uConstDepth;
  if ( uUseHeight > 0.5 ) {
    vec2 huv = ( vWorldPos.xz - uHRect.xy ) / uHRect.zw;
    depth = max( vWorldPos.y - texture2D( tHeight, huv ).r, 0.0 );
  }
  // flow coordinates: strips use uv (x across, y along in metres); others use world xz
  vec2 fuv = uFlow != 0.0 ? vec2( vUv.x * uWidth * 0.5, vUv.y * 0.35 - uTime * uFlow ) : vWorldPos.xz * 0.25 + vec2( uTime * 0.03, uTime * 0.02 );
  float n1 = noise( fuv * vec2( 1.0, 2.2 ) );
  float n2 = noise( fuv * vec2( 2.1, 4.0 ) + 7.3 + uTime * 0.2 );
  float n = n1 * 0.6 + n2 * 0.4;
  vec3 col = mix( uShallow, uDeep, smoothstep( 0.15, 2.4, depth ) );
  // soft caustic ripples
  float rip = noise( vWorldPos.xz * 1.3 + vec2( uTime * 0.4, -uTime * 0.3 ) ) * noise( vWorldPos.xz * 1.7 - vec2( uTime * 0.35, uTime * 0.25 ) );
  col += smoothstep( 0.35, 0.55, rip ) * 0.06 * ( 1.0 - smoothstep( 0.5, 2.5, depth ) );
  float streak = smoothstep( 0.66, 0.74, n ) * uStreak;
  float shore = 1.0 - smoothstep( 0.02, 0.4, depth + ( n - 0.5 ) * 0.3 );
  float edge = 0.0;
  if ( uEdgeFoam > 0.0 ) {
    float d = min( vUv.x, 1.0 - vUv.x ) * uWidth;
    edge = 1.0 - smoothstep( 0.0, uEdgeFoam, d + ( n - 0.5 ) * 0.35 );
  }
  float foam = clamp( max( max( streak, shore ), edge ), 0.0, 1.0 );
  col = mix( col, uFoam, foam * 0.85 );
  vec3 V = normalize( cameraPosition - vWorldPos );
  float fres = pow( 1.0 - max( V.y, 0.0 ), 4.0 );
  col = mix( col, uSky, fres * 0.5 );
  // stylised sun glints
  vec3 N = normalize( vec3( ( n2 - 0.5 ) * 0.5, 1.0, ( n1 - 0.5 ) * 0.5 ) );
  vec3 R = reflect( -V, N );
  float spec = pow( max( dot( R, uSunDir ), 0.0 ), 80.0 );
  col += step( 0.5, spec ) * 1.6 + spec * 0.4;
  float a = mix( 0.62, 0.93, smoothstep( 0.0, 1.6, depth ) ) + foam * 0.2;
  col = wrFog( col, vWorldPos );
  gl_FragColor = vec4( col, clamp( a * uOpacity, 0.0, 1.0 ) );
}`;

let dummyHeight = null;
function getDummy() {
  if (!dummyHeight) {
    dummyHeight = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat);
    dummyHeight.needsUpdate = true;
  }
  return dummyHeight;
}

export function waterMaterial({ shallow = 0x5fd0d8, deep = 0x1f7fae, foam = 0xf4fdff, flow = 0, streak = 1, height = null, constDepth = 1.5, edgeFoam = 0, width = 1, opacity = 1, wave = 1 } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms: {
      uTime: U.uTime, uSunDir: U.uSunDir, uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uFogDensity: U.uFogDensity,
      uFogStart: U.uFogStart, uFogHeight: U.uFogHeight, uFogBase: U.uFogBase, uFogMax: U.uFogMax,
      uShallow: { value: new THREE.Color(shallow) }, uDeep: { value: new THREE.Color(deep) }, uFoam: { value: new THREE.Color(foam).multiplyScalar(1.1) },
      uSky: { value: new THREE.Color(0xcfe9f7) }, uFlow: { value: flow }, uStreak: { value: streak },
      tHeight: { value: height ? height.tex : getDummy() }, uHRect: { value: height ? height.rect : new THREE.Vector4(0, 0, 1, 1) },
      uUseHeight: { value: height ? 1 : 0 }, uConstDepth: { value: constDepth }, uEdgeFoam: { value: edgeFoam }, uWidth: { value: width },
      uOpacity: { value: opacity }, uWave: { value: wave },
    },
    transparent: true,
    depthWrite: true,
  });
}

// strip along a polyline: points [[x,z,y,width], ...]
export function riverStrip(points, material, { segLen = 2 } = {}) {
  // resample
  const pts = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(d / segLen));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]);
    }
  }
  pts.push(points[points.length - 1]);
  const P = [], UV = [], I = [];
  let along = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(pts.length - 1, i + 1)];
    let tx = q1[0] - q0[0], tz = q1[1] - q0[1];
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    if (i > 0) along += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const hw = p[3] / 2;
    P.push(p[0] + nx * hw, p[2], p[1] + nz * hw, p[0] - nx * hw, p[2], p[1] - nz * hw);
    UV.push(0, along, 1, along);
    if (i < pts.length - 1) { const a = i * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, material);
  m.renderOrder = 5;
  return m;
}

export function waterRect(x, y, z, w, d, material, ry = 0) {
  const g = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(d / 4)));
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.renderOrder = 5;
  return m;
}

export function waterDisc(x, y, z, r, material, segs = 32) {
  const g = new THREE.CircleGeometry(r, segs);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z);
  m.renderOrder = 5;
  return m;
}

// falling water sheet with scrolling streaks
export function waterfall(points, width, { speed = 2.2, color = 0xe8fbff, tint = 0x6fd3e0 } = {}) {
  const P = [], UV = [], I = [];
  let along = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) along += Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1], p[2] - points[i - 1][2]);
    const w = p[3] !== undefined ? p[3] : width;
    const ax = p[4] !== undefined ? p[4] : 1, az = p[5] !== undefined ? p[5] : 0;
    P.push(p[0] - ax * w / 2, p[1], p[2] - az * w / 2, p[0] + ax * w / 2, p[1], p[2] + az * w / 2);
    UV.push(0, along, 1, along);
    if (i < points.length - 1) { const a = i * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uSpeed: { value: speed }, uColor: { value: new THREE.Color(color) }, uTint: { value: new THREE.Color(tint) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uSpeed; uniform vec3 uColor; uniform vec3 uTint; varying vec2 vUv;
      float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
      float noise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( hash( i ), hash( i + vec2( 1, 0 ) ), f.x ), mix( hash( i + vec2( 0, 1 ) ), hash( i + vec2( 1, 1 ) ), f.x ), f.y ); }
      void main() {
        vec2 p = vec2( vUv.x * 9.0, vUv.y * 0.6 - uTime * uSpeed );
        float n = noise( p * vec2( 1.0, 0.35 ) ) * 0.7 + noise( p * vec2( 2.3, 0.8 ) ) * 0.3;
        float s = smoothstep( 0.45, 0.6, n );
        vec3 c = mix( uTint, uColor, 0.35 + s * 0.65 );
        float edge = smoothstep( 0.0, 0.12, vUv.x ) * smoothstep( 1.0, 0.88, vUv.x );
        gl_FragColor = vec4( c * 1.15, ( 0.72 + s * 0.28 ) * edge );
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 6;
  return m;
}
