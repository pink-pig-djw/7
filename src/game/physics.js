// Lightweight custom collision world.
//  - static colliders in a spatial hash, dynamic ones in a list
//  - collider types: yaw-rotated boxes, vertical cylinders, ramps (sloped boxes)
//  - ground = max(heightfield, walkable collider tops)
import * as THREE from 'three';

let STAMP = 1;

export class Physics {
  constructor(ground) {
    this.ground = ground || { height: () => 0, normal: (x, z, o) => o.set(0, 1, 0), water: () => -Infinity };
    this.cell = 8;
    this.grid = new Map();
    this.dynamic = [];
    this.all = [];
    this._q = [];
    this._n = new THREE.Vector3();
  }

  _key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }

  _finish(c, opts) {
    c.enabled = opts.enabled !== undefined ? opts.enabled : true;
    c.walkable = opts.walkable !== undefined ? opts.walkable : true;
    c.blockCam = opts.blockCam !== undefined ? opts.blockCam : true;
    // camera-only volume (water curtains, overhangs): stops the camera, invisible to bodies
    c.camOnly = !!opts.camOnly;
    c.tag = opts.tag || null;
    c.data = opts.data || null;
    c.dynamic = !!opts.dynamic;
    c.dx = 0; c.dy = 0; c.dz = 0;
    c.stamp = 0;
    this._bounds(c);
    this.all.push(c);
    if (c.dynamic) this.dynamic.push(c); else this._insert(c);
    return c;
  }

  _bounds(c) {
    if (c.type === 'cyl') {
      c.minX = c.x - c.r; c.maxX = c.x + c.r; c.minZ = c.z - c.r; c.maxZ = c.z + c.r;
    } else {
      const ex = Math.abs(c.hx * c.c) + Math.abs(c.hz * c.s);
      const ez = Math.abs(c.hx * c.s) + Math.abs(c.hz * c.c);
      c.minX = c.x - ex; c.maxX = c.x + ex; c.minZ = c.z - ez; c.maxZ = c.z + ez;
    }
  }

  _insert(c) {
    const s = this.cell;
    const x0 = Math.floor(c.minX / s), x1 = Math.floor(c.maxX / s);
    const z0 = Math.floor(c.minZ / s), z1 = Math.floor(c.maxZ / s);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = this._key(ix, iz);
      let arr = this.grid.get(k);
      if (!arr) { arr = []; this.grid.set(k, arr); }
      arr.push(c);
    }
  }

  // box centred at (x,y,z) with half extents, rotated by rot around Y
  addBox(x, y, z, hx, hy, hz, rot = 0, opts = {}) {
    const c = { type: 'box', x, y, z, hx, hy, hz, rot, c: Math.cos(rot), s: Math.sin(rot), bottom: y - hy, top: y + hy };
    return this._finish(c, opts);
  }
  addCyl(x, z, r, bottom, top, opts = {}) {
    const c = { type: 'cyl', x, z, r, bottom, top, rot: 0, c: 1, s: 0, hx: r, hz: r };
    return this._finish(c, opts);
  }
  // ramp: footprint hx/hz; surface height y0 at local z=-hz rising to y1 at local z=+hz
  addRamp(x, z, hx, hz, rot, y0, y1, bottom, opts = {}) {
    const c = { type: 'ramp', x, z, hx, hz, rot, c: Math.cos(rot), s: Math.sin(rot), y0, y1, bottom, top: Math.max(y0, y1), y: (bottom + Math.max(y0, y1)) / 2, hy: (Math.max(y0, y1) - bottom) / 2 };
    return this._finish(c, opts);
  }
  // update a dynamic box's transform
  moveBox(c, x, y, z, rot = c.rot) {
    c.dx = x - c.x; c.dy = y - c.y; c.dz = z - c.z;
    c.x = x; c.y = y; c.z = z; c.rot = rot; c.c = Math.cos(rot); c.s = Math.sin(rot);
    c.bottom = y - c.hy; c.top = y + c.hy;
    this._bounds(c);
  }
  remove(c) {
    c.enabled = false;
  }

  query(minX, minZ, maxX, maxZ) {
    const out = this._q; out.length = 0;
    const stamp = ++STAMP;
    const s = this.cell;
    const x0 = Math.floor(minX / s), x1 = Math.floor(maxX / s);
    const z0 = Math.floor(minZ / s), z1 = Math.floor(maxZ / s);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const arr = this.grid.get(this._key(ix, iz));
      if (!arr) continue;
      for (const c of arr) {
        if (c.stamp === stamp || !c.enabled) continue;
        c.stamp = stamp;
        if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
        out.push(c);
      }
    }
    for (const c of this.dynamic) {
      if (!c.enabled) continue;
      if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
      out.push(c);
    }
    return out;
  }

  // local coords of a world point for a rotated collider
  _local(c, x, z, o) {
    const dx = x - c.x, dz = z - c.z;
    o.lx = dx * c.c - dz * c.s;
    o.lz = dx * c.s + dz * c.c;
    return o;
  }

  // top surface height of collider at (x,z) or -Infinity if outside footprint
  surfaceAt(c, x, z, margin = 0) {
    if (c.type === 'cyl') {
      const dx = x - c.x, dz = z - c.z;
      return dx * dx + dz * dz <= (c.r + margin) * (c.r + margin) ? c.top : -Infinity;
    }
    const L = this._local(c, x, z, _lc);
    if (Math.abs(L.lx) > c.hx + margin || Math.abs(L.lz) > c.hz + margin) return -Infinity;
    if (c.type === 'ramp') {
      const t = Math.min(1, Math.max(0, (L.lz + c.hz) / (2 * c.hz)));
      return c.y0 + (c.y1 - c.y0) * t;
    }
    return c.top;
  }

  terrain(x, z) { return this.ground.height(x, z); }
  water(x, z) { return this.ground.water ? this.ground.water(x, z) : -Infinity; }

  groundAt(x, z, footY, stepUp = 0.45, out = {}) {
    let h = this.ground.height(x, z);
    let hc = null;
    const lim = footY + stepUp;
    const cs = this.query(x - 0.05, z - 0.05, x + 0.05, z + 0.05);
    for (const c of cs) {
      if (!c.walkable || c.camOnly) continue;
      const s = this.surfaceAt(c, x, z);
      if (s > h && s <= lim) { h = s; hc = c; }
    }
    out.h = h; out.c = hc;
    return out;
  }

  // lowest bottom of colliders above `fromY` at (x,z)
  ceilingAt(x, z, fromY) {
    let m = Infinity;
    const cs = this.query(x - 0.05, z - 0.05, x + 0.05, z + 0.05);
    for (const c of cs) {
      if (c.camOnly) continue;
      if (c.bottom >= fromY && c.bottom < m && this.surfaceAt(c, x, z) > -Infinity) m = c.bottom;
    }
    return m;
  }

  // push a vertical circle out of blocking colliders
  resolveCircle(x, z, r, footY, headY, stepUp, out) {
    out.hit = false; out.nx = 0; out.nz = 0; out.top = -Infinity; out.c = null;
    for (let iter = 0; iter < 3; iter++) {
      const cs = this.query(x - r, z - r, x + r, z + r);
      let moved = false;
      for (const c of cs) {
        if (c.camOnly || c.bottom >= headY - 0.05) continue;
        let top = c.top;
        if (c.type === 'ramp') {
          const s = this.surfaceAt(c, x, z, r);
          top = s === -Infinity ? c.top : s;
        }
        // only walkable tops can be stepped onto; anything else pushes until the feet clear it
        if (top <= footY + (c.walkable ? stepUp : 0.02)) continue;
        let px = 0, pz = 0;
        if (c.type === 'cyl') {
          const dx = x - c.x, dz = z - c.z;
          const d2 = dx * dx + dz * dz, rr = r + c.r;
          if (d2 >= rr * rr) continue;
          const d = Math.sqrt(d2) || 1e-4;
          const pen = rr - d;
          px = (dx / d) * pen; pz = (dz / d) * pen;
        } else {
          const L = this._local(c, x, z, _lc);
          const qx = Math.max(-c.hx, Math.min(c.hx, L.lx));
          const qz = Math.max(-c.hz, Math.min(c.hz, L.lz));
          let dx = L.lx - qx, dz = L.lz - qz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          let lpx, lpz;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            lpx = (dx / d) * (r - d); lpz = (dz / d) * (r - d);
          } else {
            const penX = c.hx - Math.abs(L.lx) + r, penZ = c.hz - Math.abs(L.lz) + r;
            if (penX < penZ) { lpx = (L.lx >= 0 ? 1 : -1) * penX; lpz = 0; }
            else { lpz = (L.lz >= 0 ? 1 : -1) * penZ; lpx = 0; }
          }
          px = lpx * c.c + lpz * c.s;
          pz = -lpx * c.s + lpz * c.c;
        }
        x += px; z += pz;
        const pl = Math.hypot(px, pz) || 1;
        out.hit = true; out.nx = px / pl; out.nz = pz / pl;
        if (top > out.top) { out.top = top; out.c = c; }
        moved = true;
      }
      if (!moved) break;
    }
    out.x = x; out.z = z;
    return out;
  }

  // ray vs world. returns hit distance (or maxD). opts.cam -> only colliders with blockCam
  raycast(ox, oy, oz, dx, dy, dz, maxD, opts = {}) {
    let best = maxD;
    const ex = ox + dx * maxD, ez = oz + dz * maxD;
    const cs = this.query(Math.min(ox, ex) - 0.5, Math.min(oz, ez) - 0.5, Math.max(ox, ex) + 0.5, Math.max(oz, ez) + 0.5);
    for (const c of cs) {
      if (opts.cam ? !c.blockCam : c.camOnly) continue;
      if (opts.ignore && opts.ignore === c) continue;
      let t;
      if (c.type === 'cyl') t = rayCyl(ox, oy, oz, dx, dy, dz, c);
      else t = rayBox(ox, oy, oz, dx, dy, dz, c);
      if (t >= 0 && t < best) best = t;
    }
    if (opts.terrain !== false) {
      // march the heightfield
      const step = 0.4;
      let prevT = 0;
      let prevAbove = oy - this.ground.height(ox, oz);
      if (prevAbove > 0) {
        for (let t = step; t <= best; t += step) {
          const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
          const above = y - this.ground.height(x, z);
          if (above <= 0) {
            let a = prevT, b = t;
            for (let k = 0; k < 6; k++) {
              const m = (a + b) / 2;
              const ab = oy + dy * m - this.ground.height(ox + dx * m, oz + dz * m);
              if (ab > 0) a = m; else b = m;
            }
            if (a < best) best = a;
            break;
          }
          prevT = t; prevAbove = above;
        }
      }
    }
    return best;
  }
}

const _lc = { lx: 0, lz: 0 };

function rayBox(ox, oy, oz, dx, dy, dz, c) {
  // to local
  const rx = ox - c.x, rz = oz - c.z;
  const lox = rx * c.c - rz * c.s, loz = rx * c.s + rz * c.c;
  const ldx = dx * c.c - dz * c.s, ldz = dx * c.s + dz * c.c;
  const top = c.top, bottom = c.bottom;
  let tmin = -Infinity, tmax = Infinity;
  const slab = (o, d, lo, hi) => {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { tmin = Infinity; } return; }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
  };
  slab(lox, ldx, -c.hx, c.hx);
  slab(oy, dy, bottom, top);
  slab(loz, ldz, -c.hz, c.hz);
  if (tmin > tmax || tmax < 0) return -1;
  return tmin >= 0 ? tmin : -1;
}

function rayCyl(ox, oy, oz, dx, dy, dz, c) {
  const fx = ox - c.x, fz = oz - c.z;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return -1;
  const b = 2 * (fx * dx + fz * dz);
  const cc = fx * fx + fz * fz - c.r * c.r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t = (-b - sq) / (2 * a);
  if (t < 0) return -1;
  const y = oy + dy * t;
  if (y < c.bottom || y > c.top) return -1;
  return t;
}

// ---------------------------------------------------------------------------
// Kinematic character body
export class Body {
  constructor(physics, { radius = 0.38, height = 1.7, stepUp = 0.42, gravity = 25 } = {}) {
    this.physics = physics;
    this.radius = radius;
    this.height = height;
    this.stepUp = stepUp;
    this.gravity = gravity;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.grounded = false;
    this.groundC = null;
    this.groundY = 0;
    this.noGravity = false;
    this.hitWall = false;
    this.wallNX = 0; this.wallNZ = 0; this.wallTop = -Infinity;
    this.landSpeed = 0;
    this.slopeLimit = 0.62;
    this._r = {}; this._g = {};
  }

  setPhysics(p) { this.physics = p; this.groundC = null; }

  move(dt) {
    const v = this.vel;
    const horiz = Math.hypot(v.x, v.z) * dt;
    const steps = Math.min(8, Math.max(1, Math.ceil(horiz / (this.radius * 0.7))));
    const sdt = dt / steps;
    this.hitWall = false;
    this.wallTop = -Infinity;
    this.landSpeed = 0;
    // ride dynamic platforms
    if (this.grounded && this.groundC && this.groundC.dynamic) {
      this.pos.x += this.groundC.dx; this.pos.z += this.groundC.dz;
      if (this.groundC.dy > 0) this.pos.y += this.groundC.dy;
    }
    for (let i = 0; i < steps; i++) this._step(sdt);
  }

  _step(dt) {
    const P = this.physics, p = this.pos, v = this.vel, r = this.radius;
    let nx = p.x + v.x * dt, nz = p.z + v.z * dt;
    const res = P.resolveCircle(nx, nz, r, p.y, p.y + this.height, this.stepUp, this._r);
    nx = res.x; nz = res.z;
    if (res.hit) {
      this.hitWall = true; this.wallNX = res.nx; this.wallNZ = res.nz;
      if (res.top > this.wallTop) this.wallTop = res.top;
      // remove velocity into the wall
      const vn = v.x * res.nx + v.z * res.nz;
      if (vn < 0) { v.x -= vn * res.nx; v.z -= vn * res.nz; }
    }
    // ground rise check (heightfield cliffs, ledges of the ground function)
    const mdx = nx - p.x, mdz = nz - p.z;
    const ml = Math.hypot(mdx, mdz);
    if (ml > 1e-6) {
      const rise = this._rise(nx, nz, mdx / ml, mdz / ml);
      if (rise !== null) {
        this.hitWall = true;
        if (rise > this.wallTop) this.wallTop = rise;
        // try sliding along each axis
        if (Math.abs(mdx) > 1e-6 && this._rise(nx, p.z, Math.sign(mdx), 0) === null) nz = p.z;
        else if (Math.abs(mdz) > 1e-6 && this._rise(p.x, nz, 0, Math.sign(mdz)) === null) nx = p.x;
        else { nx = p.x; nz = p.z; }
        const dxm = nx - (p.x + v.x * dt), dzm = nz - (p.z + v.z * dt);
        const l = Math.hypot(dxm, dzm);
        if (l > 1e-6) { this.wallNX = dxm / l; this.wallNZ = dzm / l; }
      }
    }
    p.x = nx; p.z = nz;

    // vertical
    if (!this.noGravity) v.y -= this.gravity * dt;
    const oldY = p.y;
    p.y += v.y * dt;
    const g = P.groundAt(p.x, p.z, Math.max(oldY, p.y), this.stepUp, this._g);
    const wasGrounded = this.grounded;
    if (p.y <= g.h) {
      if (!wasGrounded && v.y < 0) this.landSpeed = Math.min(this.landSpeed, v.y);
      p.y = g.h;
      if (v.y < 0) v.y = 0;
      this.grounded = true;
    } else if (wasGrounded && v.y <= 0.01 && p.y - g.h < 0.55 && !this.noGravity) {
      p.y = g.h; v.y = 0; this.grounded = true;
    } else {
      this.grounded = false;
    }
    this.groundY = g.h;
    this.groundC = this.grounded ? g.c : null;
    // ceiling
    if (v.y > 0) {
      const ceil = P.ceilingAt(p.x, p.z, oldY + this.stepUp + 0.05);
      if (p.y + this.height > ceil) { p.y = Math.max(oldY, ceil - this.height); v.y = 0; }
    }
    // steep slope sliding
    if (this.grounded && !this.groundC) {
      const n = P.ground.normal(p.x, p.z, P._n);
      if (n.y < this.slopeLimit - 0.04) {
        v.x += n.x * 18 * dt; v.z += n.z * 18 * dt;
      }
    }
  }

  // terrain rise that blocks moving to (x,z) along (ux,uz): too high to step onto, or too steep uphill.
  // The body's leading edge is probed as well so the capsule stops before sinking into cliffs.
  _rise(x, z, ux, uz) {
    const P = this.physics, y = this.pos.y;
    for (let i = 0; i < 2; i++) {
      const k = i === 0 ? 0 : this.radius * 0.85;
      const qx = x + ux * k, qz = z + uz * k;
      const g = P.groundAt(qx, qz, y, this.stepUp, this._g);
      if (g.h > y + this.stepUp + 0.001) return g.h;
      if (this.grounded && g.c === null && g.h > y + 0.02 && P.ground.normal(qx, qz, P._n).y < this.slopeLimit) return g.h;
    }
    return null;
  }
}
