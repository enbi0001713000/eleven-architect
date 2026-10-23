// 観戦のドット絵で使う、選手の見た目（ユニフォームの色、GKのシャツ、肌と髪）とスタンドの設定を、試合ごとに作る。
// 肌と髪の色、髪型は顔のイラスト（Face.tsx の faceLook）と同じにする。

import type { Side } from '../engine/types';
import type { GameState } from '../game/types';
import { colorDistance, luminance, textOn } from './colors';
import { faceLook } from './components/Face';
import type { DotPlayerInfo, DotSceneOptions } from './dotScene';
import type { SpriteLook } from './sprites';

const GRASS = '#43963d';
const KEEPER_SHIRTS = ['#f2c500', '#2fbf71', '#e64980', '#222831', '#ff8c1a', '#7048e8'];

/** GKのシャツ：両チームのユニフォームと芝生から、いちばん離れた色 */
export function keeperShirt(kits: readonly string[], avoid: string[] = []): string {
  let best = KEEPER_SHIRTS[0] as string;
  let bestScore = -1;
  for (const color of KEEPER_SHIRTS) {
    if (avoid.includes(color)) continue;
    const score = Math.min(...[...kits, GRASS].map((k) => colorDistance(color, k)));
    if (score > bestScore) {
      best = color;
      bestScore = score;
    }
  }
  return best;
}

/** パンツの色：クラブの2番目の色がシャツと見分けられればそれ、だめなら白か紺 */
function shortsFor(shirt: string, secondary: string): string {
  if (colorDistance(shirt, secondary) > 120) return secondary;
  return luminance(shirt) > 0.5 ? '#1d2433' : '#f2f2f2';
}

export interface MatchLooks {
  options: DotSceneOptions;
  infoOf: (id: string) => DotPlayerInfo | undefined;
}

export function matchLooks(game: GameState, homeId: string, awayId: string, kits: [string, string], crowdFill: number, seed: number): MatchLooks {
  const home = game.clubs[homeId];
  const away = game.clubs[awayId];
  const colors: [[string, string], [string, string]] = [
    [home?.colors.primary ?? '#1559c2', home?.colors.secondary ?? '#ffffff'],
    [away?.colors.primary ?? '#d9480f', away?.colors.secondary ?? '#ffffff'],
  ];
  const homeKeeper = keeperShirt(kits);
  const awayKeeper = keeperShirt([...kits, homeKeeper], [homeKeeper]);
  const cache = new Map<string, DotPlayerInfo>();
  const infoOf = (id: string): DotPlayerInfo | undefined => {
    const hit = cache.get(id);
    if (hit) return hit;
    const player = game.players[id];
    if (!player) return undefined;
    const side: Side = player.clubId === awayId ? 1 : 0;
    const face = faceLook(player.id, player.nationality);
    const gray = player.age >= face.grayFrom;
    const keeper = player.position === 'GK';
    const shirt = keeper ? (side === 0 ? homeKeeper : awayKeeper) : kits[side];
    const look: SpriteLook = {
      shirt,
      shorts: keeper ? '#1d2433' : shortsFor(shirt, colors[side][1]),
      socks: shirt,
      numberColor: textOn(shirt),
      skin: face.skin,
      hair: gray ? (player.age >= face.grayFrom + 8 ? '#c9c9c9' : '#8d8d8d') : face.hair,
      hairShape: face.hairStyle,
      number: player.squadNumber ?? null,
      keeper,
    };
    const info: DotPlayerInfo = { side, name: player.name, look };
    cache.set(id, info);
    return info;
  };
  return {
    options: { crowdFill, homeColors: colors[0], awayColors: colors[1], seed },
    infoOf,
  };
}
