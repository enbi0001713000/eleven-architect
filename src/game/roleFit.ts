// 役割の向き不向き（◎○△）と、選手に一番向いている役割の選び方（要件定義書 フェーズ3.5「役割の名前とフォーメーション」）。
// 向き不向きは目安だけで、試合では能力値がそのまま効く。

import { POSITION_PROFILES } from '../data/generate';
import { FORMATIONS } from '../engine/formations';
import { positionWeights } from '../engine/ratings';
import { ROLE_OPTIONS, ROLE_PROFILES, slotDefaultRole } from '../engine/roles';
import type { AttributeKey, FormationName, Player, Position, Role } from '../engine/types';

export type RoleFit = 'good' | 'ok' | 'poor';

export const ROLE_FIT_MARK: Record<RoleFit, string> = { good: '◎', ok: '○', poor: '△' };
export const ROLE_FIT_TEXT: Record<RoleFit, string> = { good: '向いている', ok: 'ふつう', poor: '向いていない' };

/** ◎と△の境目（そのポジションのふつうの選手との差） */
const MARGIN = 0.6;

/** 大事な能力の平均と、そのポジションでの力（適性で割り引く前）の差 */
function rawScore(value: (key: AttributeKey) => number, role: Role, position: Position): number {
  const keys = ROLE_PROFILES[role].keys;
  const keyAverage = keys.reduce((sum, key) => sum + value(key), 0) / keys.length;
  let positionScore = 0;
  for (const [key, weight] of Object.entries(positionWeights(position)) as [AttributeKey, number][]) {
    positionScore += value(key) * weight;
  }
  return keyAverage - positionScore;
}

/** そのポジションのふつうの選手（能力の得意・不得意が平均どおり）の値。これより高いか低いかで向き不向きを見る */
const baselines = new Map<string, number>();
function baseline(role: Role, position: Position): number {
  const id = `${position}:${role}`;
  let value = baselines.get(id);
  if (value === undefined) {
    const profile = POSITION_PROFILES[position];
    value = rawScore((key) => profile[key] ?? 0, role, position);
    baselines.set(id, value);
  }
  return value;
}

/** 向き不向きの点数（0がそのポジションのふつうの選手） */
export function roleFitScore(player: Player, role: Role, position: Position): number {
  return rawScore((key) => player.attributes[key], role, position) - baseline(role, position);
}

export function roleFit(player: Player, role: Role, position: Position): RoleFit {
  // GKとフィールドの選手を入れ替えたときは、どの役割も向いていない
  if ((player.position === 'GK') !== (position === 'GK')) return 'poor';
  const score = roleFitScore(player, role, position);
  if (score >= MARGIN) return 'good';
  if (score <= -MARGIN) return 'poor';
  return 'ok';
}

/** その位置で、選手に一番向いている役割（同じくらいなら初期の役割） */
export function bestRole(player: Player, position: Position, fallback: Role = ROLE_OPTIONS[position][0] ?? 'boxToBox'): Role {
  let best = fallback;
  let bestScore = roleFitScore(player, fallback, position) + 0.3;
  for (const role of ROLE_OPTIONS[position]) {
    const score = roleFitScore(player, role, position);
    if (score > bestScore) {
      best = role;
      bestScore = score;
    }
  }
  return best;
}

/** 先発の並びに合わせて、全員を一番向いている役割にする */
export function bestRoles(formation: FormationName, lineup: readonly (Player | undefined)[]): Role[] {
  return FORMATIONS[formation].map((slot, i) => {
    const fallback = slotDefaultRole({ formation }, i, slot.position);
    const player = lineup[i];
    return player ? bestRole(player, slot.position, fallback) : fallback;
  });
}
