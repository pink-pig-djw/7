// Player controller: movement, jump, sprint, dodge, sword combo, rune cast,
// fixed-zone climbing, mantling, swimming, damage & respawn.
import * as THREE from 'three';
import { Avatar, PRESETS } from './avatar.js';
import { Body } from './physics.js';
import { clamp, damp, dampAngle, wrapAngle, lerp, easeOutCubic, easeInOut } from '../core/util.js';

const RUN = 6.2, SPRINT = 9.4, SWIM = 2.8, SWIM_FAST = 4.6;
const JUMP_V = 8.6;
const GRAV = 25;
const ATTACK_DUR = [0.34, 0.34, 0.52];

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _v = new THREE.Vector3(), _t = new THREE.Vector3();

function approachVec(v, tx, tz, maxDelta) {
  const dx = tx - v.x, dz = tz - v.z;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d < 1e-6) { v.x = tx; v.z = tz; } else { v.x += (dx / d) * maxDelta; v.z += (dz / d) * maxDelta; }
}

export class Player {
  constructor(game) {
    this.game = game;
    this.avatar = new Avatar(PRESETS.hero);
    this.root = this.avatar.root;
    this.body = new Body(null, { radius: 0.36, height: 1.72, stepUp: 0.45, gravity: GRAV });
    this.pos = this.body.pos;
    this.vel = this.body.vel;
    this.facing = 0;     // logical heading (movement, attacks, casts)
    this.yawVis = 0;     // rendered heading: follows `facing` with a capped turn speed
    this.turnVel = 0;    // smoothed angular velocity while steering
    this._sep = {};
    this.state = 'ground';
    this.stateT = 0;
    this.maxHp = 8;
    this.hp = 8;
    this.stamina = 1;
    this.exhausted = false;
    this.stamDelay = 0;
    this.invuln = 0;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.combo = 0;
    this.comboQueued = false;
    this.hitDone = false;
    this.runeCD = 0;
    this.castFired = false;
    this.climb = null;
    this.climbU = 0;
    this.climbJump = 0;
    this.mantle = null;
    this.sheathT = 0;
    this.dodgeCD = 0;
    this.lastSafe = new THREE.Vector3();
    this.safeT = 0;
    this.moveDir = new THREE.Vector3();
    this.inputMag = 0;
    this.pushT = 0;
    this.stepDist = 0;
    this.turn = 0;
    this.speed = 0;
    this.sprinting = false;
    this.castDir = new THREE.Vector3(0, 0, 1);
    this.god = false;
    this.swimY = 0;
  }

  get grounded() { return this.body.grounded; }

  teleport(p, yaw = null) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    if (yaw !== null) this.facing = yaw;
    this.state = 'ground';
    this.stateT = 0;
    this.climb = null;
    this.mantle = null;
    this.body.noGravity = false;
    this.body.grounded = false;
    this.lastSafe.copy(p);
    this.avatar.resetSecondary();
    this.yawVis = this.facing;
    this.turnVel = 0;
    this.root.position.copy(p);
    this.root.rotation.y = this.facing;
  }

  setState(s) {
    if (this.state === 'swim' && s !== 'swim') this.body.noGravity = false;
    this.state = s;
    this.stateT = 0;
  }

  update(dt) {
    const g = this.game, inp = g.input, zone = g.zone;
    const ctl = g.controlEnabled && this.state !== 'dead';
    this.stateT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.runeCD = Math.max(0, this.runeCD - dt);
    this.dodgeCD = Math.max(0, this.dodgeCD - dt);
    this.climbJump = Math.max(0, this.climbJump - dt);

    // movement intent relative to camera
    let mx = 0, my = 0;
    if (ctl) { const mv = inp.moveVector(); mx = mv.x; my = mv.y; }
    const f = g.cam.forward(_f), r = g.cam.right(_r);
    this.moveDir.set(f.x * my + r.x * mx, 0, f.z * my + r.z * mx);
    this.inputMag = Math.min(1, this.moveDir.length());
    if (this.inputMag > 0.01) this.moveDir.normalize();

    let drain = 0;
    const B = this.body;
    const st = this.state;

    if (st === 'ground') {
      this.updateNormal(dt, ctl, inp);
      if (this.sprinting) drain = 0.19;
    } else if (st === 'roll') {
      const dur = 0.44;
      const k = this.stateT / dur;
      const sp = lerp(11.5, 4, k);
      this.vel.x = this._rollDir.x * sp;
      this.vel.z = this._rollDir.z * sp;
      B.move(dt);
      if (this.stateT >= dur) { this.setState('ground'); this.dodgeCD = 0.15; }
    } else if (st === 'attack') {
      this.updateAttack(dt, ctl, inp);
    } else if (st === 'cast') {
      this.updateCast(dt);
    } else if (st === 'hurt') {
      approachVec(this.vel, 0, 0, 20 * dt);
      B.move(dt);
      if (this.stateT > 0.38) this.setState('ground');
    } else if (st === 'climb') {
      drain = this.updateClimb(dt, ctl, inp, mx, my);
    } else if (st === 'mantle') {
      this.updateMantle(dt);
    } else if (st === 'swim') {
      drain = this.updateSwim(dt, ctl, inp);
    } else if (st === 'locked' || st === 'dead') {
      approachVec(this.vel, 0, 0, 30 * dt);
      if (st !== 'dead') B.move(dt);
    }
    if (this.state !== 'dead' && this.state !== 'climb' && this.state !== 'mantle') this.separateEnemies();

    // water entry
    if (zone && this.state !== 'swim' && this.state !== 'climb' && this.state !== 'mantle' && this.state !== 'dead') {
      const wy = zone.physics.water(this.pos.x, this.pos.z);
      if (wy > this.pos.y + 1.3) this.enterSwim(wy);
    }

    // stamina
    if (drain > 0) {
      this.stamina = Math.max(0, this.stamina - drain * dt);
      this.stamDelay = 0.9;
      if (this.stamina <= 0 && !this.exhausted) { this.exhausted = true; g.audio && g.audio.sfx('exhaust'); }
    } else {
      this.stamDelay -= dt;
      if (this.stamDelay <= 0 && (this.grounded || this.state === 'swim')) {
        this.stamina = Math.min(1, this.stamina + (this.exhausted ? 0.32 : 0.5) * dt);
        if (this.stamina >= 1) this.exhausted = false;
      }
    }

    // hazards & safe position tracking
    if (zone && this.state !== 'dead') {
      if ((zone.killY !== undefined && this.pos.y < zone.killY) || (zone.hazard && zone.hazard(this.pos))) {
        g.fallRespawn();
      } else if (this.grounded && this.state === 'ground') {
        this.safeT += dt;
        if (this.safeT > 0.4 && !(B.groundC && B.groundC.dynamic) && (!zone.unsafe || !zone.unsafe(this.pos))) { this.lastSafe.copy(this.pos); this.safeT = 0; }
      }
    }

    // sword auto-sheath
    if (!this.avatar.sheathed && this.state !== 'attack') {
      this.sheathT += dt;
      if (this.sheathT > 3.2) this.avatar.sheathSword();
    }

    // footsteps
    if (this.grounded && (this.state === 'ground') && this.speed > 1) {
      this.stepDist += this.speed * dt;
      const stride = this.sprinting ? 1.35 : 1.05;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        g.audio && g.audio.step(zone ? zone.surface : 'stone', this.sprinting);
        if (this.sprinting && g.fx) g.fx.dust(this.pos, 2);
      }
    }

    this.animate(dt);
  }

  updateNormal(dt, ctl, inp) {
    const g = this.game, B = this.body;
    const grounded = B.grounded;
    this.sprinting = ctl && inp.down('sprint') && this.inputMag > 0.1 && !this.exhausted && grounded;
    const target = this.inputMag > 0.1 ? (this.sprinting ? SPRINT : RUN) * this.inputMag : 0;
    // movement answers the stick immediately (precise on narrow ledges and bridges) ...
    approachVec(this.vel, this.moveDir.x * target, this.moveDir.z * target, (grounded ? (target > 0 ? 55 : 42) : 15) * dt);
    if (this.inputMag > 0.1) {
      // ... while the body turns toward it with a capped, smoothed angular speed: quick pivots from a
      // standstill and on reversals, a steadier sweep when running or sprinting
      const want = Math.atan2(this.moveDir.x, this.moveDir.z);
      const diff = wrapAngle(want - this.facing);
      const spd = Math.hypot(this.vel.x, this.vel.z);
      let maxRate = grounded ? lerp(14, this.sprinting ? 8 : 10, clamp(spd / RUN, 0, 1)) : 6;
      if (grounded && Math.abs(diff) > 2.3) maxRate = 15;
      this.turnVel = damp(this.turnVel, clamp(diff * 14, -maxRate, maxRate), 26, dt);
      let step = this.turnVel * dt;
      if (Math.abs(step) > Math.abs(diff)) { step = diff; this.turnVel = diff / Math.max(dt, 1e-4); }
      this.facing = wrapAngle(this.facing + step);
      this.turn = clamp(this.turnVel / 10, -1, 1);
    } else {
      this.turnVel = damp(this.turnVel, 0, 20, dt);
      this.turn *= 0.9;
    }

    if (grounded) this.coyote = 0.12; else this.coyote -= dt;
    if (ctl && inp.hit('jump')) this.jumpBuf = 0.15; else this.jumpBuf -= dt;
    if (this.jumpBuf > 0 && this.coyote > 0) {
      this.vel.y = JUMP_V;
      this.coyote = 0; this.jumpBuf = 0;
      B.grounded = false;
      g.audio && g.audio.sfx('jump');
      g.fx && g.fx.dust(this.pos, 4);
    }
    if (ctl && inp.hit('dodge') && grounded && this.dodgeCD <= 0) {
      this._rollDir = this.inputMag > 0.1 ? this.moveDir.clone() : new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
      this.facing = Math.atan2(this._rollDir.x, this._rollDir.z);
      this.setState('roll');
      g.audio && g.audio.sfx('roll');
      g.fx && g.fx.dust(this.pos, 6);
      return;
    }
    if (ctl && inp.hit('attack')) { this.startAttack(0); return; }
    if (ctl && inp.hit('rune')) { this.tryCast(); if (this.state === 'cast') return; }

    const wasGrounded = grounded;
    B.move(dt);
    if (!wasGrounded && B.grounded && B.landSpeed < -9) {
      g.audio && g.audio.sfx('land');
      g.fx && g.fx.dust(this.pos, 6);
      if (B.landSpeed < -16) g.cam.shake(0.35);
    }
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // climb attach
    if (this.tryAttachClimb()) return;
    // mantle / vault
    if (B.hitWall && ctl) {
      const into = -(this.moveDir.x * B.wallNX + this.moveDir.z * B.wallNZ);
      const rel = B.wallTop - this.pos.y;
      if (into > 0.35 && rel > 0.45) {
        if (!B.grounded && rel < 1.6 && this.vel.y < 4) { if (this.tryMantle()) return; }
        if (B.grounded && rel < 1.15) {
          this.pushT += dt;
          if (this.pushT > 0.16 && this.tryMantle()) { this.pushT = 0; return; }
        }
      } else this.pushT = 0;
    } else this.pushT = 0;
  }

  startAttack(idx) {
    const g = this.game;
    if (this.avatar.sheathed) this.avatar.drawSword();
    this.sheathT = 0;
    this.combo = idx;
    this.comboQueued = false;
    this.hitDone = false;
    this.setState('attack');
    // auto-face nearest enemy
    const tgt = g.nearestEnemy ? g.nearestEnemy(this.pos, 5) : null;
    this.lungeExtra = 0;
    if (tgt) {
      this.facing = Math.atan2(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z);
      // close the gap so swings connect (distance covered over the lunge window)
      const d = Math.hypot(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z) - (tgt.radius || 0.5) - 0.9;
      if (d > 0) this.lungeExtra = Math.min(12, d / (ATTACK_DUR[idx] * 0.35 * 0.5));
    } else if (this.inputMag > 0.1) this.facing = Math.atan2(this.moveDir.x, this.moveDir.z);
    g.audio && g.audio.sfx(idx === 2 ? 'swing2' : 'swing');
    g.fx && g.fx.startSlash(this);
  }

  updateAttack(dt, ctl, inp) {
    const g = this.game;
    const dur = ATTACK_DUR[this.combo];
    const k = this.stateT / dur;
    const lunge = k < 0.35 ? ((this.combo === 2 ? 4.5 : 3.2) + (this.lungeExtra || 0)) * (1 - k / 0.35) : 0;
    this.vel.x = Math.sin(this.facing) * lunge;
    this.vel.z = Math.cos(this.facing) * lunge;
    this.body.move(dt);
    if (ctl && inp.hit('attack') && k > 0.25) this.comboQueued = true;
    if (!this.hitDone && k >= 0.3) {
      this.hitDone = true;
      g.meleeHit && g.meleeHit(this, this.combo === 2 ? 2 : 1, this.combo === 2 ? 9 : 2.2);
    }
    if (k >= 1) {
      g.fx && g.fx.endSlash();
      if (this.comboQueued && this.combo < 2) this.startAttack(this.combo + 1);
      else { this.setState('ground'); this.combo = 0; }
    }
  }

  tryCast() {
    const g = this.game;
    if (!g.state.flags.hasRune) { g.hud && g.hud.toast('还没有掌握任何符文'); return; }
    if (this.runeCD > 0) return;
    // aim: camera forward, with a narrow assist toward a receiver / enemy near the aim line
    const dir = g.wind.aim(this.pos, g.cam.forward(_v));
    this.castDir.copy(dir);
    this.facing = Math.atan2(dir.x, dir.z);
    this.castFired = false;
    // release once the body has visibly turned toward the aim (casting behind takes a moment)
    this.castFireT = 0.11 + Math.min(0.16, Math.abs(wrapAngle(this.facing - this.yawVis)) / 20);
    this.setState('cast');
    this.runeCD = 0.75;
  }

  updateCast(dt) {
    const g = this.game;
    approachVec(this.vel, 0, 0, 40 * dt);
    this.body.move(dt);
    if (!this.castFired && this.stateT >= this.castFireT) {
      this.castFired = true;
      // re-aim at release so the gust follows the camera as it is now
      const tgt = g.wind.target(this.pos, g.cam.forward(_v));
      const dir = g.wind.aim(this.pos, _v, tgt);
      this.castDir.copy(dir);
      this.facing = Math.atan2(dir.x, dir.z);
      // chest-level aim line; the gust leaves the hand and converges on it
      const chest = _t.set(this.pos.x, this.pos.y + 1.3, this.pos.z);
      const reach = tgt ? Math.max(2, chest.distanceTo(tgt)) : 12;
      const aimP = chest.addScaledVector(dir, reach);
      this.root.updateMatrixWorld(true);
      const origin = this.avatar.j.handL.getWorldPosition(new THREE.Vector3());
      const d2 = aimP.clone().sub(origin).normalize();
      g.wind.cast(origin, d2, this);
    }
    if (this.stateT >= this.castFireT + 0.37) this.setState('ground');
  }

  // Haniwa are solid: push the player out of an overlapping clay body (the enemy takes the rest)
  separateEnemies() {
    const zone = this.game.zone;
    if (!zone) return;
    for (const e of zone.enemies) {
      if (!e.alive || !e.body) continue; // wisps are spirits
      const dx = this.pos.x - e.pos.x, dz = this.pos.z - e.pos.z;
      const min = this.body.radius + e.body.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || Math.abs(this.pos.y - e.pos.y) > 1.4) continue;
      const d = Math.sqrt(d2);
      const nx = d > 1e-4 ? dx / d : Math.sin(this.facing + Math.PI), nz = d > 1e-4 ? dz / d : Math.cos(this.facing + Math.PI);
      const push = min - d;
      const res = zone.physics.resolveCircle(this.pos.x + nx * push * 0.6, this.pos.z + nz * push * 0.6, this.body.radius, this.pos.y, this.pos.y + this.body.height, this.body.stepUp, this._sep);
      this.pos.x = res.x; this.pos.z = res.z;
      e.pos.x -= nx * push * 0.4; e.pos.z -= nz * push * 0.4;
    }
  }

  tryAttachClimb() {
    const zone = this.game.zone;
    if (!zone || !zone.climbs || this.exhausted || this.inputMag < 0.2) return false;
    for (const c of zone.climbs) {
      if (c.enabled === false) continue;
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const dn = dx * c.nx + dz * c.nz;
      if (dn < 0.05 || dn > 0.9) continue;
      const u = dx * c.rx + dz * c.rz;
      if (Math.abs(u) > c.w / 2 - 0.25) continue;
      if (this.pos.y < c.y0 - 0.7 || this.pos.y > c.y1 - 0.9) continue;
      const into = -(this.moveDir.x * c.nx + this.moveDir.z * c.nz);
      if (into < 0.5) continue;
      this.climb = c;
      this.climbU = u;
      this.pos.y = Math.max(this.pos.y, c.y0);
      this.vel.set(0, 0, 0);
      this.setState('climb');
      this.game.audio && this.game.audio.sfx('grab');
      if (!this.avatar.sheathed) this.avatar.sheathSword();
      return true;
    }
    return false;
  }

  updateClimb(dt, ctl, inp, mx, my) {
    const c = this.climb;
    const g = this.game;
    let drain = 0.045;
    const moving = Math.abs(mx) + Math.abs(my) > 0.1;
    if (moving) drain = 0.12;
    if (ctl && inp.hit('jump') && this.stamina > 0.05 && this.climbJump <= 0) {
      this.climbJump = 0.32;
      this.stamina = Math.max(0, this.stamina - 0.2);
      g.audio && g.audio.sfx('jump');
    }
    const sp = 1.75;
    let dy = my * sp, dxu = mx * sp * 0.85;
    if (this.climbJump > 0) dy += 5.2 * (this.climbJump / 0.32);
    this.pos.y += dy * dt;
    this.climbU = clamp(this.climbU + dxu * dt, -(c.w / 2 - 0.3), c.w / 2 - 0.3);
    this._climbDX = mx; this._climbDY = my + (this.climbJump > 0 ? 1 : 0);
    const off = 0.4;
    this.pos.x = c.x + c.rx * this.climbU + c.nx * off;
    this.pos.z = c.z + c.rz * this.climbU + c.nz * off;
    this.facing = Math.atan2(-c.nx, -c.nz);
    const release = (push) => {
      this.climb = null;
      this.setState('ground');
      this.vel.set(c.nx * push, 0, c.nz * push);
      this.body.grounded = false;
    };
    if (this.pos.y >= c.y1 - 1.3 && (my > 0.1 || this.climbJump > 0)) {
      // top out
      const to = new THREE.Vector3(this.pos.x - c.nx * (off + 0.65), c.topY, this.pos.z - c.nz * (off + 0.65));
      this.climb = null;
      this.startMantle(to);
      return drain;
    }
    if (this.pos.y > c.y1 - 1.3) this.pos.y = c.y1 - 1.3;
    const ground = g.zone.physics.terrain(this.pos.x, this.pos.z);
    if (this.pos.y <= Math.max(c.y0, ground) + 0.02 && my < -0.1) { this.pos.y = Math.max(c.y0, ground); release(0.8); return 0; }
    if (this.pos.y < c.y0) this.pos.y = c.y0;
    if (ctl && inp.hit('interact')) { release(2.0); return 0; }
    if (this.stamina <= 0) { release(1.5); g.hud && g.hud.toast('耐力耗尽了……'); return 0; }
    this.speed = 0;
    return drain;
  }

  // mantle onto the ledge in front of the current wall contact
  tryMantle() {
    const B = this.body, P = this.game.zone.physics;
    const top = B.wallTop;
    for (const reach of [0.7, 1.0]) {
      const tx = this.pos.x - B.wallNX * reach, tz = this.pos.z - B.wallNZ * reach;
      const gr = P.groundAt(tx, tz, top + 0.05, 0.1);
      if (Math.abs(gr.h - top) > 0.25) continue;
      const res = P.resolveCircle(tx, tz, B.radius * 0.9, gr.h, gr.h + 1.6, 0.3, {});
      if (Math.hypot(res.x - tx, res.z - tz) > 0.15) continue;
      const ceil = P.ceilingAt(tx, tz, gr.h + 0.2);
      if (ceil < gr.h + 1.5) continue;
      this.startMantle(new THREE.Vector3(tx, gr.h, tz));
      return true;
    }
    return false;
  }

  startMantle(to) {
    this.mantle = { from: this.pos.clone(), to, dur: clamp(0.25 + (to.y - this.pos.y) * 0.12, 0.3, 0.55) };
    this.facing = Math.atan2(to.x - this.pos.x, to.z - this.pos.z) || this.facing;
    this.body.noGravity = false;
    this.setState('mantle');
    this.game.audio && this.game.audio.sfx('grab');
  }

  updateMantle(dt) {
    const m = this.mantle;
    const k = clamp(this.stateT / m.dur, 0, 1);
    const ky = easeOutCubic(Math.min(1, k / 0.6));
    const kx = easeInOut(clamp((k - 0.3) / 0.7, 0, 1));
    this.pos.y = lerp(m.from.y, m.to.y + 0.05, ky);
    this.pos.x = lerp(m.from.x, m.to.x, kx);
    this.pos.z = lerp(m.from.z, m.to.z, kx);
    this.vel.set(0, 0, 0);
    if (k >= 1) {
      this.pos.copy(m.to);
      this.mantle = null;
      this.body.grounded = true;
      this.setState('ground');
    }
  }

  enterSwim(wy) {
    this.swimY = wy;
    this.setState('swim');
    this.body.noGravity = true;
    this.vel.y = Math.max(this.vel.y, -2);
    const g = this.game;
    g.fx && g.fx.splash(new THREE.Vector3(this.pos.x, wy, this.pos.z));
    g.audio && g.audio.sfx('splash');
    if (!this.avatar.sheathed) this.avatar.sheathSword();
  }

  updateSwim(dt, ctl, inp) {
    const g = this.game, B = this.body, P = g.zone.physics;
    const wy = P.water(this.pos.x, this.pos.z);
    if (wy === -Infinity || wy < this.pos.y + 1.05) {
      this.setState('ground');
      return 0;
    }
    this.swimY = wy;
    const fast = ctl && inp.down('sprint') && !this.exhausted && this.inputMag > 0.1;
    const target = this.inputMag > 0.1 ? (fast ? SWIM_FAST : SWIM) : 0;
    approachVec(this.vel, this.moveDir.x * target, this.moveDir.z * target, 8 * dt);
    const ty = wy - 1.28;
    this.vel.y = (ty - this.pos.y) * 6;
    if (this.inputMag > 0.1) this.facing = dampAngle(this.facing, Math.atan2(this.moveDir.x, this.moveDir.z), 6, dt);
    B.move(dt);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (B.hitWall && B.wallTop <= wy + 0.9 && B.wallTop > wy - 0.6) {
      if (this.tryMantle()) return 0;
    }
    if (this.exhausted && this.stamina <= 0) {
      g.hud && g.hud.toast('体力不支，被水流冲回了岸边');
      g.fallRespawn();
      return 0;
    }
    if (Math.random() < dt * (this.speed > 0.5 ? 6 : 1.5)) g.fx && g.fx.ripple(new THREE.Vector3(this.pos.x, wy, this.pos.z));
    return fast ? 0.22 : 0;
  }

  damage(amount, from, knock = 7) {
    const g = this.game;
    if (this.god || this.invuln > 0 || this.state === 'dead') return false;
    if (this.state === 'roll' && this.stateT > 0.03 && this.stateT < 0.34) return false;
    if (this.state === 'mantle' || this.state === 'locked') return false;
    this.hp = Math.max(0, this.hp - amount);
    this.invuln = 1.1;
    this.avatar.flash(0.3);
    g.cam.shake(0.45);
    g.audio && g.audio.sfx('hurt');
    g.engine && (g.engine.post.uFlash.value = 0.12, g.engine.post.uFlashColor.value.setRGB(1, 0.3, 0.25));
    if (from) {
      _t.set(this.pos.x - from.x, 0, this.pos.z - from.z);
      if (_t.lengthSq() < 1e-6) _t.set(Math.sin(this.facing + Math.PI), 0, Math.cos(this.facing + Math.PI));
      _t.normalize();
      if (this.state !== 'climb' && this.state !== 'swim') {
        this.vel.set(_t.x * knock, 4.5, _t.z * knock);
        this.body.grounded = false;
        this.setState('hurt');
      }
    }
    if (this.hp <= 0) g.onPlayerDeath();
    return true;
  }

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }

  animate(dt) {
    const s = this.state;
    const st = { speed: this.speed, sprint: this.sprinting, vy: this.vel.y, grounded: this.grounded, t: this.stateT, turn: this.turn };
    if (s === 'ground') {
      if (!this.grounded && !(this.coyote > 0 && this.vel.y <= 0)) st.mode = 'air';
      else st.mode = this.speed > 0.4 ? 'move' : 'idle';
    } else if (s === 'roll') { st.mode = 'roll'; st.dur = 0.44; }
    else if (s === 'attack') { st.mode = 'attack'; st.attack = this.combo; st.dur = ATTACK_DUR[this.combo]; }
    else if (s === 'cast') { st.mode = 'cast'; st.dur = 0.48; }
    else if (s === 'hurt') st.mode = 'hurt';
    else if (s === 'climb') { st.mode = 'climb'; st.climbDX = this._climbDX || 0; st.climbDY = this._climbDY || 0; }
    else if (s === 'mantle') { st.mode = 'mantle'; st.dur = this.mantle ? this.mantle.dur : 0.4; }
    else if (s === 'swim') st.mode = 'swim';
    else if (s === 'dead') { st.mode = 'hurt'; st.eyesClosed = true; }
    else st.mode = this.speed > 0.4 ? 'move' : 'idle';
    if (this.talkMode) st.mode = this.talkMode;
    this.avatar.animate(dt, st);
    this.root.position.copy(this.pos);
    // instant heading changes (attacks, casts, rolls, facing a speaker) read as a quick pivot
    const dy = wrapAngle(this.facing - this.yawVis), maxStep = 20 * dt;
    this.yawVis = wrapAngle(this.yawVis + (Math.abs(dy) <= maxStep ? dy : Math.sign(dy) * maxStep));
    this.root.rotation.y = this.yawVis;
    // blink visibility while invulnerable
    const vis = !(this.invuln > 0 && this.state !== 'dead' && Math.floor(this.invuln * 14) % 2 === 0 && this.invuln < 0.9);
    this.avatar.inner.visible = vis;
    if (this.game.zone) this.avatar.updateSecondary(dt, this.game.zone.scene, this.vel);
  }
}
