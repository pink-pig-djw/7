// Title / pause / help / settings / ending overlays.
import { saveSettings } from '../game/state.js';

const $ = (id) => document.getElementById(id);

export class Menus {
  constructor(game) {
    this.game = game;
    this.title = $('title');
    this.pause = $('pause');
    this.help = $('help');
    this.settings = $('settings');
    this.ending = $('ending');
    this.back = null;
    const click = () => game.audio.sfx('click');
    $('btn-new').onclick = () => { click(); game.startNew(); };
    $('btn-continue').onclick = () => { click(); game.continueGame(); };
    $('btn-help').onclick = () => { click(); this.open('help', 'title'); };
    $('btn-settings').onclick = () => { click(); this.open('settings', 'title'); };
    $('p-resume').onclick = () => { click(); game.resume(); };
    $('p-help').onclick = () => { click(); this.open('help', 'pause'); };
    $('p-settings').onclick = () => { click(); this.open('settings', 'pause'); };
    $('p-respawn').onclick = () => { click(); game.resume(); game.fallRespawn(true); };
    $('p-title').onclick = () => { click(); game.toTitle(); };
    $('e-continue').onclick = () => { click(); game.afterEnding(); };
    $('e-title').onclick = () => { click(); game.toTitle(); };
    document.querySelectorAll('[data-close]').forEach((b) => {
      b.onclick = () => { click(); this.close(b.dataset.close); };
    });
    this.bindSettings();
  }

  showTitle(v, canContinue) {
    this.title.classList.toggle('hidden', !v);
    $('btn-continue').disabled = !canContinue;
  }
  showPause(v) { this.pause.classList.toggle('hidden', !v); }
  showEnding(v, stats) {
    this.ending.classList.toggle('hidden', !v);
    if (v && stats) {
      const m = Math.floor(stats.time / 60), s = Math.floor(stats.time % 60);
      this.ending.querySelector('.stats').innerHTML =
        `游玩时间 ${m} 分 ${String(s).padStart(2, '0')} 秒 &nbsp;·&nbsp; 击退魔物 ${stats.kills} &nbsp;·&nbsp; 发现秘密 ${stats.secrets}/2 &nbsp;·&nbsp; 倒下次数 ${stats.deaths}`;
    }
  }

  open(which, from) {
    this.back = from;
    if (from === 'title') this.title.classList.add('hidden');
    if (from === 'pause') this.pause.classList.add('hidden');
    this[which].classList.remove('hidden');
    if (which === 'settings') this.refreshSettings();
  }
  close(which) {
    this[which].classList.add('hidden');
    if (this.back === 'title') this.title.classList.remove('hidden');
    if (this.back === 'pause') this.pause.classList.remove('hidden');
  }
  anyOpen() {
    return !this.help.classList.contains('hidden') || !this.settings.classList.contains('hidden');
  }
  closeAll() {
    for (const k of ['pause', 'help', 'settings', 'ending']) this[k].classList.add('hidden');
  }

  bindSettings() {
    const g = this.game;
    const seg = (id, key, conv = (v) => v) => {
      const el = $(id);
      el.querySelectorAll('button').forEach((b) => {
        b.onclick = () => { g.settings[key] = conv(b.dataset.v); if (key === 'quality') g.settings.userQuality = true; this.applySettings(); this.refreshSettings(); g.audio.sfx('click'); };
      });
    };
    seg('set-quality', 'quality');
    seg('set-invert', 'invert', (v) => v === '1');
    seg('set-marker', 'marker', (v) => v === '1');
    seg('set-fps', 'fps', (v) => v === '1');
    $('set-sens').oninput = (e) => { g.settings.sens = parseFloat(e.target.value); this.applySettings(); };
    $('set-music').oninput = (e) => { g.settings.music = parseFloat(e.target.value); this.applySettings(); };
    $('set-sfx').oninput = (e) => { g.settings.sfx = parseFloat(e.target.value); this.applySettings(); };
  }

  refreshSettings() {
    const s = this.game.settings;
    const mark = (id, val) => $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(val)));
    mark('set-quality', s.quality);
    mark('set-invert', s.invert ? '1' : '0');
    mark('set-marker', s.marker ? '1' : '0');
    mark('set-fps', s.fps ? '1' : '0');
    $('set-sens').value = s.sens;
    $('set-music').value = s.music;
    $('set-sfx').value = s.sfx;
  }

  applySettings() {
    const g = this.game, s = g.settings;
    if (g.engine.qualityName !== s.quality) g.setQuality(s.quality);
    g.input.sensitivity = s.sens;
    g.input.invertY = s.invert;
    g.audio.setVolumes(s.music, s.sfx);
    g.hud.showMarker = s.marker;
    g.hud.setFps(s.fps);
    saveSettings(s);
  }
}
