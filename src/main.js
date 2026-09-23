// Entry point: boot engine, build the world with a loading screen, run the loop.
import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { setMaxAnisotropy, pregenTextures } from './gfx/textures.js';
import { Game } from './game/game.js';
import { buildWorld } from './world/index.js';
import { nextFrame } from './core/util.js';

const loading = document.getElementById('loading');
const bar = loading.querySelector('.bar i');
const msg = loading.querySelector('.msg');
const progress = (p, text) => { bar.style.width = Math.round(p * 100) + '%'; if (text) msg.textContent = text; };

function fail(err) {
  console.error(err);
  loading.style.opacity = 1;
  loading.innerHTML = `<div class="logo">风之符文</div><div class="err">游戏启动失败：${String(err && err.message ? err.message : err)}<br><br>请使用最新版 Chrome / Edge / Firefox 打开，并确认浏览器已开启硬件加速（WebGL2）。</div>`;
}

async function boot() {
  let engine;
  try {
    engine = new Engine(document.getElementById('app'));
  } catch (e) { fail(e); return; }
  setMaxAnisotropy(engine.maxAniso);
  const game = new Game(engine);
  window.__game = game;
  try {
    progress(0.04, '研磨颜料，绘制画卷……');
    await nextFrame();
    pregenTextures();
    await buildWorld(game, progress);
    progress(0.97, '点亮灯火……');
    await nextFrame();
    // warm up shaders for every zone
    for (const z of Object.values(game.zones)) {
      game.setZone(z.id);
      game.camera.position.set(0, 10, 30);
      game.camera.lookAt(0, 0, 0);
      engine.render(z.scene, game.camera, 0);
      await nextFrame();
    }
  } catch (e) { fail(e); return; }
  progress(1, '');
  loading.style.opacity = 0;
  setTimeout(() => { loading.style.display = 'none'; }, 800);
  let boot = null;
  try { boot = sessionStorage.getItem('wr_boot'); sessionStorage.removeItem('wr_boot'); } catch (e) { /* ignore */ }
  if (boot === 'new' || /[?&]play/.test(location.search)) game.startNew();
  else if (boot === 'continue') game.continueGame();
  else game.showTitle();

  // debug helper: advance the simulation manually (used when the tab is hidden)
  window.__step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) game.update(dt); game.render(dt); };

  let last = performance.now();
  const frame = () => {
    requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    try {
      game.update(dt);
      game.render(dt);
    } catch (e) {
      console.error(e);
    }
  };
  frame();
}

boot();
