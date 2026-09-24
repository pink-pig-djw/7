// Townsfolk with idle / wander / path behaviour and stage-aware dialogue.
import * as THREE from 'three';
import { Avatar, PRESETS } from './avatar.js';
import { dampAngle, wrapAngle, clamp } from '../core/util.js';

export class NPC {
  constructor(game, o) {
    this.game = game;
    this.id = o.id;
    this.name = o.name;
    this.avatar = new Avatar(Object.assign({}, PRESETS[o.preset] || PRESETS.merchant, o.spec || {}));
    this.pos = o.pos.clone();
    this.home = o.pos.clone();
    this.facing = o.yaw || 0;
    this.baseYaw = this.facing;
    this.mode = o.mode || 'idle';
    this.path = o.path || null;
    this.pathIdx = 0;
    this.speed = o.speed || 1.4;
    this.talkFn = o.talk;
    this.onTalked = o.onTalked || null;
    this.talking = false;
    this.interactRadius = o.radius || 2.6;
    this.wander = o.wander || 0;
    this.wanderT = 2;
    this.target = null;
    this.moving = false;
    this.hunch = !!o.hunch;
    this.hidden = false;
    this.col = null;
    this.colR = o.colRadius || 0.45;
    if (o.physics) this.col = o.physics.addCyl(this.pos.x, this.pos.z, this.colR, this.pos.y, this.pos.y + 1.7, { dynamic: true, blockCam: false, walkable: false });
    this.avatar.root.position.copy(this.pos);
    this.avatar.root.rotation.y = this.facing;
    this.bubble = null;
  }
  setPos(p, yaw = null) {
    this.pos.copy(p); this.home.copy(p);
    if (yaw !== null) { this.facing = yaw; this.baseYaw = yaw; }
    this.avatar.root.position.copy(p);
    if (this.col) this.syncCol();
  }
  syncCol() {
    const c = this.col, p = this.pos, r = this.colR;
    c.x = p.x; c.z = p.z; c.bottom = p.y; c.top = p.y + 1.7;
    c.minX = p.x - r; c.maxX = p.x + r; c.minZ = p.z - r; c.maxZ = p.z + r;
  }
  setHidden(v) { this.hidden = v; this.avatar.root.visible = !v; if (this.col) this.col.enabled = !v; }
  canInteract() { return !this.hidden && !!this.talkFn; }
  prompt() { return '交谈 · ' + this.name; }
  interact(g) {
    const lines = this.talkFn(g, this);
    if (!lines || !lines.length) return;
    this.talking = true;
    const p = g.player;
    p.facing = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z);
    g.talk(lines.map((l) => (typeof l === 'string' ? { name: this.name, text: l } : l)), () => {
      this.talking = false;
      if (this.onTalked) this.onTalked(g, this);
    });
  }
  update(dt) {
    if (this.hidden) return;
    const g = this.game, p = g.player.pos;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    let mode = this.mode;
    let speed = 0;
    if (this.talking) {
      this.facing = dampAngle(this.facing, Math.atan2(dx, dz), 6, dt);
      mode = this.mode === 'sit' ? 'sit' : 'talk';
    } else if (this.path && this.mode !== 'sit') {
      const t = this.path[this.pathIdx];
      const tx = t.x - this.pos.x, tz = t.z - this.pos.z;
      const d = Math.hypot(tx, tz);
      if (d < 0.4) this.pathIdx = (this.pathIdx + 1) % this.path.length;
      else {
        // pause briefly if the player is right in the way
        const block = dist < 1.3;
        if (!block) {
          speed = this.speed;
          this.facing = dampAngle(this.facing, Math.atan2(tx, tz), 5, dt);
          this.pos.x += Math.sin(this.facing) * speed * dt;
          this.pos.z += Math.cos(this.facing) * speed * dt;
          mode = 'move';
        }
      }
    } else if (this.wander > 0) {
      this.wanderT -= dt;
      if (!this.target && this.wanderT <= 0) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * this.wander;
        this.target = new THREE.Vector3(this.home.x + Math.cos(a) * r, this.home.y, this.home.z + Math.sin(a) * r);
      }
      if (this.target) {
        const tx = this.target.x - this.pos.x, tz = this.target.z - this.pos.z;
        const d = Math.hypot(tx, tz);
        if (d < 0.3 || dist < 1.4) { this.target = null; this.wanderT = 2 + Math.random() * 4; }
        else {
          speed = this.speed * 0.7;
          this.facing = dampAngle(this.facing, Math.atan2(tx, tz), 4, dt);
          this.pos.x += Math.sin(this.facing) * speed * dt;
          this.pos.z += Math.cos(this.facing) * speed * dt;
          mode = 'move';
        }
      }
    } else if (mode !== 'sit' && mode !== 'dance') {
      // turn toward the player when close, back to base yaw otherwise
      const want = dist < 5 ? Math.atan2(dx, dz) : this.baseYaw;
      this.facing = dampAngle(this.facing, want, 2.5, dt);
    }
    // ground follow
    const P = this.zone && this.zone.physics;
    if (P && speed > 0) this.pos.y = P.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.3, 0.5).h;
    // head look
    let lookYaw = 0, lookPitch = 0;
    if (dist < 7 && !this.talking) {
      lookYaw = clamp(wrapAngle(Math.atan2(dx, dz) - this.facing), -1.1, 1.1);
      lookPitch = -0.1;
    }
    this.avatar.animate(dt, { mode, speed, lookYaw, lookPitch, hunch: this.hunch });
    this.avatar.root.position.copy(this.pos);
    this.avatar.root.rotation.y = this.facing;
    if (this.col) this.syncCol();
  }
}
