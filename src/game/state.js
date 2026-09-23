// World progress + player state, persisted to localStorage (autosave).
const KEY = 'windrune_save_v1';
const SETTINGS_KEY = 'windrune_settings_v1';

export class GameState {
  constructor() { this.reset(); }

  reset() {
    this.flags = {
      hasRune: false,          // learned the Wind Rune
      metMiko: false,
      gateBrambles: false,     // brambles on the gate wheel dispelled
      gateOpen: false,
      enteredWilds: false,
      pillarFallen: false,     // broken bridge crossed via toppled pillar
      ruinsBarrier: false,     // cursed mist at ruins dispelled
      ruinsPlate: false,       // hidden pressure plate revealed
      ruinsDoor: false,
      pillarA: false, pillarB: false, pillarC: false,
      crystalTaken: false,
      cityChanged: false,      // city mechanisms reacted to the crystal
      templeOpen: false,       // undercroft entrance opened
      ucHall: false,           // undercroft: rune-order door
      ucGrate: false,          // undercroft: block on plate
      ucCrossed: false,
      ucArena: false,          // undercroft: guardians defeated
      coreActive: false,       // city core restarted -> ending
      ending: false,
      caveChest: false,
      towerChest: false,
    };
    this.stage = 'talk_miko';
    this.zone = 'city';
    this.pos = null;
    this.yaw = 0;
    this.hp = 8;
    this.maxHp = 8;
    this.stats = { time: 0, kills: 0, secrets: 0, deaths: 0 };
    this.done = {};
  }

  toJSON() {
    return { flags: this.flags, stage: this.stage, zone: this.zone, pos: this.pos, yaw: this.yaw, hp: this.hp, maxHp: this.maxHp, stats: this.stats, done: this.done, v: 1 };
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.toJSON())); return true; } catch (e) { return false; }
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || d.v !== 1) return false;
      this.reset();
      Object.assign(this.flags, d.flags || {});
      this.stage = d.stage || this.stage;
      this.zone = d.zone || 'city';
      this.pos = d.pos || null;
      this.yaw = d.yaw || 0;
      this.hp = d.hp || 8;
      this.maxHp = d.maxHp || 8;
      Object.assign(this.stats, d.stats || {});
      this.done = d.done || {};
      return true;
    } catch (e) { return false; }
  }

  hasSave() {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  }

  clearSave() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
}

export function loadSettings() {
  const def = { quality: null, sens: 1, invert: false, music: 0.55, sfx: 0.8, marker: true, fps: false };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return Object.assign(def, JSON.parse(raw));
  } catch (e) { /* ignore */ }
  return def;
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}
