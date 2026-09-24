// Central game orchestrator.
import * as THREE from 'three';
import { Input } from '../core/input.js';
import { AudioEngine } from '../core/audio.js';
import { U } from '../gfx/materials.js';
import { Effects } from '../gfx/effects.js';
import { CameraRig } from './camera.js';
import { Player } from './player.js';
import { WindRune } from './wind.js';
import { GameState, loadSettings } from './state.js';
import { Quest } from './quest.js';
import { Hud } from '../ui/hud.js';
import { Dialogue } from '../ui/dialogue.js';
import { Menus } from '../ui/menus.js';
import { clamp, lerp } from '../core/util.js';
import { afterEnding as warmAfterEnding } from '../world/undercroft.js';
import { isFullscreen, toggleFullscreen, onFullscreenChange } from '../ui/fullscreen.js';

const _v = new THREE.Vector3();
const _focus = new THREE.Vector3();

export class Game {
  constructor(engine) {
    this.engine = engine;
    this.settings = loadSettings();
    this.input = new Input(engine.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2600);
    this.cam = new CameraRig(this.camera);
    this.state = new GameState();
    this.audio = new AudioEngine();
    this.hud = new Hud(this);
    this.dialogue = new Dialogue(this);
    this.menus = new Menus(this);
    this.fx = new Effects(this);
    this.wind = new WindRune(this);
    this.player = new Player(this);
    this.quest = new Quest(this);
    this.zones = {};
    this.zone = null;
    this.mode = 'loading';
    this.controlEnabled = false;
    this.fadeEl = document.getElementById('fade');
    this.fadeV = 0;
    this.fadeAnim = null;
    this.hitStop = 0;
    this.busy = false;
    this.cineBars = document.getElementById('cine-bars');
    this.skipHint = document.getElementById('skip-hint');
    this.titleT = 0;
    this.timers = [];
    this.debug = /[?&]debug/.test(location.search);

    engine.onResize = (w, h) => {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.fx.setScale(h * engine._pr, this.camera.fov);
    };
    engine.resize(true);
    this.fsEnterT = -1e9;
    this.input.onLockChange = (locked) => {
      // entering fullscreen can drop the pointer lock; that isn't the player asking for the pause menu
      if (!locked && performance.now() - this.fsEnterT < 1200) { if (this.mode === 'play' && this.controlEnabled) this.input.requestLock(); return; }
      if (!locked && this.mode === 'play' && !this.dialogue.active && !this.dialogue.itemActive && !this.cam.cinematic && !this.busy) this.pause();
    };
    this.input.onFullscreenKey = () => toggleFullscreen();
    onFullscreenChange(() => {
      if (isFullscreen()) this.fsEnterT = performance.now();
      this.menus.refreshFullscreen();
    });
    engine.renderer.domElement.addEventListener('mousedown', () => {
      if (this.mode === 'play' && !this.input.locked) this.input.requestLock();
    });
    // any first gesture (menu buttons included) starts audio; capture runs before the buttons' click sfx
    window.addEventListener('pointerdown', () => this.audio.unlock(), true);
    window.addEventListener('keydown', () => this.audio.unlock());
    if (!this.settings.quality) this.settings.quality = engine.weakGPU ? 'medium' : 'high';
    this.menus.applySettings();
    this.perf = { t: 0, frames: 0, acc: 0, checks: 0 };
  }

  // measure real frame times during play and step quality down if it's struggling
  autoQuality(dt) {
    if (this.mode !== 'play' || document.hidden) return;
    const pf = this.perf;
    pf.t += dt; pf.frames++; pf.acc += dt;
    if (pf.t < 6) return;
    const avg = pf.acc / pf.frames;
    pf.t = 0; pf.frames = 0; pf.acc = 0; pf.checks++;
    if (this.settings.userQuality || pf.checks > 6) return;
    const order = ['low', 'medium', 'high'];
    const idx = order.indexOf(this.settings.quality);
    if (avg > 1 / 40 && idx > 0) {
      this.setQuality(order[idx - 1]);
      this.menus.applySettings();
      this.hud.toast('已根据帧率自动调整画质：' + ({ low: '低', medium: '中' })[order[idx - 1]], 3);
    }
  }

  setQuality(q) {
    this.settings.quality = q;
    this.engine.setQuality(q);
    for (const z of Object.values(this.zones)) {
      z.sun.setMapSize(this.engine.q.shadow);
      if (z.setGrassQuality) z.setGrassQuality(this.engine.q);
    }
    this.engine.onResize && this.engine.onResize(this.engine.size.x, this.engine.size.y);
  }

  // ---------------------------------------------------------------------------
  after(sec, fn) { this.timers.push({ t: sec, fn }); }

  fadeTo(v, dur, cb, color = '#000') {
    this.fadeEl.style.background = color;
    this.fadeAnim = { from: this.fadeV, to: v, t: 0, dur: Math.max(0.01, dur), cb };
  }

  setZone(id) {
    const z = this.zones[id];
    if (!z) throw new Error('no zone ' + id);
    if (this.zone && this.zone !== z) this.zone.onExit();
    this.zone = z;
    z.applyEnv();
    z.scene.add(this.player.root);
    this.fx.clear();
    this.fx.attach(z.scene);
    this.player.body.setPhysics(z.physics);
    this.cam.maxDist = z.camMaxDist;
    this.cam.targetDist = Math.min(this.cam.targetDist, z.camMaxDist);
    this.audio.setZone(this.mode === 'title' ? 'title' : id);
    this.hud.setZoneLabel(z.name);
    this.state.zone = id;
    // the boot-time shader warm-up visits every zone before the save is loaded: no enter logic
    // then (it would spawn enemies from a blank save and queue zone hints)
    if (!this.warming) z.onEnter();
  }

  travel(id, pos, yaw, { title = true, color = '#000', onArrive = null } = {}) {
    if (this.busy) return;
    this.busy = true;
    this.controlEnabled = false;
    this.fadeTo(1, 0.4, () => {
      const changed = this.zone !== this.zones[id];
      this.setZone(id);
      this.player.teleport(pos, yaw);
      this.cam.snapTo(_focus.copy(pos).add(new THREE.Vector3(0, 1.5, 0)), yaw + Math.PI);
      this.cam.pitch = 0.3;
      this.state.pos = [pos.x, pos.y, pos.z];
      this.state.yaw = yaw;
      this.saveGame();
      if (onArrive) onArrive();
      this.after(0.15, () => {
        this.fadeTo(0, 0.6, () => { this.busy = false; if (!this.cam.cinematic && !this.dialogue.active) this.controlEnabled = true; });
        if (title && changed) this.hud.areaTitle(this.zone.name, this.zone.subtitle);
      });
    }, color);
  }

  saveGame() {
    const p = this.player;
    this.state.hp = p.hp; this.state.maxHp = p.maxHp;
    if (this.mode === 'ending') {
      // the finale camera tours other zones while the player stays in the undercroft: resume on the plaza
      this.state.zone = 'city'; this.state.pos = [0, 0, 13]; this.state.yaw = Math.PI;
      this.state.save();
      return;
    }
    if (this.player.state !== 'dead') {
      const sp = p.lastSafe;
      this.state.pos = [sp.x, sp.y, sp.z];
      this.state.yaw = p.facing;
    }
    this.state.zone = this.zone ? this.zone.id : this.state.zone;
    this.state.save();
  }

  // ---------------------------------------------------------------------------
  showTitle() {
    this.mode = 'title';
    this.controlEnabled = false;
    this.menus.closeAll();
    this.menus.showEnding(false);
    this.hud.show(false);
    this.dialogue.close && this.dialogue.active && this.dialogue.close();
    this.setZone('city');
    this.player.setState('locked');
    this.player.teleport(this.zones.city.spawns.start.pos, this.zones.city.spawns.start.yaw);
    this.player.avatar.setVisible(false);
    this.menus.showTitle(true, this.state.hasSave());
    this.audio.setZone('title');
    this.cineBars.classList.remove('on');
    this.fadeTo(0, 1.2);
  }

  // a world that has been played in is rebuilt through a page reload (robust reset)
  bootAgain(kind) {
    try { sessionStorage.setItem('wr_boot', kind); } catch (e) { /* ignore */ }
    this.fadeTo(1, 0.3, () => location.reload());
  }

  startNew() {
    if (this.dirty) { this.state.clearSave(); this.bootAgain('new'); return; }
    this.dirty = true;
    this.state.reset();
    this.state.clearSave();
    this.applyStateToWorld();
    const s = this.zones.city.spawns.start;
    this.beginPlay('city', s.pos, s.yaw);
    this.quest.set('talk_miko', false);
    this.hud.showHints(120);
    this.after(0.8, () => this.hud.areaTitle(this.zones.city.name, this.zones.city.subtitle));
    if (this.zones.city.intro) this.zones.city.intro();
  }

  continueGame() {
    if (this.dirty) { this.bootAgain('continue'); return; }
    if (!this.state.load()) { this.startNew(); return; }
    this.dirty = true;
    this.applyStateToWorld();
    const z = this.zones[this.state.zone] || this.zones.city;
    const p = this.state.pos ? new THREE.Vector3(...this.state.pos) : z.spawns.start.pos;
    this.beginPlay(z.id, p, this.state.yaw || 0);
    this.player.hp = Math.max(2, this.state.hp);
    this.player.maxHp = this.state.maxHp;
    this.quest.refresh();
    this.after(0.8, () => this.hud.areaTitle(z.name, z.subtitle));
  }

  applyStateToWorld() {
    if (this.state.flags.coreActive) warmAfterEnding(this);
    for (const z of Object.values(this.zones)) if (z.applyState) z.applyState(this.state);
    this.player.maxHp = this.state.maxHp;
    this.player.hp = this.state.hp;
  }

  beginPlay(zoneId, pos, yaw) {
    this.menus.showTitle(false);
    this.menus.closeAll();
    this.cam.shots = null; this.cam.onShotsDone = null;
    this.cineBars.classList.remove('on');
    this.skipHint.classList.add('hidden');
    this.mode = 'play';
    this.setZone(zoneId);
    this.player.avatar.setVisible(true);
    this.player.teleport(pos, yaw);
    this.player.setState('ground');
    this.player.stamina = 1; this.player.exhausted = false;
    this.cam.snapTo(_focus.copy(pos).add(new THREE.Vector3(0, 1.5, 0)), yaw + Math.PI);
    this.cam.pitch = 0.3;
    this.hud.show(true);
    this.controlEnabled = true;
    this.input.requestLock();
    this.fadeTo(0, 0.8);
  }

  pause() {
    if (this.mode !== 'play') return;
    this.mode = 'paused';
    this.menus.showPause(true);
    this.input.exitLock();
    this.input.clear();
  }
  resume() {
    if (this.mode !== 'paused') return;
    this.menus.closeAll();
    this.mode = 'play';
    this.input.requestLock();
    this.input.clear();
  }
  afterEnding() {
    this.menus.showEnding(false);
    warmAfterEnding(this);
    this.state.stage = 'free';
    this.beginPlay('city', new THREE.Vector3(0, 0, 13), Math.PI);
    this.quest.refresh(true);
    this.hud.areaTitle('天鸣城', '风已归来');
    this.saveGame();
  }

  toTitle() {
    this.saveGame();
    this.menus.closeAll();
    this.cam.shots = null;
    this.fadeTo(1, 0.4, () => this.showTitle());
  }

  // ---------------------------------------------------------------------------
  // dialogue helper: lines [{name,text}] ; locks control
  talk(lines, onDone, { focus = null } = {}) {
    this.controlEnabled = false;
    this.player.vel.set(0, this.player.vel.y, 0);
    this.dialogue.show(lines, () => {
      this.player.talkMode = null;
      if (!this.cam.cinematic && !this.busy) this.controlEnabled = true;
      if (onDone) onDone();
    });
    void focus;
  }

  itemGet(opts, onDone) {
    this.controlEnabled = false;
    this.dialogue.itemGet(opts, () => { if (!this.cam.cinematic && !this.dialogue.active) this.controlEnabled = true; if (onDone) onDone(); });
  }

  // shots: see CameraRig.play. Appends a smooth return to the gameplay camera.
  cutscene(shots, onDone, { returnCam = true } = {}) {
    this.controlEnabled = false;
    this.cineBars.classList.add('on');
    this.skipHint.classList.remove('hidden');
    const list = shots.slice();
    if (returnCam) {
      const last = list[list.length - 1];
      const p = this.player.pos;
      const cp = Math.cos(this.cam.pitch);
      const back = new THREE.Vector3(p.x + Math.sin(this.cam.yaw) * cp * this.cam.dist, p.y + 1.5 + Math.sin(this.cam.pitch) * this.cam.dist, p.z + Math.cos(this.cam.yaw) * cp * this.cam.dist);
      list.push({ pos: last.pos2 || last.pos, pos2: back, look: last.look2 || last.look, look2: new THREE.Vector3(p.x, p.y + 1.5, p.z), dur: 0.8 });
    }
    this.cam.play(list, () => {
      this.cineBars.classList.remove('on');
      this.skipHint.classList.add('hidden');
      this.cam.focus.set(this.player.pos.x, this.player.pos.y + 1.5, this.player.pos.z);
      this.cam.collDist = this.cam.dist;
      if (!this.dialogue.active && !this.dialogue.itemActive && !this.busy) this.controlEnabled = true;
      if (onDone) onDone();
    });
  }

  // ---------------------------------------------------------------------------
  nearestEnemy(pos, r) {
    if (!this.zone) return null;
    let best = null, bd = r;
    for (const e of this.zone.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
      if (d < bd && Math.abs(e.pos.y - pos.y) < 3) { bd = d; best = e; }
    }
    return best;
  }

  meleeHit(player, dmg, knock) {
    const z = this.zone;
    const fx = Math.sin(player.facing), fz = Math.cos(player.facing);
    let hits = 0;
    const tryHit = (t, rad) => {
      const dx = t.pos.x - player.pos.x, dz = t.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz) || 0.001;
      if (d > 2.8 + rad) return false;
      if (Math.abs(t.pos.y - player.pos.y) > 2.7) return false;
      if (d > 0.9 && (dx * fx + dz * fz) / d < 0.2) return false;
      return { x: dx / d, z: dz / d };
    };
    for (const e of z.enemies) {
      if (!e.alive) continue;
      const dir = tryHit(e, e.radius || 0.5);
      if (dir && e.hit(dmg, dir, knock, player)) hits++;
    }
    for (const b of z.breakables) {
      if (b.broken) continue;
      const dir = tryHit(b, b.radius || 0.5);
      if (dir) { b.hit(dir); hits++; }
    }
    if (hits) {
      this.hitStop = 0.07;
      this.cam.shake(0.28);
    }
  }

  fallRespawn(manual = false) {
    if (this.busy || this.player.state === 'dead') return;
    this.busy = true;
    this.controlEnabled = false;
    const p = this.player;
    p.setState('locked');
    this.fadeTo(1, 0.3, () => {
      p.teleport(p.lastSafe.clone(), p.facing);
      if (!manual) p.hp = Math.max(1, p.hp - 1);
      this.cam.snapTo(_focus.copy(p.pos).add(new THREE.Vector3(0, 1.5, 0)));
      this.after(0.2, () => this.fadeTo(0, 0.45, () => { this.busy = false; this.controlEnabled = true; }));
    });
  }

  onPlayerDeath() {
    const p = this.player;
    this.state.stats.deaths++;
    p.setState('dead');
    this.controlEnabled = false;
    this.busy = true;
    this.audio.sfx('death');
    this.hud.toast('力竭倒下了……');
    this.deathT = 0;
    this.after(1.6, () => {
      this.fadeTo(1, 0.6, () => {
        const z = this.zone;
        const cp = (z.checkpoint && z.checkpoint()) || z.spawns.start;
        p.teleport(cp.pos.clone(), cp.yaw);
        p.hp = p.maxHp;
        p.stamina = 1; p.exhausted = false;
        if (z.resetEnemies) z.resetEnemies();
        this.engine.post.uDesat.value = 0;
        this.cam.snapTo(_focus.copy(p.pos).add(new THREE.Vector3(0, 1.5, 0)), cp.yaw + Math.PI);
        this.after(0.3, () => this.fadeTo(0, 0.8, () => {
          this.busy = false; this.controlEnabled = true;
          this.hud.toast('一阵温柔的风将你唤醒');
        }));
      });
    });
  }

  // ---------------------------------------------------------------------------
  updateInteract() {
    const z = this.zone, p = this.player;
    if (!this.controlEnabled || p.state !== 'ground' || !p.grounded) { this.hud.setPrompt(null); this.focusIt = null; return; }
    let best = null, bd = Infinity;
    const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
    for (const it of z.interactables) {
      if (it.canInteract && !it.canInteract()) continue;
      const ip = it.interactPos ? it.interactPos() : it.pos;
      const dx = ip.x - p.pos.x, dz = ip.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      const rad = it.interactRadius || 2.2;
      if (d > rad || Math.abs(ip.y - p.pos.y) > 2.6) continue;
      const facing = d < 0.8 ? 1 : (dx * fx + dz * fz) / d;
      const score = d - facing * 0.8;
      if (facing < -0.2) continue;
      if (score < bd) { bd = score; best = it; }
    }
    this.focusIt = best;
    if (best) {
      this.hud.setPrompt('E', typeof best.prompt === 'function' ? best.prompt() : best.prompt);
      if (this.input.hit('interact')) { this.input.consume('interact'); best.interact(this); }
    } else this.hud.setPrompt(null);
  }

  update(dt) {
    const inp = this.input;
    // timers
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); }
    }
    // fade
    if (this.fadeAnim) {
      const f = this.fadeAnim;
      f.t += dt;
      const k = clamp(f.t / f.dur, 0, 1);
      this.fadeV = lerp(f.from, f.to, k);
      this.fadeEl.style.opacity = this.fadeV.toFixed(3);
      if (k >= 1) { this.fadeAnim = null; if (f.cb) f.cb(); }
    }
    const post = this.engine.post;
    post.uFlash.value = Math.max(0, post.uFlash.value - dt * 2);
    if (this.player.state === 'dead') post.uDesat.value = Math.min(0.85, post.uDesat.value + dt * 0.8);

    if (this.mode === 'title') {
      this.titleT += dt;
      U.uTime.value += dt;
      const z = this.zone;
      z.update(dt);
      const a = this.titleT * 0.05 + 0.4;
      const ctr = z.titleFocus || new THREE.Vector3(0, 3, 0);
      this.camera.position.set(ctr.x + Math.sin(a) * 34, ctr.y + 12 + Math.sin(this.titleT * 0.1) * 2, ctr.z + Math.cos(a) * 34);
      this.camera.lookAt(ctr.x, ctr.y + 4, ctr.z);
      z.sun.update(ctr);
      z.sky.update(this.camera);
      this.fx.update(dt, this.camera);
      this.fx.ambientWind(dt, ctr, U.uWind.value, 1.5);
      this.audio.update(dt, {});
      inp.endFrame();
      return;
    }
    if (this.mode === 'paused' || this.mode === 'loading') {
      if (this.mode === 'paused' && inp.hit('pause') && !this.menus.anyOpen()) this.resume();
      inp.endFrame();
      return;
    }
    if (this.mode === 'ending') {
      U.uTime.value += dt;
      this.zone.update(dt);
      this.cam.update(dt, null, _focus.copy(this.player.pos).setY(this.player.pos.y + 1.5), this.zone.physics, { control: false });
      this.zone.sun.update(this.player.pos);
      this.zone.sky.update(this.camera);
      this.fx.update(dt, this.camera);
      this.hud.update(dt);
      this.audio.update(dt, {});
      inp.endFrame();
      return;
    }

    // --- play
    if (inp.hit('pause') && !this.input.locked && !this.dialogue.active && !this.cam.cinematic) { this.pause(); inp.endFrame(); return; }
    if (this.cam.cinematic && inp.hit('skip')) this.cam.skip();
    if (inp.hit('debug')) { this.settings.fps = !this.settings.fps; this.hud.setFps(this.settings.fps); }

    let gdt = dt;
    if (this.hitStop > 0) { this.hitStop -= dt; gdt = dt * 0.08; }
    U.uTime.value += gdt;
    const z = this.zone;
    for (const c of z.physics.dynamic) { c.dx = 0; c.dy = 0; c.dz = 0; }
    z.update(gdt);
    this.player.update(gdt);
    U.uPlayer.value.copy(this.player.pos);
    if (this.player.state !== 'dead') z.updateTriggers(this.player.pos);
    this.updateInteract();
    this.quest.update(dt);
    this.dialogue.update(dt, inp);

    const p = this.player;
    _focus.set(p.pos.x, p.pos.y + 1.5, p.pos.z);
    const fov = p.sprinting ? 60 : 55;
    this.cam.update(dt, this.controlEnabled || this.dialogue.active ? inp : null, _focus, z.physics, { maxDist: z.camMaxDist, fov, fastY: p.state === 'climb' || p.state === 'mantle' });
    z.sun.update(p.pos);
    z.sky.update(this.camera);
    this.fx.update(gdt, this.camera);
    if (z.ambientWind > 0) this.fx.ambientWind(dt, p.pos, U.uWind.value, z.ambientWind);
    this.hud.update(dt);
    this.hud.setLockHint(!inp.locked && this.controlEnabled && !this.dialogue.active);
    this.audio.update(dt, { water: z.nearWater ? z.nearWater(p.pos) : 0 });
    this.state.stats.time += dt;
    this.autoQuality(dt);
    inp.endFrame();
  }

  render(dt) {
    if (!this.zone) return;
    this.engine.render(this.zone.scene, this.camera, dt);
  }
}
