// Builds all zones.
import { buildCity } from './city.js';
import { buildWilds } from './wilds.js';
import { buildUndercroft } from './undercroft.js';
import { nextFrame } from '../core/util.js';

export async function buildWorld(game, progress) {
  progress(0.1, '建造天鸣城的街巷与塔楼……');
  await nextFrame();
  game.zones.city = buildCity(game);
  progress(0.42, '铺展苍风原野，种下草木……');
  await nextFrame();
  game.zones.wilds = buildWilds(game);
  progress(0.78, '唤醒神殿地下的风脉回廊……');
  await nextFrame();
  game.zones.undercroft = buildUndercroft(game);
  progress(0.88, '绘制地图……');
  await nextFrame();
  for (const z of Object.values(game.zones)) z.buildMap(1024);
}
