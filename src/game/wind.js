// The Wind Rune: a cone-shaped gust that everything wind-reactive listens to.
import * as THREE from 'three';
import { U } from '../gfx/materials.js';

const RANGE = 15;
const HALF_ANGLE = Math.PI * 0.2; // ~36°
const _to = new THREE.Vector3();
const _d = new THREE.Vector3();

export class WindRune {
  constructor(game) {
    this.game = game;
    this.casts = 0;
  }

  // pick a gust direction: camera forward, assisted toward the best target
  aim(pos, fwd) {
    const zone = this.game.zone;
    const f = _d.set(fwd.x, 0, fwd.z).normalize();
    let best = null, bestScore = Infinity;
    const consider = (p, weight = 1) => {
      _to.set(p.x - pos.x, 0, p.z - pos.z);
      const dist = _to.length();
      if (dist < 0.5 || dist > RANGE + 2) return;
      _to.divideScalar(dist);
      const ang = Math.acos(Math.max(-1, Math.min(1, _to.dot(f))));
      if (ang > 0.75) return;
      const score = (ang * 2 + dist * 0.03) / weight;
      if (score < bestScore) { bestScore = score; best = p; }
    };
    if (zone) {
      for (const r of zone.windReceivers) {
        if (r.aimable === false || !r.windPoint) continue;
        if (r.windDone && r.windDone()) continue;
        consider(r.windPoint(), r.aimWeight || 1);
      }
      for (const e of zone.enemies) if (e.alive) consider(e.aimPoint ? e.aimPoint() : e.pos, 1.3);
    }
    const out = new THREE.Vector3();
    if (best) {
      out.set(best.x - pos.x, best.y - (pos.y + 1.3), best.z - pos.z);
      const h = Math.hypot(out.x, out.z);
      out.y = Math.max(-0.5 * h, Math.min(0.9 * h, out.y));
      out.normalize();
    } else out.copy(f);
    return out;
  }

  cast(origin, dir, caster) {
    const g = this.game, zone = g.zone;
    this.casts++;
    g.fx.windBurst(origin, dir);
    g.audio && g.audio.sfx('gust');
    g.cam.shake(0.18);
    g.hud && g.hud.runePulse();
    U.uGust.value.set(origin.x, origin.y, origin.z, U.uTime.value);
    U.uGustDir.value.set(dir.x, 0, dir.z).normalize();
    // some leaves / petals ride the gust
    g.fx.leaves(new THREE.Vector3(origin.x + dir.x * 2, origin.y - 0.8, origin.z + dir.z * 2), dir, 5, zone && zone.id === 'undercroft' ? 0xb0a080 : 0x86c250);
    if (!zone) return;
    const hdir = _d.set(dir.x, 0, dir.z).normalize().clone();
    const test = (p, radius = 0.5) => {
      _to.set(p.x - origin.x, 0, p.z - origin.z);
      const along = _to.dot(hdir);
      if (along < -1.2 || along > RANGE + radius) return null;
      const lateral = Math.abs(_to.x * hdir.z - _to.z * hdir.x);
      const allow = 1.3 + Math.max(0, along) * Math.tan(HALF_ANGLE) + radius;
      if (lateral > allow) return null;
      const expectY = origin.y + dir.y * Math.max(0, along) / Math.max(0.2, Math.hypot(dir.x, dir.z));
      if (Math.abs(p.y - expectY) > 3.2 + along * 0.35 + radius) return null;
      return { dist: Math.hypot(_to.x, _to.z), along };
    };
    const info = { origin: origin.clone(), dir: dir.clone(), hdir, caster };
    let hitSomething = false;
    for (const r of zone.windReceivers.slice()) {
      if (!r.windPoint || !r.onWind) continue;
      const res = test(r.windPoint(), r.windRadius || 0.6);
      if (!res) continue;
      info.dist = res.dist;
      info.strength = Math.max(0.55, 1 - res.dist / 32);
      if (r.onWind(info) !== false) hitSomething = true;
    }
    for (const e of zone.enemies) {
      if (!e.alive) continue;
      const res = test(e.aimPoint ? e.aimPoint() : e.pos, e.radius || 0.6);
      if (!res) continue;
      info.dist = res.dist;
      info.strength = Math.max(0.55, 1 - res.dist / 32);
      e.onWind(info);
      hitSomething = true;
    }
    return hitSomething;
  }
}
