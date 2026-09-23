// Third-person orbit camera with collision and a small cinematic system.
import * as THREE from 'three';
import { clamp, damp, easeInOut, lerp } from '../core/util.js';

const _dir = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.yaw = 0;
    this.pitch = 0.32;
    this.dist = 5.6;
    this.targetDist = 5.6;
    this.minDist = 2.4;
    this.maxDist = 11;
    this.collDist = 5.6;
    this.focus = new THREE.Vector3();
    this.focusInit = false;
    this.shakeAmt = 0;
    this.shakeT = 0;
    this.baseFov = 55;
    this.fov = 55;
    this.shots = null;
    this.shotT = 0;
    this.onShotsDone = null;
    this.lookOffset = new THREE.Vector3();
    this.autoYaw = null;
    this.lastLook = new THREE.Vector3();
  }

  // horizontal forward/right vectors for movement input
  forward(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right(out) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }

  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }

  snapTo(focus, yaw = this.yaw) {
    this.focus.copy(focus);
    this.yaw = yaw;
    this.focusInit = true;
    this.collDist = this.dist;
  }

  // shots: [{pos:[x,y,z] | Vector3, look, dur, pos2?, look2?, fov?}] each shot lerps pos->pos2 & look->look2
  play(shots, onDone) {
    this.shots = shots.map((s) => ({
      pos: v3(s.pos), look: v3(s.look), pos2: v3(s.pos2 || s.pos), look2: v3(s.look2 || s.look),
      dur: s.dur || 2, fov: s.fov || this.baseFov, ease: s.ease !== false, onStart: s.onStart, started: false,
    }));
    this.shotIdx = 0;
    this.shotT = 0;
    this.onShotsDone = onDone || null;
  }
  get cinematic() { return !!this.shots; }
  skip() {
    if (!this.shots) return;
    for (let i = this.shotIdx; i < this.shots.length; i++) { const s = this.shots[i]; if (!s.started && s.onStart) { s.started = true; s.onStart(); } }
    this.shots = null;
    const cb = this.onShotsDone; this.onShotsDone = null;
    if (cb) cb();
  }

  update(dt, input, target, physics, opts = {}) {
    const cam = this.cam;
    if (this.shots) {
      const s = this.shots[this.shotIdx];
      if (!s.started) { s.started = true; if (s.onStart) s.onStart(); }
      this.shotT += dt;
      let k = clamp(this.shotT / s.dur, 0, 1);
      if (s.ease) k = easeInOut(k);
      _pos.lerpVectors(s.pos, s.pos2, k);
      _look.lerpVectors(s.look, s.look2, k);
      cam.position.copy(_pos);
      this.applyShake(dt);
      cam.lookAt(_look);
      this.lastLook.copy(_look);
      this.fov = damp(this.fov, s.fov, 4, dt);
      if (this.shotT >= s.dur) {
        this.shotIdx++;
        this.shotT = 0;
        if (this.shotIdx >= this.shots.length) {
          this.shots = null;
          // resume orbit from current camera placement
          const cb = this.onShotsDone; this.onShotsDone = null;
          if (cb) cb();
        }
      }
      this._fov(dt);
      return;
    }

    // --- orbit input
    if (input && opts.control !== false) {
      const sens = input.sensitivity || 1;
      this.yaw -= input.dx * 0.0024 * sens;
      this.pitch += input.dy * 0.0021 * sens * (input.invertY ? -1 : 1);
      if (input.down('camLeft')) this.yaw += 2.2 * dt;
      if (input.down('camRight')) this.yaw -= 2.2 * dt;
      if (input.down('camUp')) this.pitch -= 1.5 * dt;
      if (input.down('camDown')) this.pitch += 1.5 * dt;
      if (input.wheel) this.targetDist = clamp(this.targetDist + input.wheel * 0.7, this.minDist, this.maxDist);
    }
    if (this.autoYaw !== null) {
      this.yaw += Math.atan2(Math.sin(this.autoYaw - this.yaw), Math.cos(this.autoYaw - this.yaw)) * (1 - Math.exp(-3 * dt));
    }
    this.pitch = clamp(this.pitch, -0.55, 1.2);
    const maxD = opts.maxDist || this.maxDist;
    this.dist = damp(this.dist, Math.min(this.targetDist, maxD), 6, dt);

    // --- smooth focus
    if (!this.focusInit) { this.focus.copy(target); this.focusInit = true; }
    this.focus.x = damp(this.focus.x, target.x, 14, dt);
    this.focus.z = damp(this.focus.z, target.z, 14, dt);
    this.focus.y = damp(this.focus.y, target.y, opts.fastY ? 16 : 9, dt);

    // --- desired position
    const cp = Math.cos(this.pitch);
    _dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    let want = this.dist;
    if (physics) {
      const hit = physics.raycast(this.focus.x, this.focus.y, this.focus.z, _dir.x, _dir.y, _dir.z, this.dist + 0.35, { cam: true });
      want = Math.max(0.7, Math.min(this.dist, hit - 0.35));
    }
    this.collDist = want < this.collDist ? damp(this.collDist, want, 25, dt) : damp(this.collDist, want, 3.5, dt);
    _pos.copy(this.focus).addScaledVector(_dir, this.collDist);
    if (physics) {
      const gh = physics.terrain(_pos.x, _pos.z) + 0.35;
      if (_pos.y < gh) _pos.y = gh;
    }
    cam.position.copy(_pos);
    this.applyShake(dt);
    _look.copy(this.focus).add(this.lookOffset);
    cam.lookAt(_look);
    this.lastLook.copy(_look);
    this.fov = damp(this.fov, opts.fov || this.baseFov, 5, dt);
    this._fov(dt);
  }

  applyShake(dt) {
    if (this.shakeAmt > 0.001) {
      this.shakeT += dt * 40;
      const a = this.shakeAmt * this.shakeAmt;
      this.cam.position.x += (Math.sin(this.shakeT * 1.3) + Math.sin(this.shakeT * 2.9)) * 0.08 * a;
      this.cam.position.y += (Math.sin(this.shakeT * 1.7 + 1) + Math.sin(this.shakeT * 3.3)) * 0.08 * a;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    }
  }

  _fov() {
    if (Math.abs(this.cam.fov - this.fov) > 0.01) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
  }

  // set orbit so that the camera ends where it currently is (after cinematics)
  syncFromCamera(focus) {
    const d = _dir.subVectors(this.cam.position, focus);
    const len = d.length() || 1;
    this.yaw = Math.atan2(d.x, d.z);
    this.pitch = clamp(Math.asin(clamp(d.y / len, -1, 1)), -0.55, 1.2);
    this.focus.copy(focus);
    this.collDist = clamp(len, 1, this.maxDist);
    this.dist = this.collDist;
  }
}

// play shots, then hold the final framing; `done` fires on a timer after the real shots
export function playHeld(game, shots, done) {
  const last = shots[shots.length - 1];
  const hold = { pos: last.pos2 || last.pos, look: last.look2 || last.look, dur: 9999, ease: false };
  game.cam.play([...shots, hold]);
  const total = shots.reduce((a, s) => a + (s.dur || 2), 0);
  if (done) game.after(total, done);
}

function v3(a) {
  if (!a) return new THREE.Vector3();
  if (a.isVector3) return a.clone();
  return new THREE.Vector3(a[0], a[1], a[2]);
}
export { lerp };
