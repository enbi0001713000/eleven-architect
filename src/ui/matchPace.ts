// 観戦の速さ：試合は1手（パス、ドリブル、シュートなど1つのプレー）ずつ進め、手と手の間をどれだけ待つかをここで決める。
// 相手ゴールに近い場面はゆっくり、自陣でボールを回している場面は速く見せる。シュートやゴールの後は少し止める。

import type { LiveSnapshot } from '../engine/match';
import type { MatchEvent } from '../engine/types';
import type { MatchSpeed } from './settings';

/** 等倍で1手を見せる時間（ミリ秒）。2倍なら半分になる */
export const BASE_STEP_MS = 400;

export type Situation = 'buildUp' | 'midfield' | 'attack';

const SITUATION_FACTOR: Record<Situation, number> = { buildUp: 0.55, midfield: 0.8, attack: 1.25 };

/** ボールを持つ側から見て、自陣の後ろ（組み立て）、中盤、相手ゴールに近い場面（攻め）のどれか */
export function situationOf(snapshot: Pick<LiveSnapshot, 'ball'>): Situation {
  const { side, x } = snapshot.ball;
  const forward = side === 0 ? x : 6 - x;
  return forward >= 4 ? 'attack' : forward < 2.5 ? 'buildUp' : 'midfield';
}

/** その手で起きた出来事のあとに止める時間（ミリ秒） */
function pauseAfter(events: readonly MatchEvent[]): number {
  const types = new Set(events.map((e) => e.type));
  if (types.has('goal') || types.has('penaltyGoal')) return 2000;
  if (types.has('shotSaved') || types.has('shotOff') || types.has('shotBlocked') || types.has('penaltyMissed')) return 700;
  if (types.has('redCard') || types.has('penalty') || types.has('injury')) return 600;
  if (types.has('yellowCard') || types.has('corner') || types.has('freeKick') || types.has('offside')) return 250;
  return 0;
}

/**
 * 次の手までに待つ時間（ミリ秒）。速さを上げると、ボールの動きも時計も同じだけ速くなる。
 * 止める時間は速さほどには縮めない（4倍でも、ゴールの場面は見られるように）
 */
export function stepDelay(speed: MatchSpeed, snapshot: Pick<LiveSnapshot, 'ball'>, events: readonly MatchEvent[]): number {
  const move = (BASE_STEP_MS / speed) * SITUATION_FACTOR[situationOf(snapshot)];
  return Math.round(move + pauseAfter(events) / Math.sqrt(speed));
}

/** ピッチの選手とボールが次の位置へ動く時間（ミリ秒）。次の手より先に動き終わるようにする */
export const moveDuration = (delay: number): number => Math.round(Math.max(60, Math.min(650, delay * 0.85)));
