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
    this.dragging = false;

    const block = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3']);
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
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
      if (this.locked || this.dragging) {
        this.dx += e.movementX || 0;
        this.dy += e.movementY || 0;
      }
    });
    el.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === el;
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
    try {
      const p = this.el.requestPointerLock({ unadjustedMovement: false });
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ignore */ }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  endFrame() {
    this.hits.clear();
    this.dx = 0; this.dy = 0; this.wheel = 0;
  }
  clear() { this.keys.clear(); this.hits.clear(); this.dx = this.dy = this.wheel = 0; }
}
