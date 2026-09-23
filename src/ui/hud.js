// DOM heads-up display.
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();

const HEART_PATH = 'M16 28 C 6 20, 1 14, 1 9 C 1 4.5, 4.8 1.5, 8.6 1.5 C 11.6 1.5, 14.2 3.3, 16 6 C 17.8 3.3, 20.4 1.5, 23.4 1.5 C 27.2 1.5, 31 4.5, 31 9 C 31 14, 26 20, 16 28 Z';

function heartSVG(fill) {
  // fill: 0 empty, 1 half, 2 full
  const id = 'h' + Math.random().toString(36).slice(2, 8);
  return `<svg viewBox="0 0 32 30"><defs><clipPath id="${id}"><rect x="0" y="0" width="16" height="30"/></clipPath></defs>
    <path d="${HEART_PATH}" fill="rgba(20,16,18,.55)" stroke="#f3e9d2" stroke-width="2"/>
    ${fill === 2 ? `<path d="${HEART_PATH}" fill="#e2423c"/><path d="M7 7 C 8 5, 10 5, 11 6" stroke="#ffb7a8" stroke-width="2" fill="none" stroke-linecap="round"/>` : ''}
    ${fill === 1 ? `<path d="${HEART_PATH}" fill="#e2423c" clip-path="url(#${id})"/>` : ''}
    <path d="${HEART_PATH}" fill="none" stroke="#f3e9d2" stroke-width="2"/></svg>`;
}

export class Hud {
  constructor(game) {
    this.game = game;
    this.el = $('hud');
    this.hearts = $('hearts');
    this.obj = $('objective');
    this.objTxt = this.obj.querySelector('.txt');
    this.prompt = $('prompt');
    this.promptT = this.prompt.querySelector('.t');
    this.promptK = this.prompt.querySelector('.k');
    this.marker = $('marker');
    this.markerDist = this.marker.querySelector('.dist');
    this.markerArrow = this.marker.querySelector('.arrow');
    this.area = $('area-title');
    this.toastEl = $('toast');
    this.stam = $('stamina');
    this.stamRing = $('stamina-ring');
    this.rune = $('rune-slot');
    this.runeRing = $('rune-ring');
    this.map = $('minimap');
    this.mapCtx = this.map.getContext('2d');
    this.zoneLabel = $('zone-label');
    this.keysHint = $('keys-hint');
    this.lockHint = $('lock-hint');
    this.fpsEl = $('fps');
    this.lastHp = -1; this.lastMax = -1;
    this.toastT = 0;
    this.areaT = 0;
    this.mapT = 0;
    this.showMarker = true;
    this.hintT = 0;
    this.fpsAcc = 0; this.fpsN = 0; this.fpsT = 0;
    this.objectiveText = '';
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  setHearts(hp, max) {
    if (hp === this.lastHp && max === this.lastMax) return;
    this.lastHp = hp; this.lastMax = max;
    let html = '';
    for (let i = 0; i < max / 2; i++) {
      const v = hp - i * 2;
      html += heartSVG(v >= 2 ? 2 : v === 1 ? 1 : 0);
    }
    this.hearts.innerHTML = html;
  }

  setObjective(text, flash = true) {
    if (text === this.objectiveText) return;
    this.objectiveText = text;
    this.objTxt.textContent = text;
    this.obj.style.opacity = text ? 1 : 0;
    if (flash) { this.obj.classList.remove('flash'); void this.obj.offsetWidth; this.obj.classList.add('flash'); }
  }

  setPrompt(key, text) {
    if (!text) { this.prompt.classList.add('hidden'); this._prompt = null; return; }
    const k = key + '|' + text;
    if (this._prompt === k) return;
    this._prompt = k;
    this.promptK.textContent = key;
    this.promptT.textContent = text;
    this.prompt.classList.remove('hidden');
  }

  areaTitle(name, sub) {
    this.area.querySelector('.a1').textContent = name;
    this.area.querySelector('.a2').textContent = sub || '';
    this.area.classList.add('show');
    this.areaT = 4.2;
  }

  toast(text, dur = 2.4) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastT = dur;
  }

  runePulse() {
    this.rune.classList.remove('pulse'); void this.rune.offsetWidth; this.rune.classList.add('pulse');
  }

  setKeysHint(html) { this.keysHint.innerHTML = html; }

  update(dt) {
    const g = this.game, p = g.player;
    const cine = g.cam.cinematic || g.mode === 'ending';
    if (cine !== this._cine) { this._cine = cine; this.el.style.opacity = cine ? '0' : '1'; this.el.style.transition = 'opacity .5s'; }
    this.setHearts(p.hp, p.maxHp);
    // toast / area timers
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toastEl.classList.remove('show'); }
    if (this.areaT > 0) { this.areaT -= dt; if (this.areaT <= 0) this.area.classList.remove('show'); }
    // rune slot
    const has = g.state.flags.hasRune;
    this.rune.classList.toggle('hidden', !has);
    if (has) {
      const k = 1 - p.runeCD / 0.75;
      this.runeRing.style.strokeDashoffset = String(213.6 * (1 - k));
      this.rune.classList.toggle('cool', p.runeCD > 0);
    }
    // stamina wheel near the player
    const showSt = p.stamina < 0.999 || p.state === 'climb';
    this.stam.classList.toggle('show', showSt && g.controlEnabled);
    if (showSt) {
      _v.set(p.pos.x, p.pos.y + 1.9, p.pos.z).project(g.camera);
      const w = window.innerWidth, h = window.innerHeight;
      const sx = (_v.x * 0.5 + 0.5) * w + 70, sy = (-_v.y * 0.5 + 0.5) * h;
      this.stam.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
      this.stamRing.style.strokeDashoffset = String(138.2 * (1 - p.stamina));
      this.stamRing.style.stroke = p.exhausted ? '#e5533d' : p.stamina < 0.3 ? '#f2c14e' : '#8be36b';
    }
    // hint fade
    if (this.hintT > 0) { this.hintT -= dt; this.keysHint.style.opacity = Math.min(1, this.hintT / 2).toFixed(2); }
    // objective marker
    this.updateMarker();
    // minimap @ ~20fps
    this.mapT -= dt;
    if (this.mapT <= 0) { this.mapT = 0.05; this.drawMinimap(); }
    // fps
    if (!this.fpsEl.classList.contains('hidden')) {
      this.fpsAcc += dt; this.fpsN++;
      if (this.fpsAcc > 0.5) {
        const info = g.engine.renderer.info;
        this.fpsEl.textContent = `${Math.round(this.fpsN / this.fpsAcc)} fps · ${info.render.calls} draws · ${(info.render.triangles / 1000).toFixed(0)}k tris`;
        this.fpsAcc = 0; this.fpsN = 0;
      }
    }
  }

  showHints(sec = 90) { this.hintT = sec; this.keysHint.style.opacity = 1; }

  updateMarker() {
    const g = this.game;
    const tgt = g.quest ? g.quest.markerWorld() : null;
    if (!tgt || !this.showMarker || !g.controlEnabled) { this.marker.classList.add('hidden'); return; }
    const cam = g.camera;
    _v.copy(tgt).project(cam);
    const w = window.innerWidth, h = window.innerHeight;
    const behind = _v.z > 1;
    let x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
    if (behind) { x = w - x; y = h - 40; }
    const m = 40;
    const onScreen = !behind && x > m && x < w - m && y > m && y < h - m;
    const cx = Math.min(w - m, Math.max(m, x)), cy = Math.min(h - m, Math.max(m, y));
    this.marker.classList.remove('hidden');
    this.marker.classList.toggle('edge', !onScreen);
    this.marker.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`;
    if (!onScreen) {
      const ang = Math.atan2(y - h / 2, x - w / 2) + Math.PI / 2;
      this.markerArrow.style.transform = `rotate(${ang}rad) translateY(-6px)`;
    }
    const d = g.player.pos.distanceTo(tgt);
    this.markerDist.textContent = d > 3 ? Math.round(d) + ' m' : '';
    this.marker.style.opacity = d < 4 ? 0.3 : 1;
  }

  drawMinimap() {
    const g = this.game, zone = g.zone, ctx = this.mapCtx;
    const S = this.map.width;
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#cbbf9c';
    ctx.fillRect(0, 0, S, S);
    if (!zone) { ctx.restore(); return; }
    const p = g.player.pos;
    const range = zone.id === 'undercroft' ? 70 : 130; // metres across
    const scale = S / range;
    const yaw = g.cam.yaw;
    ctx.translate(S / 2, S / 2);
    ctx.rotate(yaw);
    const b = zone.bounds;
    if (zone.mapCanvas) {
      const mw = b.maxX - b.minX, mh = b.maxZ - b.minZ;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(zone.mapCanvas, (b.minX - p.x) * scale, (b.minZ - p.z) * scale, mw * scale, mh * scale);
    }
    // portals & points of interest
    const drawIcon = (wx, wz, color, r = 7, shape = 'dot') => {
      let dx = (wx - p.x) * scale, dz = (wz - p.z) * scale;
      const d = Math.hypot(dx, dz), lim = S / 2 - 14;
      let clamped = false;
      if (d > lim) { dx *= lim / d; dz *= lim / d; clamped = true; }
      ctx.save();
      ctx.translate(dx, dz);
      ctx.rotate(-yaw);
      ctx.fillStyle = color; ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 3;
      ctx.beginPath();
      if (shape === 'diamond') { ctx.moveTo(0, -r * 1.3); ctx.lineTo(r, 0); ctx.lineTo(0, r * 1.3); ctx.lineTo(-r, 0); ctx.closePath(); }
      else ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      if (clamped) { ctx.globalAlpha = 0.6; }
      ctx.restore();
    };
    if (zone.poi) for (const q of zone.poi) if (!q.hidden || !q.hidden()) drawIcon(q.x, q.z, q.color || '#f3e9d2', q.r || 6, q.shape);
    for (const n of zone.npcs) drawIcon(n.pos.x, n.pos.z, '#7fe8d8', 5);
    for (const e of zone.enemies) if (e.alive && e.pos.distanceTo(p) < 40) drawIcon(e.pos.x, e.pos.z, '#d0443a', 5);
    const tgt = g.quest ? g.quest.markerWorld() : null;
    if (tgt) drawIcon(tgt.x, tgt.z, '#f5d36b', 9, 'diamond');
    ctx.restore();
    // player arrow (always up = camera forward, rotated by facing relative to camera)
    ctx.save();
    ctx.translate(S / 2, S / 2);
    const rel = -(g.player.facing - (yaw + Math.PI));
    ctx.rotate(rel);
    ctx.fillStyle = '#fffaf0'; ctx.strokeStyle = '#1b2a33'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(12, 13); ctx.lineTo(0, 6); ctx.lineTo(-12, 13); ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.restore();
    // north indicator rotates
    const n = document.querySelector('#minimap-wrap .n');
    if (n) {
      n.style.transform = 'translate(-50%, -50%)';
      n.style.left = `${50 + Math.sin(yaw) * 43}%`;
      n.style.top = `${50 - Math.cos(yaw) * 43}%`;
    }
  }

  setZoneLabel(t) { this.zoneLabel.textContent = t; }
  setLockHint(v) { this.lockHint.classList.toggle('hidden', !v); }
  setFps(v) { this.fpsEl.classList.toggle('hidden', !v); }
}
