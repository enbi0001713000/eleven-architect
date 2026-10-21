// ポジションごとの総合力と、本来のポジション以外で使うときの適性。
// 要件定義書「選手データ」の「総合力はポジションごとに重みを付けて計算する」に対応する。

import type { AttributeKey, Player, Position } from './types';

const WEIGHTS: Record<Position, Partial<Record<AttributeKey, number>>> = {
  GK: { reflexes: 0.3, handling: 0.2, oneOnOne: 0.15, rushingOut: 0.1, positioning: 0.1, concentration: 0.1, jumping: 0.05 },
  CB: { tackling: 0.2, heading: 0.15, positioning: 0.2, strength: 0.1, jumping: 0.1, concentration: 0.1, pace: 0.1, passing: 0.05 },
  SB: { tackling: 0.15, positioning: 0.1, pace: 0.15, acceleration: 0.1, stamina: 0.1, crossing: 0.15, workRate: 0.1, passing: 0.1, dribbling: 0.05 },
  DM: { tackling: 0.2, positioning: 0.15, passing: 0.15, decisions: 0.1, workRate: 0.1, concentration: 0.1, stamina: 0.1, strength: 0.1 },
  CM: { passing: 0.2, vision: 0.1, decisions: 0.15, workRate: 0.1, stamina: 0.1, firstTouch: 0.1, tackling: 0.1, offTheBall: 0.05, shooting: 0.05, dribbling: 0.05 },
  AM: { passing: 0.15, vision: 0.2, firstTouch: 0.15, dribbling: 0.15, decisions: 0.1, offTheBall: 0.1, shooting: 0.15 },
  WM: { crossing: 0.15, stamina: 0.1, workRate: 0.1, pace: 0.15, dribbling: 0.1, passing: 0.15, acceleration: 0.1, tackling: 0.05, firstTouch: 0.1 },
  W: { pace: 0.15, acceleration: 0.15, dribbling: 0.2, crossing: 0.1, firstTouch: 0.1, offTheBall: 0.1, shooting: 0.1, decisions: 0.05, passing: 0.05 },
  FW: { shooting: 0.25, offTheBall: 0.2, composure: 0.15, firstTouch: 0.1, heading: 0.1, pace: 0.1, strength: 0.05, decisions: 0.05 },
};

/** 近いポジションどうし（適性 0.85〜0.95） */
const RELATED: [Position, Position, number][] = [
  ['CB', 'DM', 0.85], ['CB', 'SB', 0.85], ['SB', 'WM', 0.9], ['DM', 'CM', 0.95], ['CM', 'AM', 0.9],
  ['CM', 'WM', 0.85], ['WM', 'W', 0.95], ['AM', 'W', 0.85], ['AM', 'FW', 0.85], ['W', 'FW', 0.85],
];

/** 本来のポジションと違う場所で使うときの適性（1 が本来のポジション） */
export function positionFit(natural: Position, target: Position): number {
  if (natural === target) return 1;
  if (natural === 'GK' || target === 'GK') return 0.3;
  const pair = RELATED.find(([a, b]) => (a === natural && b === target) || (a === target && b === natural));
  return pair ? pair[2] : 0.7;
}

/** そのポジションでの総合力（1〜20）。本来のポジションでなければ適性の分だけ下がる。 */
export function positionRating(player: Player, position: Position): number {
  let total = 0;
  for (const [key, weight] of Object.entries(WEIGHTS[position]) as [AttributeKey, number][]) {
    total += player.attributes[key] * weight;
  }
  return Math.round(total * positionFit(player.position, position) * 10) / 10;
}

/** そのポジションの総合力に効く能力と、その重み */
export function positionWeights(position: Position): Partial<Record<AttributeKey, number>> {
  return WEIGHTS[position];
}

/** 本来のポジションでの総合力 */
export function overallRating(player: Player): number {
  return positionRating(player, player.position);
}
