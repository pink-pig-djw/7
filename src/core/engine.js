// Renderer + post-processing pipeline:
//   scene -> HDR MSAA target (+depth texture)
//   bright pass -> blur (1/4) -> blur (1/8)          (bloom)
//   composite: depth-laplacian outlines (masked by alpha), bloom, tone curve, grading
import * as THREE from 'three';
import { U } from '../gfx/materials.js';

const FS_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

class FSPass {
  constructor(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  render(renderer, target) {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
  }
}

const BRIGHT_FRAG = /* glsl */`
uniform sampler2D tColor; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D( tColor, vUv + uTexel * vec2( -1.0, -1.0 ) ).rgb
         + texture2D( tColor, vUv + uTexel * vec2( 1.0, -1.0 ) ).rgb
         + texture2D( tColor, vUv + uTexel * vec2( -1.0, 1.0 ) ).rgb
         + texture2D( tColor, vUv + uTexel * vec2( 1.0, 1.0 ) ).rgb;
  c *= 0.25;
  float l = max( c.r, max( c.g, c.b ) );
  float soft = clamp( l - uThreshold + uKnee, 0.0, 2.0 * uKnee );
  soft = soft * soft / ( 4.0 * uKnee + 1e-4 );
  float contrib = max( soft, l - uThreshold ) / max( l, 1e-4 );
  gl_FragColor = vec4( min( c * contrib, vec3( 8.0 ) ), 1.0 );
}`;

const DOWN_FRAG = /* glsl */`
uniform sampler2D tInput; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D( tInput, vUv + uTexel * vec2( -1.0, -1.0 ) ).rgb
         + texture2D( tInput, vUv + uTexel * vec2( 1.0, -1.0 ) ).rgb
         + texture2D( tInput, vUv + uTexel * vec2( -1.0, 1.0 ) ).rgb
         + texture2D( tInput, vUv + uTexel * vec2( 1.0, 1.0 ) ).rgb;
  gl_FragColor = vec4( c * 0.25, 1.0 );
}`;

const BLUR_FRAG = /* glsl */`
uniform sampler2D tInput; uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D( tInput, vUv ).rgb * 0.227027;
  c += texture2D( tInput, vUv + uDir * 1.3846 ).rgb * 0.316216;
  c += texture2D( tInput, vUv - uDir * 1.3846 ).rgb * 0.316216;
  c += texture2D( tInput, vUv + uDir * 3.2308 ).rgb * 0.070270;
  c += texture2D( tInput, vUv - uDir * 3.2308 ).rgb * 0.070270;
  gl_FragColor = vec4( c, 1.0 );
}`;

const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tBloom1;
uniform sampler2D tBloom2;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uLineW;
uniform vec3 uOutlineColor;
uniform float uOutlineStrength;
uniform vec2 uOutlineFade;
uniform vec2 uEdge;
uniform float uBloom;
uniform float uExposure;
uniform float uSat;
uniform float uContrast;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uVignette;
uniform float uTime;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uDesat;
varying vec2 vUv;

float invZ( float d ) { return ( uFar - d * ( uFar - uNear ) ) / ( uNear * uFar ); }
float hash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
vec3 shoulder( vec3 x ) {
  const float k = 0.78;
  vec3 over = max( x - k, 0.0 );
  return min( x, vec3( k ) ) + ( 1.0 - k ) * ( 1.0 - exp( -over / ( 1.0 - k ) ) );
}
vec3 toSRGB( vec3 c ) {
  c = clamp( c, 0.0, 1.0 );
  return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
}

void main() {
  vec4 c = texture2D( tColor, vUv );
  vec3 col = c.rgb;

  #ifdef USE_OUTLINE
  vec2 o = uTexel * uLineW;
  float w0 = invZ( texture2D( tDepth, vUv ).x );
  float wl = invZ( texture2D( tDepth, vUv - vec2( o.x, 0.0 ) ).x );
  float wr = invZ( texture2D( tDepth, vUv + vec2( o.x, 0.0 ) ).x );
  float wu = invZ( texture2D( tDepth, vUv + vec2( 0.0, o.y ) ).x );
  float wd = invZ( texture2D( tDepth, vUv - vec2( 0.0, o.y ) ).x );
  float lap = abs( wl + wr - 2.0 * w0 ) + abs( wu + wd - 2.0 * w0 );
  float wmax = max( max( max( wl, wr ), max( wu, wd ) ), w0 );
  float e = lap / wmax;
  float edge = smoothstep( uEdge.x, uEdge.y, e );
  vec2 nOff = vec2( 0.0 );
  float sideW = 1.0;
  if ( w0 < wmax ) {
    sideW = 0.7;
    if ( wl >= wmax ) nOff = vec2( -o.x, 0.0 );
    else if ( wr >= wmax ) nOff = vec2( o.x, 0.0 );
    else if ( wu >= wmax ) nOff = vec2( 0.0, o.y );
    else nOff = vec2( 0.0, -o.y );
  }
  float mask = texture2D( tColor, vUv + nOff ).a;
  edge *= step( 0.5, mask ) * sideW;
  float dist = 1.0 / wmax;
  edge *= 1.0 - smoothstep( uOutlineFade.x, uOutlineFade.y, dist );
  col = mix( col, col * uOutlineColor, clamp( edge * uOutlineStrength, 0.0, 1.0 ) );
  #endif

  #ifdef USE_BLOOM
  vec3 bl = texture2D( tBloom1, vUv ).rgb * 0.55 + texture2D( tBloom2, vUv ).rgb * 0.85;
  col += bl * uBloom;
  #endif

  col *= uExposure;
  col = shoulder( col );
  float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
  col = mix( vec3( l ), col, uSat * ( 1.0 - uDesat ) );
  col = col * uGain + uLift * ( 1.0 - col );

  vec3 s = toSRGB( col );
  s = ( s - 0.5 ) * uContrast + 0.5;
  vec2 vc = vUv - 0.5;
  float vig = smoothstep( 0.9, 0.25, length( vc * vec2( 1.1, 1.0 ) ) );
  s *= mix( 1.0, vig, uVignette );
  s = mix( s, uFlashColor, uFlash );
  s += ( hash12( gl_FragCoord.xy + fract( uTime ) * 71.0 ) - 0.5 ) / 255.0;
  gl_FragColor = vec4( s, 1.0 );
}`;

export const QUALITY = {
  low: { pixelRatio: 0.85, msaa: 0, shadow: 1024, bloom: true, outline: true, grass: 0.35, grassDist: 38, shadowSoft: false },
  medium: { pixelRatio: 1.0, msaa: 4, shadow: 2048, bloom: true, outline: true, grass: 0.65, grassDist: 46, shadowSoft: true },
  high: { pixelRatio: 1.5, msaa: 4, shadow: 2048, bloom: true, outline: true, grass: 1.0, grassDist: 56, shadowSoft: true },
};

export class Engine {
  constructor(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
    if (!renderer.capabilities.isWebGL2) throw new Error('需要支持 WebGL2 的浏览器');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x000000, 0);
    renderer.info.autoReset = false;
    container.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = 0;
    this.renderer = renderer;
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
    // rough GPU class for choosing a default quality preset
    this.gpu = '';
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      this.gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    } catch (e) { /* ignore */ }
    this.weakGPU = /Intel|UHD|Iris|HD Graphics|Mali|Adreno|PowerVR|Apple GPU|SwiftShader|llvmpipe|Microsoft Basic/i.test(this.gpu);
    this.qualityName = 'high';
    this.q = QUALITY.high;
    this.size = new THREE.Vector2();

    this.passBright = new FSPass(new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: BRIGHT_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.05 }, uKnee: { value: 0.35 } },
    }));
    this.passDown = new FSPass(new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: DOWN_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tInput: { value: null }, uTexel: { value: new THREE.Vector2() } },
    }));
    this.passBlur = new FSPass(new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tInput: { value: null }, uDir: { value: new THREE.Vector2() } },
    }));
    this.post = {
      tColor: { value: null }, tDepth: { value: null }, tBloom1: { value: null }, tBloom2: { value: null },
      uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 2500 },
      uLineW: { value: 1 }, uOutlineColor: { value: new THREE.Color(0.3, 0.26, 0.3) }, uOutlineStrength: { value: 0.85 },
      uOutlineFade: { value: new THREE.Vector2(55, 140) }, uEdge: { value: new THREE.Vector2(0.018, 0.06) },
      uBloom: { value: 0.55 }, uExposure: { value: 1.0 }, uSat: { value: 1.1 }, uContrast: { value: 1.04 },
      uLift: { value: new THREE.Color(0.012, 0.014, 0.03) }, uGain: { value: new THREE.Color(1.0, 0.995, 0.98) },
      uVignette: { value: 0.28 }, uTime: { value: 0 }, uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color(1, 1, 1) },
      uDesat: { value: 0 },
    };
    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: COMPOSITE_FRAG, uniforms: this.post, depthTest: false, depthWrite: false,
      defines: { USE_OUTLINE: '', USE_BLOOM: '' },
    });
    this.passComposite = new FSPass(this.compositeMat);

    this.targets = null;
    this.setQuality('high');
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(name) {
    this.qualityName = QUALITY[name] ? name : 'high';
    this.q = QUALITY[this.qualityName];
    const d = this.compositeMat.defines;
    if (this.q.outline) d.USE_OUTLINE = ''; else delete d.USE_OUTLINE;
    if (this.q.bloom) d.USE_BLOOM = ''; else delete d.USE_BLOOM;
    this.compositeMat.needsUpdate = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.resize(true);
    if (this.onQuality) this.onQuality(this.q);
  }

  resize(force = false) {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    const pr = Math.min(window.devicePixelRatio || 1, this.q.pixelRatio);
    if (!force && this.size.x === w && this.size.y === h && this._pr === pr) return;
    this._pr = pr;
    this.size.set(w, h);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    const W = Math.floor(w * pr), H = Math.floor(h * pr);
    this.W = W; this.H = H;
    if (this.targets) for (const t of Object.values(this.targets)) t.dispose();
    const depthTex = new THREE.DepthTexture(W, H, THREE.FloatType);
    const main = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.HalfFloatType, samples: this.q.msaa, depthBuffer: true, stencilBuffer: false, depthTexture: depthTex,
    });
    const mk = (s) => new THREE.WebGLRenderTarget(Math.max(1, Math.floor(W / s)), Math.max(1, Math.floor(H / s)), {
      type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.targets = { main, b4a: mk(4), b4b: mk(4), b8a: mk(8), b8b: mk(8) };
    this.post.uTexel.value.set(1 / W, 1 / H);
    this.post.uLineW.value = Math.max(1, Math.round(H / 1100));
    if (this.onResize) this.onResize(w, h);
  }

  render(scene, camera, dt = 0) {
    const r = this.renderer;
    const T = this.targets;
    camera.updateMatrixWorld();
    U.uSunViewDir.value.copy(U.uSunDir.value).transformDirection(camera.matrixWorldInverse);
    this.post.uNear.value = camera.near;
    this.post.uFar.value = camera.far;
    this.post.uTime.value += dt;
    r.info.reset();

    r.setRenderTarget(T.main);
    r.clear(true, true, false);
    r.render(scene, camera);

    if (this.q.bloom) {
      const pb = this.passBright.mesh.material.uniforms;
      pb.tColor.value = T.main.texture;
      pb.uTexel.value.set(1 / this.W, 1 / this.H);
      this.passBright.render(r, T.b4a);
      this.blur(T.b4a, T.b4b);
      const pd = this.passDown.mesh.material.uniforms;
      pd.tInput.value = T.b4a.texture;
      pd.uTexel.value.set(1 / T.b4a.width, 1 / T.b4a.height);
      this.passDown.render(r, T.b8a);
      this.blur(T.b8a, T.b8b);
      this.blur(T.b8a, T.b8b);
    }
    const P = this.post;
    P.tColor.value = T.main.texture;
    P.tDepth.value = T.main.depthTexture;
    P.tBloom1.value = T.b4a.texture;
    P.tBloom2.value = T.b8a.texture;
    this.passComposite.render(r, null);
  }

  blur(a, b) {
    const u = this.passBlur.mesh.material.uniforms;
    u.tInput.value = a.texture; u.uDir.value.set(1 / a.width, 0);
    this.passBlur.render(this.renderer, b);
    u.tInput.value = b.texture; u.uDir.value.set(0, 1 / b.height);
    this.passBlur.render(this.renderer, a);
  }

  // plain render into an 8-bit sRGB target and read back pixels (used for the minimap)
  snapshot(scene, camera, w, h) {
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: true });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    camera.updateMatrixWorld();
    U.uSunViewDir.value.copy(U.uSunDir.value).transformDirection(camera.matrixWorldInverse);
    this.renderer.setRenderTarget(rt);
    this.renderer.setClearColor(0xcbbf9c, 1);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setClearColor(0x000000, 0);
    const buf = new Uint8Array(w * h * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    this.renderer.setRenderTarget(null);
    rt.dispose();
    return buf;
  }
}
