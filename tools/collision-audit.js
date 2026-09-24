// Collision audit (dev tool, not part of the game build).
//
// Finds visible geometry at body height (0.25 – 1.6 m above the surface below it) that no collider
// backs, i.e. places where the player could walk through something they can see.
//
// Usage: open the game (index.html), wait for the title screen, paste this file into the browser
// console, then run for example:
//
//   await __audit('city',       { bounds: { minX: -108, maxX: 108, minZ: -114, maxZ: 98 } });
//   await __audit('wilds',      { bounds: { minX: -200, maxX: 205, minZ: 96, maxZ: 478 } });
//   await __audit('undercroft', { bounds: { minX: -26, maxX: 26, minZ: -126, maxZ: 18 } });
//   __auditBlobs(2).filter((b) => b.d > 0.35).slice(0, 40)
//
// Each blob: material tag, sample count, d = how far past the nearest collider the geometry reaches
// (0.35 / 0.6 / 1 m, 9 = no collider within 1 m), rel = height above the surface, gy = that
// surface's height (high values are usually unreachable roofs / tower tops), and the x/z extent.

window.__audit = async (zid, opts = {}) => {
  const g = window.__game;
  const zone = g.zones[zid];
  const P = zone.physics;
  const scene = zone.scene;
  scene.updateMatrixWorld(true);
  const V3 = g.player.pos.constructor, M4 = g.camera.matrixWorld.constructor;
  const bounds = opts.bounds || null, r0 = opts.r0 || 0.15, step = opts.step || 0.6;
  // dynamic things are handled by their own logic
  const ex = new Set();
  const markEx = (o) => { if (o) o.traverse((c) => ex.add(c)); };
  markEx(g.player.root);
  for (const n of zone.npcs) markEx(n.avatar.root);
  for (const e of zone.enemies) markEx(e.object);
  markEx(g.fx.root);
  const tmp = {};
  const res = new Map();
  let samples = 0, flagged = 0;
  const check = (x, y, z, tag) => {
    samples++;
    if (bounds && (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ)) return;
    const gr = P.groundAt(x, z, y + 0.01, 0);
    const rel = y - gr.h;
    if (rel < 0.25 || rel > 1.6) return;
    let d = 9;
    for (const r of [r0, 0.35, 0.6, 1.0]) { if (P.resolveCircle(x, z, r, gr.h, gr.h + 1.7, 0, tmp).hit) { d = r; break; } }
    if (d === r0) return;
    flagged++;
    const key = tag + '|' + Math.round(x) + ',' + Math.round(z);
    let e = res.get(key);
    if (!e) { e = { tag, x: Math.round(x), z: Math.round(z), gy: +gr.h.toFixed(2), n: 0, d, relMax: 0 }; res.set(key, e); }
    e.n++; if (d > e.d) e.d = d; if (rel > e.relMax) e.relMax = +rel.toFixed(2);
  };
  const va = new V3(), vb = new V3(), vc = new V3(), vp = new V3();
  const meshes = [];
  scene.traverseVisible((o) => {
    if (ex.has(o) || !o.isMesh || o.userData.noMap) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.transparent || m.isShaderMaterial || m.isMeshBasicMaterial) return;
    const pos = o.geometry.attributes.position;
    const tris = o.geometry.index ? o.geometry.index.count / 3 : pos.count / 3;
    if (!m.name && tris > 20000 && !o.isInstancedMesh) return; // terrain: matches the heightfield exactly
    meshes.push(o);
  });
  const tagOf = (o) => {
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    return (m.name || m.type.replace('Material', '')) + (o.isInstancedMesh ? '[I]' : '') + (o.isSkinnedMesh ? '[S]' : '');
  };
  let work = 0;
  const mw = new M4();
  for (const o of meshes) {
    const geo = o.geometry, pos = geo.attributes.position;
    const idx = geo.index ? geo.index.array : null;
    const tag = tagOf(o);
    const count = o.isInstancedMesh ? o.count : 1;
    const triCount = idx ? idx.length / 3 : pos.count / 3;
    for (let inst = 0; inst < count; inst++) {
      if (o.isInstancedMesh) { o.getMatrixAt(inst, mw); mw.premultiply(o.matrixWorld); } else mw.copy(o.matrixWorld);
      for (let t = 0; t < triCount; t++) {
        const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
        va.fromBufferAttribute(pos, i0).applyMatrix4(mw);
        vb.fromBufferAttribute(pos, i1).applyMatrix4(mw);
        vc.fromBufferAttribute(pos, i2).applyMatrix4(mw);
        if (bounds) {
          const minX = Math.min(va.x, vb.x, vc.x), maxX = Math.max(va.x, vb.x, vc.x), minZ = Math.min(va.z, vb.z, vc.z), maxZ = Math.max(va.z, vb.z, vc.z);
          if (maxX < bounds.minX || minX > bounds.maxX || maxZ < bounds.minZ || minZ > bounds.maxZ) continue;
        }
        // sample the triangle on a grid (~step m), so big faces are covered too
        const e = Math.max(va.distanceTo(vb), vb.distanceTo(vc), vc.distanceTo(va));
        const n = Math.min(10, Math.max(1, Math.ceil(e / step)));
        for (let a = 0; a <= n; a++) for (let b = 0; b <= n - a; b++) {
          const c = n - a - b;
          vp.set((va.x * a + vb.x * b + vc.x * c) / n, (va.y * a + vb.y * b + vc.y * c) / n, (va.z * a + vb.z * b + vc.z * c) / n);
          check(vp.x, vp.y, vp.z, tag);
        }
        if (++work % 15000 === 0) await new Promise((r) => setTimeout(r, 0));
      }
    }
  }
  const list = [...res.values()].sort((p, q) => q.n - p.n);
  window.__auditResult = { zid, samples, flagged, list };
  return { zid, samples, flagged, cells: list.length };
};

// merge neighbouring 1 m cells of the same material into blobs
window.__auditBlobs = (minN = 3, list = null) => {
  const L = list || window.__auditResult.list;
  const seen = new Set();
  const byKey = new Map(L.map((e) => [e.tag + '|' + e.x + ',' + e.z, e]));
  const blobs = [];
  for (const e of L) {
    const k0 = e.tag + '|' + e.x + ',' + e.z;
    if (seen.has(k0)) continue;
    const stack = [e]; seen.add(k0);
    const b = { tag: e.tag, n: 0, cells: 0, minX: e.x, maxX: e.x, minZ: e.z, maxZ: e.z, d: 0, rel: 0, gy: e.gy };
    while (stack.length) {
      const c = stack.pop();
      b.n += c.n; b.cells++; b.d = Math.max(b.d, c.d); b.rel = Math.max(b.rel, c.relMax);
      b.minX = Math.min(b.minX, c.x); b.maxX = Math.max(b.maxX, c.x); b.minZ = Math.min(b.minZ, c.z); b.maxZ = Math.max(b.maxZ, c.z);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const k = c.tag + '|' + (c.x + dx) + ',' + (c.z + dz);
        if (!seen.has(k) && byKey.has(k)) { seen.add(k); stack.push(byKey.get(k)); }
      }
    }
    if (b.n >= minN) blobs.push(b);
  }
  return blobs.sort((p, q) => q.n - p.n);
};
