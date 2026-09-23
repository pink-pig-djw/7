// Fully procedural Web Audio: SFX, ambience and music (no audio files).
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // midi -> Hz
const M = { C4: 60, D4: 62, E4: 64, Fs4: 66, G4: 67, A4: 69, B4: 71, C5: 72, D5: 74, E5: 76, Fs5: 78, G5: 79, A5: 81, B5: 83, C6: 84, D6: 86 };

// City theme (original): [midi, beats]
const CITY_MELODY = [
  [69, 1], [74, 0.5], [76, 0.5], [78, 1], [76, 1],
  [74, 1], [71, 0.5], [69, 0.5], [71, 2],
  [69, 1], [74, 0.5], [76, 0.5], [78, 1], [81, 1],
  [83, 1.5], [81, 0.5], [78, 2],
  [81, 1], [78, 0.5], [76, 0.5], [74, 1], [76, 1],
  [78, 1], [76, 0.5], [74, 0.5], [71, 2],
  [69, 1], [71, 0.5], [74, 0.5], [76, 1], [78, 0.5], [76, 0.5],
  [74, 4],
];
// chord roots per bar (midi) + quality
const CITY_CHORDS = [[62, 'M'], [59, 'm'], [62, 'M'], [55, 'M'], [62, 'M'], [59, 'm'], [55, 'M'], [62, 'M']];
const ENDING_CHORDS = [[60, 'M'], [55, 'M'], [57, 'm'], [53, 'M'], [60, 'M'], [55, 'M'], [53, 'M'], [55, 'M']];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.musicVol = 0.55;
    this.sfxVol = 0.8;
    this.zone = null;
    this.musicStyle = null;
    this.nextNote = 0;
    this.melIdx = 0;
    this.beat = 0;
    this.ambient = {};
    this.lastStep = 0;
    this.waterAmt = 0;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { this.ctx = null; return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    this.musicBus = c.createGain(); this.musicBus.gain.value = this.musicVol * 0.5;
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = this.sfxVol;
    this.ambBus = c.createGain(); this.ambBus.gain.value = this.sfxVol * 0.6;
    this.musicBus.connect(this.master); this.sfxBus.connect(this.master); this.ambBus.connect(this.master);
    // reverb
    this.reverb = c.createConvolver();
    this.reverb.buffer = this._impulse(3.2, 2.6);
    this.revSend = c.createGain(); this.revSend.gain.value = 0.9;
    this.revSend.connect(this.reverb); this.reverb.connect(this.master);
    this.musicRev = c.createGain(); this.musicRev.gain.value = 0.55;
    this.musicBus.connect(this.musicRev); this.musicRev.connect(this.revSend);
    this.sfxRev = c.createGain(); this.sfxRev.gain.value = 0.18;
    this.sfxBus.connect(this.sfxRev); this.sfxRev.connect(this.revSend);
    this.noise = this._noise(2);
    this._startAmbience();
    this.nextNote = c.currentTime + 0.3;
    if (this.zone) this.setZone(this.zone);
  }

  setVolumes(music, sfx) {
    this.musicVol = music; this.sfxVol = sfx;
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(music * 0.5, this.ctx.currentTime, 0.1);
    this.sfxBus.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.1);
    this.ambBus.gain.setTargetAtTime(sfx * 0.6, this.ctx.currentTime, 0.1);
  }

  _impulse(dur, decay) {
    const c = this.ctx, len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  _noise(dur) {
    const c = this.ctx, len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    return buf;
  }

  // ---- primitives
  _env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  tone(freq, { t = 0, type = 'sine', a = 0.005, dec = 0.3, gain = 0.2, dest = null, freq2 = null, pan = 0, detune = 0 } = {}) {
    const c = this.ctx; if (!c) return;
    const when = c.currentTime + t;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, when); o.detune.value = detune;
    if (freq2) o.frequency.exponentialRampToValueAtTime(freq2, when + a + dec);
    const g = c.createGain(); this._env(g, when, a, gain, dec);
    let node = g;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
    o.connect(g); node.connect(dest || this.sfxBus);
    o.start(when); o.stop(when + a + dec + 0.05);
  }
  burst({ t = 0, dur = 0.2, a = 0.005, type = 'bandpass', f = 1000, f2 = null, q = 1, gain = 0.3, dest = null, pan = 0, rate = 1 } = {}) {
    const c = this.ctx; if (!c) return;
    const when = c.currentTime + t;
    const s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = rate;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, when); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, when + dur);
    const g = c.createGain(); this._env(g, when, a, gain, dur);
    s.connect(fl); fl.connect(g);
    let node = g;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
    node.connect(dest || this.sfxBus);
    s.start(when, Math.random() * 1.5); s.stop(when + a + dur + 0.05);
  }
  bell(freq, { t = 0, gain = 0.12, dec = 1.6, dest = null, pan = 0 } = {}) {
    const parts = [[1, 1], [2.76, 0.4], [5.4, 0.18], [8.93, 0.08]];
    for (const [m, g] of parts) this.tone(freq * m, { t, gain: gain * g, a: 0.002, dec: dec / Math.sqrt(m), dest, pan });
  }
  pluck(freq, { t = 0, gain = 0.1, dec = 1.2, dest = null, pan = 0, bright = 1 } = {}) {
    const c = this.ctx; if (!c) return;
    const when = c.currentTime + t;
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(freq * 1.004, when); o.frequency.exponentialRampToValueAtTime(freq, when + 0.08);
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2;
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(freq * 8 * bright, when); fl.frequency.exponentialRampToValueAtTime(freq * 1.5, when + dec * 0.6);
    const g = c.createGain(); this._env(g, when, 0.004, gain, dec);
    const g2 = c.createGain(); this._env(g2, when, 0.003, gain * 0.25, dec * 0.4);
    o.connect(fl); fl.connect(g); o2.connect(g2);
    let out = c.createGain(); g.connect(out); g2.connect(out);
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; out.connect(p); out = p; }
    out.connect(dest || this.musicBus);
    o.start(when); o2.start(when); o.stop(when + dec + 0.1); o2.stop(when + dec + 0.1);
  }
  pad(midis, { t = 0, dur = 4, gain = 0.035, dest = null } = {}) {
    const c = this.ctx; if (!c) return;
    const when = c.currentTime + t;
    for (const n of midis) {
      for (const det of [-6, 6]) {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = NOTE(n); o.detune.value = det;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.linearRampToValueAtTime(gain, when + dur * 0.35);
        g.gain.linearRampToValueAtTime(0.0001, when + dur);
        o.connect(g); g.connect(dest || this.musicBus);
        o.start(when); o.stop(when + dur + 0.05);
      }
    }
  }

  // ---- sfx ----------------------------------------------------------------
  sfx(name) {
    if (!this.ctx) return;
    const r = Math.random;
    switch (name) {
      case 'jump': this.burst({ dur: 0.14, f: 600, f2: 1800, q: 0.8, gain: 0.12 }); break;
      case 'land': this.tone(95, { dec: 0.16, gain: 0.22, freq2: 60 }); this.burst({ dur: 0.12, type: 'lowpass', f: 500, gain: 0.2 }); break;
      case 'roll': this.burst({ dur: 0.32, f: 400, f2: 1200, q: 0.7, gain: 0.16 }); break;
      case 'swing': this.burst({ dur: 0.16, f: 900, f2: 3200, q: 1.4, gain: 0.2, rate: 1.2 }); break;
      case 'swing2': this.burst({ dur: 0.24, f: 600, f2: 2600, q: 1.2, gain: 0.26 }); this.tone(160, { dec: 0.2, gain: 0.06, freq2: 90 }); break;
      case 'hit': this.burst({ dur: 0.08, type: 'highpass', f: 1800, gain: 0.3 }); this.tone(190, { dec: 0.14, gain: 0.3, freq2: 90 }); this.tone(1250 + r() * 200, { dec: 0.12, gain: 0.07, type: 'triangle' }); break;
      case 'clay': this.tone(420 + r() * 80, { dec: 0.1, gain: 0.25, type: 'triangle', freq2: 260 }); this.burst({ dur: 0.07, f: 2500, gain: 0.15 }); break;
      case 'enemyDie': this.burst({ dur: 0.6, type: 'lowpass', f: 1600, f2: 180, gain: 0.35 }); for (let i = 0; i < 4; i++) this.bell(NOTE(84 + [0, 3, 7, 10][i]), { t: 0.08 * i, gain: 0.04, dec: 0.6 }); break;
      case 'hurt': this.tone(210, { dec: 0.2, gain: 0.25, type: 'square', freq2: 110 }); this.burst({ dur: 0.15, type: 'lowpass', f: 900, gain: 0.3 }); break;
      case 'gust':
        this.burst({ dur: 0.75, a: 0.08, f: 380, f2: 1700, q: 0.9, gain: 0.34 });
        this.burst({ t: 0.05, dur: 0.6, a: 0.05, type: 'highpass', f: 2600, f2: 5200, gain: 0.07 });
        this.tone(760, { a: 0.05, dec: 0.45, gain: 0.03, freq2: 1300 });
        break;
      case 'chime': for (let i = 0; i < 4; i++) this.bell(NOTE([86, 88, 91, 93, 95][Math.floor(r() * 5)]), { t: r() * 0.4, gain: 0.05, dec: 1.4, pan: r() - 0.5 }); break;
      case 'activate': this.bell(NOTE(74), { gain: 0.1 }); this.bell(NOTE(81), { t: 0.12, gain: 0.1 }); this.bell(NOTE(86), { t: 0.24, gain: 0.08, dec: 2 }); break;
      case 'solve': [74, 76, 79, 81, 83, 86].forEach((n, i) => { this.bell(NOTE(n), { t: i * 0.09, gain: 0.09, dec: 1.8 }); this.pluck(NOTE(n - 12), { t: i * 0.09, gain: 0.05, dest: this.sfxBus }); }); this.pad([62, 66, 69, 74], { t: 0.5, dur: 2.4, gain: 0.03, dest: this.sfxBus }); break;
      case 'item': [67, 72, 76, 79].forEach((n, i) => this.bell(NOTE(n), { t: i * 0.14, gain: 0.1, dec: 2.2 })); this.pad([60, 64, 67, 72], { t: 0.56, dur: 2.2, gain: 0.04, dest: this.sfxBus }); this.burst({ t: 0.5, dur: 1.2, type: 'highpass', f: 6000, gain: 0.05 }); break;
      case 'reveal': for (let i = 0; i < 6; i++) this.tone(NOTE(88 + i * 2), { t: i * 0.05, dec: 0.6, gain: 0.035 }); this.burst({ dur: 0.8, type: 'highpass', f: 5000, gain: 0.05 }); break;
      case 'rumble': this.burst({ dur: 2.2, a: 0.2, type: 'lowpass', f: 160, gain: 0.5 }); this.tone(48, { a: 0.3, dec: 2, gain: 0.25 }); break;
      case 'click': this.tone(880, { dec: 0.05, gain: 0.05, type: 'triangle' }); break;
      case 'talk': this.tone(NOTE([74, 76, 78, 81, 83][Math.floor(r() * 5)]), { dec: 0.05, gain: 0.025, type: 'triangle' }); break;
      case 'splash': this.burst({ dur: 0.5, f: 1400, f2: 500, q: 0.6, gain: 0.3 }); for (let i = 0; i < 4; i++) this.tone(600 + r() * 600, { t: 0.05 + r() * 0.3, dec: 0.08, gain: 0.03, freq2: 1500 }); break;
      case 'grab': this.burst({ dur: 0.08, f: 2400, q: 1.5, gain: 0.1 }); break;
      case 'exhaust': this.burst({ dur: 0.5, f: 800, q: 0.8, gain: 0.1 }); break;
      case 'heart': this.bell(NOTE(88), { gain: 0.08, dec: 0.8 }); this.bell(NOTE(93), { t: 0.1, gain: 0.08, dec: 1 }); break;
      case 'thunk': this.burst({ dur: 0.45, type: 'lowpass', f: 420, gain: 0.35 }); this.tone(70, { dec: 0.3, gain: 0.25, freq2: 50 }); break;
      case 'error': this.tone(116, { dec: 0.35, gain: 0.08, type: 'square' }); this.tone(110, { t: 0.02, dec: 0.35, gain: 0.08, type: 'square' }); break;
      case 'spin': this.burst({ dur: 1.0, a: 0.2, f: 300, f2: 700, q: 2, gain: 0.12 }); break;
      case 'bell': this.bell(NOTE(50), { gain: 0.3, dec: 5 }); this.bell(NOTE(57), { t: 0.02, gain: 0.12, dec: 4 }); break;
      case 'orb': this.tone(500, { dec: 0.3, gain: 0.06, type: 'sine', freq2: 260 }); break;
      case 'crack': this.burst({ dur: 0.3, type: 'highpass', f: 900, gain: 0.3 }); this.tone(80, { dec: 0.4, gain: 0.3, freq2: 40 }); break;
      case 'dispel': this.burst({ dur: 1.2, a: 0.05, type: 'bandpass', f: 1800, f2: 300, q: 0.7, gain: 0.25 }); for (let i = 0; i < 5; i++) this.bell(NOTE(81 + i * 3), { t: 0.1 + i * 0.07, gain: 0.04, dec: 1 }); break;
      case 'door': this.burst({ dur: 1.4, a: 0.1, type: 'lowpass', f: 260, gain: 0.4 }); this.tone(62, { a: 0.1, dec: 1.2, gain: 0.18 }); break;
      case 'pickup': this.bell(NOTE(84), { gain: 0.07, dec: 0.6 }); break;
      case 'core': [50, 57, 62, 66, 69, 74].forEach((n, i) => this.bell(NOTE(n), { t: i * 0.18, gain: 0.12, dec: 4 })); this.pad([50, 57, 62, 66], { dur: 6, gain: 0.05, dest: this.sfxBus }); break;
      case 'death': this.tone(300, { dec: 1.2, gain: 0.12, type: 'triangle', freq2: 80 }); break;
      default: break;
    }
  }

  step(surface, sprint) {
    if (!this.ctx) return;
    const g = sprint ? 0.13 : 0.09;
    if (surface === 'grass') this.burst({ dur: 0.07, f: 2200 + Math.random() * 800, q: 0.9, gain: g * 0.9 });
    else if (surface === 'wood') { this.tone(170 + Math.random() * 30, { dec: 0.06, gain: g, type: 'triangle' }); }
    else if (surface === 'water') this.burst({ dur: 0.12, f: 1100, q: 0.6, gain: g * 1.2 });
    else this.burst({ dur: 0.045, type: 'highpass', f: 1400 + Math.random() * 600, gain: g * 1.1 });
  }

  // ---- ambience -----------------------------------------------------------
  _startAmbience() {
    const c = this.ctx;
    const mk = (type, f, q) => {
      const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(this.ambBus); s.start();
      return { s, fl, g };
    };
    this.ambient.wind = mk('lowpass', 500, 0.5);
    this.ambient.water = mk('bandpass', 900, 0.5);
    this.ambient.drone = (() => {
      const o1 = c.createOscillator(), o2 = c.createOscillator();
      o1.frequency.value = 55; o2.frequency.value = 55.6; o1.type = o2.type = 'sine';
      const g = c.createGain(); g.gain.value = 0;
      o1.connect(g); o2.connect(g); g.connect(this.ambBus); o1.start(); o2.start();
      return { g };
    })();
    this.birdT = 2;
    this.dripT = 1;
  }

  setZone(id) {
    this.zone = id;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const A = this.ambient;
    const wind = id === 'wilds' ? 0.28 : id === 'city' || id === 'title' ? 0.12 : 0.04;
    A.wind.g.gain.setTargetAtTime(wind, t, 1.2);
    A.drone.g.gain.setTargetAtTime(id === 'undercroft' ? 0.06 : 0, t, 1.5);
    this.setMusic(id === 'title' ? 'title' : id);
  }

  setMusic(style) {
    if (this.musicStyle === style) return;
    this.musicStyle = style;
    this.melIdx = 0;
    this.beat = 0;
    if (this.ctx) this.nextNote = this.ctx.currentTime + 0.5;
  }

  update(dt, info = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const A = this.ambient;
    // wind swell
    const sw = 0.7 + 0.3 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1);
    A.wind.fl.frequency.setTargetAtTime(380 + sw * 420, t, 0.5);
    const water = Math.max(0, Math.min(1, info.water || 0));
    this.waterAmt += (water - this.waterAmt) * Math.min(1, dt * 2);
    A.water.g.gain.setTargetAtTime(this.waterAmt * 0.22, t, 0.3);
    // birds
    if (this.zone === 'wilds' || this.zone === 'city') {
      this.birdT -= dt;
      if (this.birdT <= 0) {
        this.birdT = 2.5 + Math.random() * 6;
        const base = 2400 + Math.random() * 1600, pan = Math.random() * 1.6 - 0.8;
        const n = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) this.tone(base * (1 + Math.random() * 0.15), { t: i * 0.11, a: 0.01, dec: 0.07, gain: 0.018, freq2: base * 1.35, pan, dest: this.ambBus });
      }
    }
    if (this.zone === 'undercroft') {
      this.dripT -= dt;
      if (this.dripT <= 0) { this.dripT = 1.5 + Math.random() * 4; this.tone(1800 + Math.random() * 900, { dec: 0.12, gain: 0.03, freq2: 700, pan: Math.random() - 0.5, dest: this.ambBus }); }
    }
    this._music();
  }

  _music() {
    const c = this.ctx;
    const style = this.musicStyle;
    if (!style) return;
    const ahead = c.currentTime + 0.25;
    while (this.nextNote < ahead) {
      const when = this.nextNote - c.currentTime;
      if (style === 'city' || style === 'title' || style === 'ending') this._cityStep(when, style);
      else if (style === 'wilds') this._wildsStep(when);
      else if (style === 'undercroft') this._underStep(when);
      else { this.nextNote += 1; }
    }
  }

  _chord(root, q) { return q === 'm' ? [root, root + 3, root + 7] : [root, root + 4, root + 7]; }

  _cityStep(when, style) {
    const bpm = style === 'ending' ? 92 : style === 'title' ? 70 : 84;
    const spb = 60 / bpm;
    const [n, beats] = CITY_MELODY[this.melIdx];
    const barBeat = this.beat % 4;
    const bar = Math.floor(this.beat / 4) % 8;
    const chords = style === 'ending' ? ENDING_CHORDS : CITY_CHORDS;
    const shift = style === 'ending' ? -2 : 0;
    if (barBeat === 0 || (barBeat + beats > 4 && Math.floor((this.beat + beats) / 4) !== Math.floor(this.beat / 4))) {
      // new bar => pad + bass
    }
    if (Math.abs(this.beat % 4) < 1e-6) {
      const [root, q] = chords[bar];
      this.pad(this._chord(root, q).map((x) => x + 12), { t: when, dur: spb * 4.2, gain: style === 'ending' ? 0.03 : 0.022 });
      this.pluck(NOTE(root - 12), { t: when, gain: 0.07, dec: spb * 2.5 });
      this.pluck(NOTE(root - 5), { t: when + spb * 2, gain: 0.05, dec: spb * 2 });
      if (style !== 'title') for (let k = 0; k < 4; k++) this.pluck(NOTE(this._chord(root, q)[k % 3] + 12), { t: when + spb * (k + 0.5), gain: 0.022, dec: spb * 1.2, pan: k % 2 ? 0.3 : -0.3 });
    }
    const gain = style === 'title' ? 0.06 : 0.075;
    this.pluck(NOTE(n + shift), { t: when, gain, dec: Math.max(0.6, beats * spb * 1.4), pan: 0.1 });
    if (style === 'ending') this.bell(NOTE(n + shift + 12), { t: when, gain: 0.025, dec: 1.2, dest: this.musicBus });
    this.nextNote += beats * spb;
    this.beat += beats;
    this.melIdx = (this.melIdx + 1) % CITY_MELODY.length;
  }

  _wildsStep(when) {
    // sparse, airy "field piano"
    const scale = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81];
    const chords = [[57, 'm'], [53, 'M'], [60, 'M'], [55, 'M']];
    const idx = Math.floor(this.beat / 8) % 4;
    if (this.beat % 8 === 0) {
      const [root, q] = chords[idx];
      this.pad(this._chord(root, q).map((x) => x + 12), { t: when, dur: 9, gain: 0.018 });
      this.pluck(NOTE(root - 12), { t: when, gain: 0.05, dec: 4 });
    }
    const r = Math.random();
    if (r < 0.55) {
      const n = scale[Math.floor(Math.random() * scale.length)];
      this.pluck(NOTE(n), { t: when, gain: 0.055, dec: 2.8, pan: Math.random() * 0.6 - 0.3, bright: 0.7 });
      if (Math.random() < 0.3) this.pluck(NOTE(n + (Math.random() < 0.5 ? 3 : 4)), { t: when + 0.18, gain: 0.04, dec: 2.4, bright: 0.7 });
    }
    this.nextNote += 0.9 + (Math.random() < 0.3 ? 0.9 : 0);
    this.beat += 1;
  }

  _underStep(when) {
    const scale = [50, 51, 55, 57, 58, 62, 63, 67];
    if (this.beat % 6 === 0) this.pad([38, 45], { t: when, dur: 8, gain: 0.03 });
    if (Math.random() < 0.45) this.bell(NOTE(scale[Math.floor(Math.random() * scale.length)] + 12), { t: when, gain: 0.03, dec: 3, dest: this.musicBus, pan: Math.random() - 0.5 });
    this.nextNote += 1.4;
    this.beat += 1;
  }
}
export { M as NOTES };
