// Story stages, objective text and objective markers (routed across zones via portals).
import * as THREE from 'three';

const pillarsDone = (f) => (f.pillarA ? 1 : 0) + (f.pillarB ? 1 : 0) + (f.pillarC ? 1 : 0);

export const STAGES = {
  talk_miko: { text: '与喷泉旁的巫女「千风」交谈', mark: ['city', 'miko'] },
  touch_stele: { text: '触碰喷泉北侧的「风之石碑」', mark: ['city', 'stele'] },
  go_gate: { text: '前往南城门，与守门人交谈', mark: ['city', 'guard'] },
  open_gate: { text: '用风之符文驱散荆棘，吹动城门风轮', mark: ['city', 'gateWheel'] },
  to_ruins: { text: '出城，前往东南方的「风祭遗迹」', mark: ['wilds', 'bridge'] },
  cross_gorge: { text: '断桥无法通行……试着用风推倒岸边的古柱', mark: ['wilds', 'pillar'] },
  ruins_barrier: { text: '驱散笼罩遗迹入口的瘴雾', mark: ['wilds', 'barrier'] },
  ruins_pillars: { text: (f) => `唤醒遗迹中的三座风之塔柱（${pillarsDone(f)}/3）`, mark: ['wilds', 'nextPillar'] },
  take_crystal: { text: '取得祭坛上浮现的「风之结晶」', mark: ['wilds', 'altar'] },
  return_city: { text: '带着风之结晶返回天鸣城', mark: ['city', 'mikoTemple'] },
  temple: { text: '进入风之神殿，将结晶献于祭坛', mark: ['city', 'altar'] },
  undercroft: { text: '深入神殿地下的「风脉回廊」', mark: ['undercroft', 'next'] },
  core: { text: '同时转动三座风轮，启动「天鸣之心」', mark: ['undercroft', 'core'] },
  free: { text: '风已归来 · 自由探索天鸣城与苍风原野', mark: null },
};

export class Quest {
  constructor(game) {
    this.game = game;
    this._m = new THREE.Vector3();
  }
  get stage() { return this.game.state.stage; }

  set(stage, save = true) {
    const g = this.game;
    g.state.stage = stage;
    this.refresh(true);
    if (save && g.mode === 'play') g.saveGame();
  }

  refresh(flash = false) {
    const g = this.game;
    const s = STAGES[g.state.stage];
    if (!s) return;
    const text = typeof s.text === 'function' ? s.text(g.state.flags) : s.text;
    g.hud.setObjective(text, flash);
  }

  update() {
    // keep counters fresh
    const s = STAGES[this.game.state.stage];
    if (s && typeof s.text === 'function') this.refresh(false);
  }

  // world-space marker for the current zone (or the portal toward the target zone)
  markerWorld() {
    const g = this.game;
    const s = STAGES[g.state.stage];
    if (!s || !s.mark || !g.zone) return null;
    const [zid, name] = s.mark;
    const z = g.zone;
    if (zid === z.id) {
      const m = z.marks && (typeof z.marks[name] === 'function' ? z.marks[name]() : z.marks[name]);
      if (!m) return null;
      return this._m.copy(m).setY(m.y + 1.2);
    }
    const portal = z.portalTo && z.portalTo[zid];
    if (!portal) return null;
    return this._m.copy(portal).setY(portal.y + 1.5);
  }
}
