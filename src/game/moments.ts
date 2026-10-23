// 演出の予定：自分のクラブに選手が加入した、新人が入った、優勝が決まったときに積んでおき、画面が大きく見せる。
// 見せたら消す。古いセーブにはないので、ないときは空とみなす。

import { LEAGUE_RULES } from './rules';
import type { StandingRow } from './standings';
import type { GameState, Moment } from './types';

/** 見ないまま進めても、たまりすぎないようにする */
const KEEP = 12;

export function addMoment(state: GameState, moment: Moment): void {
  state.moments ??= [];
  state.moments.push(moment);
  if (state.moments.length > KEEP) state.moments.splice(0, state.moments.length - KEEP);
}

/** 一番前の演出を見終えた */
export function dismissMoment(state: GameState): void {
  state.moments?.shift();
}

/** 優勝が決まったか（残りの試合を2位がすべて勝っても届かない。最終節が終われば必ず決まる） */
export function titleDecided(table: readonly StandingRow[], roundsLeft: number): boolean {
  const [first, second] = table;
  if (!first) return false;
  if (roundsLeft <= 0) return true;
  return first.points > (second?.points ?? 0) + roundsLeft * LEAGUE_RULES.points.win;
}
