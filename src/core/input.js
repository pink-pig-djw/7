// Keyboard + mouse input with action mapping and pointer lock.
const MAP = {
  forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  dodge: ['KeyQ'],
  attack: ['Mouse0', 'KeyJ'],
  rune: ['Mouse2', 'KeyF'],
  interact: ['KeyE'],
  pause: ['Escape', 'KeyP'],
  camLeft: ['ArrowLeft'], camRight: ['ArrowRight'], camUp: ['ArrowUp'], camDown: ['ArrowDown'],
  confirm: ['Enter', 'Space', 'KeyE', 'Mouse0'],
  skip: ['Enter', 'Escape'],
  debug: ['F3'],
};

export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.hits = new Set();
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.locked = false;
    this.sensitivity = 1;
    this.invertY = false;
    this.onLockChange = null;
    this.onFullscreenKey = null;
    this.dragging = false;
    this.moveHist = [0, 0, 0, 0];
    this.lastMoveT = 0;
    this.lockSkip = 0;

    const block = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3']);
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'F2') { e.preventDefault(); if (!e.repeat && this.onFullscreenKey) this.onFullscreenKey(); return; }
      if (block.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.hits.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); });
    el.addEventListener('mousedown', (e) => {
      const code = 'Mouse' + e.button;
      if (!this.keys.has(code)) this.hits.add(code);
      this.keys.add(code);
      if (!this.locked && e.button === 1) this.dragging = true;
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      this.keys.delete('Mouse' + e.button);
      if (e.button === 1) this.dragging = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked && !this.dragging) return;
      const mx = e.movementX || 0, my = e.movementY || 0;
      // the first events after the lock engages can carry the jump to the lock position
      if (this.lockSkip > 0) { this.lockSkip--; return; }
      const now = performance.now();
      if (now - this.lastMoveT > 120) this.moveHist.fill(0);
      this.lastMoveT = now;
      // pointer-lock glitch (Chrome / Windows): a lone huge jump with no build-up. Real flicks ramp up
      // over a few events, so only an isolated spike is dropped.
      const mag = Math.abs(mx) + Math.abs(my);
      const h = this.moveHist;
      if (mag > 280 && mag > Math.max(h[0], h[1], h[2], h[3]) * 5 + 60) return;
      h.shift(); h.push(mag);
      this.dx += mx;
      this.dy += my;
    });
    el.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === el;
      if (this.locked && !was) { this.lockSkip = 2; this.moveHist.fill(0); }
      if (this.onLockChange && was !== this.locked) this.onLockChange(this.locked);
    });
  }

  down(action) {
    const codes = MAP[action];
    if (!codes) return this.keys.has(action);
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }
  hit(action) {
    const codes = MAP[action];
    if (!codes) return this.hits.has(action);
    for (const c of codes) if (this.hits.has(c)) return true;
    return false;
  }
  consume(action) {
    const codes = MAP[action] || [action];
    for (const c of codes) this.hits.delete(c);
  }
  moveVector() {
    let x = 0, y = 0;
    if (this.down('forward')) y += 1;
    if (this.down('back')) y -= 1;
    if (this.down('left')) x -= 1;
    if (this.down('right')) x += 1;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }
  requestLock() {
    if (this.locked) return;
    const el = this.el;
    const plain = () => { try { const p = el.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } };
    try {
      // raw mouse input: no OS acceleration and no emulated-lock movement spikes; plain lock where unsupported
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(plain);
    } catch (e) { plain(); }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  endFrame() {
    this.hits.clear();
    this.dx = 0; this.dy = 0; this.wheel = 0;
  }
  clear() { this.keys.clear(); this.hits.clear(); this.dx = this.dy = this.wheel = 0; }
}
