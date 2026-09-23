// Toon material system. All lit surfaces use MeshToonMaterial patched with:
//  - unified cel band for sun light + cast shadows (anime style flat shadow tone)
//  - rim light, world-space painterly colour variation, optional moss / sway
//  - custom aerial-perspective fog (matches the sky horizon)
//  - alpha channel = outline mask for the post-process outline pass
import * as THREE from 'three';
import { getTex } from './textures.js';

export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(-0.45, 0.72, 0.52).normalize() },
  uSunViewDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uFogColor: { value: new THREE.Color(0.75, 0.86, 0.95) },
  uFogSunColor: { value: new THREE.Color(1.0, 0.92, 0.78) },
  uFogDensity: { value: 0.0032 },
  uFogStart: { value: 25 },
  uFogHeight: { value: 0.012 },
  uFogBase: { value: -10 },
  uFogMax: { value: 0.94 },
  uWind: { value: new THREE.Vector2(0.8, 0.35) },
  uPlayer: { value: new THREE.Vector3() },
  uGust: { value: new THREE.Vector4(0, -999, 0, -100) },
  uGustDir: { value: new THREE.Vector3(0, 0, 1) },
};

const VERT_COMMON = /* glsl */`
varying vec3 vWorldPos;
uniform float uTime;
uniform vec2 uWind;
uniform float uSway;
`;

const VERT_SWAY = /* glsl */`
#ifdef WR_SWAY
{
  vec3 ip = modelMatrix[3].xyz;
  #ifdef USE_INSTANCING
  ip += instanceMatrix[3].xyz;
  #endif
  float h = max(transformed.y - 0.6, 0.0);
  float ph = uTime * 1.25 + ip.x * 0.37 + ip.z * 0.29;
  float s = sin(ph) * 0.6 + sin(ph * 2.3 + 1.3) * 0.3 + sin(ph * 5.1 + transformed.x * 2.0) * 0.1;
  transformed.x += uWind.x * s * h * uSway;
  transformed.z += uWind.y * s * h * uSway;
}
#endif
`;

const VERT_WORLDPOS = /* glsl */`
{
  vec4 wrp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
  wrp = instanceMatrix * wrp;
  #endif
  vWorldPos = ( modelMatrix * wrp ).xyz;
}
`;

const FRAG_COMMON = /* glsl */`
varying vec3 vWorldPos;
uniform vec3 uSunColor;
uniform vec3 uSunViewDir;
uniform vec3 uSunDir;
uniform vec2 uBand;
uniform float uRim;
uniform vec3 uRimColor;
uniform vec2 uVar;
uniform vec4 uMoss;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uFogDensity;
uniform float uFogStart;
uniform float uFogHeight;
uniform float uFogBase;
uniform float uFogMax;
uniform float uFogMul;
uniform float uTime;
float gToonLit = 1.0;
float wrHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 ); }
float wrNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  float a = wrHash( i ), b = wrHash( i + vec2( 1.0, 0.0 ) ), c = wrHash( i + vec2( 0.0, 1.0 ) ), d = wrHash( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
vec3 wrFog( vec3 col, vec3 wp ) {
  vec3 fv = wp - cameraPosition;
  float fd = length( fv );
  vec3 fdir = fv / max( fd, 0.001 );
  float fa = 1.0 - exp( -max( fd - uFogStart, 0.0 ) * uFogDensity * uFogMul );
  float hf = exp( -max( wp.y - uFogBase, 0.0 ) * uFogHeight );
  fa *= mix( 0.45, 1.0, hf );
  float sa = pow( max( dot( fdir, uSunDir ), 0.0 ), 6.0 );
  vec3 fc = mix( uFogColor, uFogSunColor, sa * 0.75 );
  return mix( col, fc, clamp( fa, 0.0, uFogMax ) );
}
`;

const TOON_PARS = /* glsl */`
varying vec3 vViewPosition;
struct ToonMaterial { vec3 diffuseColor; };
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  float NdL = dot( geometryNormal, directLight.direction );
  if ( dot( directLight.direction, uSunViewDir ) > 0.9995 ) {
    float sunL = max( uSunColor.r + uSunColor.g + uSunColor.b, 1e-4 );
    float sh = clamp( ( directLight.color.r + directLight.color.g + directLight.color.b ) / sunL, 0.0, 1.0 );
    sh = smoothstep( 0.2, 0.8, sh );
    float band = smoothstep( uBand.x, uBand.y, NdL );
    float lit = band * sh;
    gToonLit = lit;
    // subtle secondary highlight band for richer toon look
    float hi = smoothstep( 0.55, 0.75, NdL ) * sh * 0.08;
    reflectedLight.directDiffuse += uSunColor * ( lit + hi ) * BRDF_Lambert( material.diffuseColor );
  } else {
    float band = smoothstep( -0.2, 0.35, NdL );
    reflectedLight.directDiffuse += directLight.color * band * BRDF_Lambert( material.diffuseColor );
  }
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Toon
`;

const FRAG_VARIATION = /* glsl */`
{
  float n = wrNoise( vWorldPos.xz * uVar.y + vWorldPos.y * 0.13 ) * 0.62 + wrNoise( vWorldPos.xz * uVar.y * 3.7 + 7.1 ) * 0.38;
  diffuseColor.rgb *= 1.0 + ( n - 0.5 ) * 2.0 * uVar.x;
}
`;

const FRAG_MOSS = /* glsl */`
#ifdef WR_MOSS
{
  vec3 wn = inverseTransformDirection( normal, viewMatrix );
  // patchy moss: mostly on upward faces, broken up by two noise scales
  float mn = wrNoise( vWorldPos.xz * 0.33 + vWorldPos.y * 0.21 );
  float mn2 = wrNoise( vWorldPos.xz * 1.4 + vWorldPos.y * 0.9 + 3.7 );
  float up = smoothstep( 0.3, 0.8, wn.y );
  float m = up * smoothstep( 0.4, 0.62, mn * 0.7 + mn2 * 0.3 );
  m = max( m, smoothstep( 0.8, 0.96, mn2 ) * 0.55 );
  diffuseColor.rgb = mix( diffuseColor.rgb, uMoss.rgb, m * uMoss.a );
}
#endif
`;

const FRAG_RIM = /* glsl */`
{
  vec3 rimV = normalize( vViewPosition );
  float fres = 1.0 - clamp( dot( normal, rimV ), 0.0, 1.0 );
  float rim = smoothstep( 0.62, 0.98, fres ) * uRim;
  outgoingLight += ( uRimColor * 0.6 + diffuseColor.rgb * 0.9 ) * rim * ( 0.25 + 0.75 * gToonLit );
}
`;

// patch a MeshToonMaterial (or MeshBasicMaterial with toon=false)
function patchShader(shader, u, flags, toon) {
  Object.assign(shader.uniforms, {
    uTime: U.uTime, uWind: U.uWind, uSunColor: U.uSunColor, uSunViewDir: U.uSunViewDir, uSunDir: U.uSunDir,
    uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uFogDensity: U.uFogDensity, uFogStart: U.uFogStart,
    uFogHeight: U.uFogHeight, uFogBase: U.uFogBase, uFogMax: U.uFogMax,
  }, u);
  let vs = shader.vertexShader;
  vs = vs.replace('#include <common>', '#include <common>\n' + VERT_COMMON);
  vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_SWAY);
  vs = vs.replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_WORLDPOS);
  shader.vertexShader = vs;

  let fs = shader.fragmentShader;
  fs = fs.replace('#include <common>', '#include <common>\n' + FRAG_COMMON);
  if (toon) {
    fs = fs.replace('#include <lights_toon_pars_fragment>', TOON_PARS);
    fs = fs.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_VARIATION);
    fs = fs.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_MOSS);
    fs = fs.replace('#include <opaque_fragment>', FRAG_RIM + '\n#include <opaque_fragment>\n#ifdef WR_NO_OUTLINE\ngl_FragColor.a = 0.0;\n#endif');
  } else {
    fs = fs.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n#ifdef WR_NO_OUTLINE\ngl_FragColor.a = min(gl_FragColor.a, 0.0);\n#endif');
  }
  fs = fs.replace('#include <fog_fragment>', 'gl_FragColor.rgb = wrFog( gl_FragColor.rgb, vWorldPos );');
  shader.fragmentShader = fs;
}

/**
 * Create a toon material.
 * opts: color, map, vertexColors, band [lo,hi], rim, rimColor, variation [amt, scale],
 *       moss [r,g,b,amt], sway, outline(bool), side, transparent, opacity, alphaTest,
 *       emissive, emissiveIntensity, emissiveMap, fogMul, flatShading
 */
export function toonMat(opts = {}) {
  const m = new THREE.MeshToonMaterial({
    color: opts.color !== undefined ? opts.color : 0xffffff,
    map: opts.map || null,
    vertexColors: !!opts.vertexColors,
    side: opts.side || THREE.FrontSide,
    transparent: !!opts.transparent,
    opacity: opts.opacity !== undefined ? opts.opacity : 1,
    alphaTest: opts.alphaTest || 0,
    emissive: opts.emissive !== undefined ? opts.emissive : 0x000000,
    emissiveIntensity: opts.emissiveIntensity !== undefined ? opts.emissiveIntensity : 1,
    emissiveMap: opts.emissiveMap || null,
    depthWrite: opts.depthWrite !== undefined ? opts.depthWrite : true,
  });
  m.fog = false;
  const band = opts.band || [0.0, 0.07];
  const moss = opts.moss || null;
  const u = {
    uBand: { value: new THREE.Vector2(band[0], band[1]) },
    uRim: { value: opts.rim !== undefined ? opts.rim : 0.28 },
    uRimColor: { value: new THREE.Color(opts.rimColor !== undefined ? opts.rimColor : 0xfff4dc) },
    uVar: { value: new THREE.Vector2(...(opts.variation || [0.06, 0.12])) },
    uMoss: { value: new THREE.Vector4(...(moss || [0.42, 0.58, 0.28, 0])) },
    uSway: { value: opts.sway || 0 },
    uFogMul: { value: opts.fogMul !== undefined ? opts.fogMul : 1 },
  };
  m.userData.u = u;
  const flags = [];
  if (opts.sway) flags.push('WR_SWAY');
  if (moss) flags.push('WR_MOSS');
  // alpha doubles as the outline mask, so only opaque surfaces may zero it
  if (opts.outline === false && !opts.transparent) flags.push('WR_NO_OUTLINE');
  m.defines = m.defines || {};
  for (const f of flags) m.defines[f] = '';
  m.onBeforeCompile = (shader) => patchShader(shader, u, flags, true);
  m.customProgramCacheKey = () => 'wrtoon|' + flags.join(',');
  return m;
}

// Unlit (emissive-style) material that still gets fog; colour may exceed 1 for bloom.
export function glowMat(color, intensity = 1, opts = {}) {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  const m = new THREE.MeshBasicMaterial({
    color: c,
    map: opts.map || null,
    transparent: !!opts.transparent,
    opacity: opts.opacity !== undefined ? opts.opacity : 1,
    side: opts.side || THREE.FrontSide,
    depthWrite: opts.depthWrite !== undefined ? opts.depthWrite : !opts.transparent,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    alphaTest: opts.alphaTest || 0,
  });
  m.fog = false;
  const u = { uFogMul: { value: opts.fogMul !== undefined ? opts.fogMul : 1 } };
  const flags = opts.outline === false && !opts.transparent ? ['WR_NO_OUTLINE'] : [];
  m.defines = {};
  for (const f of flags) m.defines[f] = '';
  m.userData.u = u;
  m.onBeforeCompile = (shader) => patchShader(shader, u, flags, false);
  m.customProgramCacheKey = () => 'wrbasic|' + flags.join(',');
  return m;
}

// ---------------------------------------------------------------------------
// Shared material library (lazily created)
const lib = new Map();
const DEFS = {
  ground: () => toonMat({ map: tex('cobble', 1), vertexColors: true, band: [-0.1, 0.25], rim: 0.0, variation: [0.07, 0.08] }),
  flag: () => toonMat({ map: tex('flag', 1), vertexColors: true, band: [-0.1, 0.25], rim: 0.0, variation: [0.06, 0.08] }),
  plaster: () => toonMat({ map: tex('plaster', 1), vertexColors: true, rim: 0.18, variation: [0.05, 0.3] }),
  wood: () => toonMat({ map: tex('wood', 1), vertexColors: true, rim: 0.2, variation: [0.08, 0.5] }),
  stone: () => toonMat({ map: tex('stoneWall', 1), vertexColors: true, rim: 0.18, variation: [0.07, 0.12] }),
  mossStone: () => toonMat({ map: tex('stoneWall', 1), vertexColors: true, rim: 0.18, variation: [0.08, 0.12], moss: [0.45, 0.6, 0.3, 0.75] }),
  roof: () => toonMat({ map: tex('roof', 1), vertexColors: true, rim: 0.2, variation: [0.07, 0.2], band: [0.0, 0.1] }),
  marble: () => toonMat({ map: tex('marble', 1), vertexColors: true, rim: 0.15, variation: [0.04, 0.1], band: [-0.05, 0.2] }),
  ruin: () => toonMat({ map: tex('ruin', 1), vertexColors: true, rim: 0.2, variation: [0.08, 0.15], moss: [0.42, 0.6, 0.28, 0.85] }),
  rock: () => toonMat({ vertexColors: true, color: 0xffffff, rim: 0.22, variation: [0.1, 0.25], moss: [0.43, 0.62, 0.27, 0.8], band: [-0.05, 0.15] }),
  metal: () => toonMat({ vertexColors: true, color: 0xffffff, rim: 0.5, rimColor: 0xcfe8ff, variation: [0.03, 1] }),
  gold: () => toonMat({ color: 0xd9ad4f, rim: 0.7, rimColor: 0xfff0b0, variation: [0.02, 1] }),
  glass: () => toonMat({ color: 0x3b5a78, rim: 0.6, rimColor: 0xbfe6ff, variation: [0.0, 1], emissive: 0x1a2a3a, emissiveIntensity: 0.4 }),
  cloth: () => toonMat({ vertexColors: true, color: 0xffffff, rim: 0.25, variation: [0.04, 0.5], side: THREE.DoubleSide }),
  bark: () => toonMat({ map: tex('bark', 1), vertexColors: true, rim: 0.15, variation: [0.08, 0.3] }),
  leaves: () => toonMat({ vertexColors: true, color: 0xffffff, rim: 0.35, rimColor: 0xf6ffc8, variation: [0.1, 0.18], band: [-0.25, 0.2], sway: 0.05 }),
  plain: () => toonMat({ vertexColors: true, color: 0xffffff, rim: 0.22, variation: [0.05, 0.3] }),
  plainDouble: () => toonMat({ vertexColors: true, color: 0xffffff, rim: 0.15, variation: [0.05, 0.3], side: THREE.DoubleSide }),
  ivy: () => toonMat({ map: tex('ivy', 1), alphaTest: 0.45, side: THREE.DoubleSide, rim: 0.1, band: [-0.2, 0.3], variation: [0.05, 0.5], outline: false }),
  awningRed: () => toonMat({ map: tex('awningRed', 1), side: THREE.DoubleSide, rim: 0.15 }),
  awningBlue: () => toonMat({ map: tex('awningBlue', 1), side: THREE.DoubleSide, rim: 0.15 }),
  awningGreen: () => toonMat({ map: tex('awningGreen', 1), side: THREE.DoubleSide, rim: 0.15 }),
  awningGold: () => toonMat({ map: tex('awningGold', 1), side: THREE.DoubleSide, rim: 0.15 }),
  bannerBlue: () => toonMat({ map: tex('bannerBlue', 1), side: THREE.DoubleSide, rim: 0.12, sway: 0.0 }),
  bannerRed: () => toonMat({ map: tex('bannerRed', 1), side: THREE.DoubleSide, rim: 0.12 }),
  bannerTeal: () => toonMat({ map: tex('bannerTeal', 1), side: THREE.DoubleSide, rim: 0.12 }),
  paper: () => toonMat({ map: tex('paper', 1), side: THREE.DoubleSide, rim: 0.1, outline: false }),
  runeGlow: () => glowMat(0x7fe8d8, 2.6),
  runeDim: () => glowMat(0x3a6f6a, 1.0),
  lampGlow: () => glowMat(0xffd88a, 2.2),
  black: () => new THREE.MeshBasicMaterial({ color: 0x0b0a0c }),
};

function tex(name, rep) {
  const t = getTex(name);
  if (rep !== 1) { t.repeat.set(rep, rep); }
  return t;
}

export function M(name) {
  if (!lib.has(name)) {
    const f = DEFS[name];
    if (!f) throw new Error('unknown material ' + name);
    lib.set(name, f());
  }
  return lib.get(name);
}

export function defineMaterial(name, factory) { DEFS[name] = factory; }
