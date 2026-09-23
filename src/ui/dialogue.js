// Dialogue box with typewriter text and an "item get" panel.
const $ = (id) => document.getElementById(id);

// markup: [j]jade[/j]  [g]gold[/g]
function parse(text) {
  const segs = [];
  const re = /\[(j|g)\](.*?)\[\/\1\]/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) segs.push({ t: text.slice(last, m.index), c: null });
    segs.push({ t: m[2], c: m[1] === 'j' ? 'em' : 'strong' });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ t: text.slice(last), c: null });
  return segs;
}
function esc(s) { return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

export class Dialogue {
  constructor(game) {
    this.game = game;
    this.el = $('dialogue');
    this.nameEl = this.el.querySelector('.name');
    this.textEl = this.el.querySelector('.text');
    this.nextEl = this.el.querySelector('.next');
    this.active = false;
    this.lines = [];
    this.idx = 0;
    this.shown = 0;
    this.total = 0;
    this.segs = [];
    this.blip = 0;
    this.el.addEventListener('mousedown', (e) => { e.stopPropagation(); this.advance(); });
    this.item = $('itemget');
    this.itemActive = false;
    this.itemT = 0;
    this.item.addEventListener('mousedown', (e) => { e.stopPropagation(); if (this.itemT > 0.5) this.closeItem(); });
  }

  show(lines, onDone) {
    this.lines = lines;
    this.idx = 0;
    this.onDone = onDone || null;
    this.active = true;
    this.el.classList.remove('hidden');
    this._line();
  }

  _line() {
    const L = this.lines[this.idx];
    this.nameEl.textContent = L.name || '';
    this.nameEl.style.display = L.name ? '' : 'none';
    this.segs = parse(L.text);
    this.total = this.segs.reduce((a, s) => a + [...s.t].length, 0);
    this.shown = 0;
    this.render();
    if (L.onShow) L.onShow();
  }

  render() {
    let left = Math.floor(this.shown);
    let html = '';
    for (const s of this.segs) {
      const chars = [...s.t];
      const part = chars.slice(0, Math.max(0, left)).join('');
      left -= chars.length;
      if (!part) break;
      html += s.c ? `<${s.c}>${esc(part)}</${s.c}>` : esc(part);
      if (left <= 0) break;
    }
    this.textEl.innerHTML = html;
    this.nextEl.style.visibility = this.shown >= this.total ? 'visible' : 'hidden';
  }

  advance() {
    if (!this.active) return;
    if (this.shown < this.total) { this.shown = this.total; this.render(); return; }
    this.idx++;
    this.game.audio.sfx('click');
    if (this.idx >= this.lines.length) this.close();
    else this._line();
  }

  close() {
    this.active = false;
    this.el.classList.add('hidden');
    const cb = this.onDone; this.onDone = null;
    if (cb) cb();
  }

  update(dt, input) {
    if (this.itemActive) {
      this.itemT += dt;
      if (this.itemT > 0.6 && (input.hit('confirm') || input.hit('interact'))) this.closeItem();
      return;
    }
    if (!this.active) return;
    if (this.shown < this.total) {
      const before = Math.floor(this.shown);
      this.shown = Math.min(this.total, this.shown + dt * 34);
      if (Math.floor(this.shown) !== before) {
        this.render();
        this.blip -= 1;
        if (this.blip <= 0) { this.blip = 3; this.game.audio.sfx('talk'); }
      }
    }
    if (input.hit('confirm') || input.hit('interact')) this.advance();
  }

  itemGet({ icon, name, desc }, onClose) {
    this.item.querySelector('.ic').innerHTML = ICONS[icon] || ICONS.rune;
    this.item.querySelector('.n').textContent = name;
    this.item.querySelector('.d').innerHTML = desc;
    this.item.classList.remove('hidden');
    this.itemActive = true;
    this.itemT = 0;
    this.onItemClose = onClose || null;
    this.game.audio.sfx('item');
  }
  closeItem() {
    this.item.classList.add('hidden');
    this.itemActive = false;
    const cb = this.onItemClose; this.onItemClose = null;
    if (cb) cb();
  }
}

export const ICONS = {
  rune: '<svg viewBox="0 0 64 64"><path d="M10 36c8-16 34-18 40-4 4 9-7 15-13 10-4-4-1-10 5-8" fill="none" stroke="#dffcf6" stroke-width="5" stroke-linecap="round"/><path d="M8 46h26M16 54h20" stroke="#7fe8d8" stroke-width="4" stroke-linecap="round"/></svg>',
  crystal: '<svg viewBox="0 0 64 64"><path d="M32 4 L48 24 L32 60 L16 24 Z" fill="#8ff0e0" stroke="#e8fffb" stroke-width="3"/><path d="M16 24 H48 M32 4 L26 24 L32 60 L38 24 Z" fill="none" stroke="#e8fffb" stroke-width="2" opacity=".8"/></svg>',
  heart: '<svg viewBox="0 0 32 30"><path d="M16 28 C 6 20, 1 14, 1 9 C 1 4.5, 4.8 1.5, 8.6 1.5 C 11.6 1.5, 14.2 3.3, 16 6 C 17.8 3.3, 20.4 1.5, 23.4 1.5 C 27.2 1.5, 31 4.5, 31 9 C 31 14, 26 20, 16 28 Z" fill="#e2423c" stroke="#fff4e0" stroke-width="2"/></svg>',
  scroll: '<svg viewBox="0 0 64 64"><rect x="14" y="10" width="36" height="44" rx="4" fill="#f3e6c4" stroke="#8a6a3a" stroke-width="3"/><path d="M22 22h20M22 30h20M22 38h14" stroke="#8a6a3a" stroke-width="3" stroke-linecap="round"/></svg>',
};
