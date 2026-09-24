// Fullscreen toggle. The whole page goes fullscreen so the HUD and menus come along.

export function fullscreenAvailable() {
  const el = document.documentElement;
  return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled) && !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

export function toggleFullscreen() {
  try {
    if (isFullscreen()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) { const p = exit.call(document); if (p && p.catch) p.catch(() => {}); }
      return;
    }
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) { const p = req.call(el, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); }
  } catch (e) { /* refused (no user gesture, or an embedding frame without permission) */ }
}

export function onFullscreenChange(fn) {
  document.addEventListener('fullscreenchange', fn);
  document.addEventListener('webkitfullscreenchange', fn);
}
