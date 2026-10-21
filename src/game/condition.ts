// 選手の状態：ケガ、出場できるか、試合前の状態（試合エンジンに渡す）。
// 要件定義書「ケガと疲労」「戦術の熟成度」に対応する。

import type { Rng } from '../engine/rng';
import type { MatchReadiness } from '../engine/types';
import { BALANCE, INJURY_TYPES } from './balance';
import type { Club, GameState, Injury, InjuryKind, PlayerRecord } from './types';

export function injuryName(injury: { kind: InjuryKind; part: string }): string {
  const type = INJURY_TYPES[injury.kind];
  return injury.part === '膝' && injury.kind === 'acl' ? type.label : `${injury.part}の${type.label}`;
}

/** 新しいケガを作る。復帰してすぐ（再発しやすい期間）なら、同じ部位を痛めやすい */
export function createInjury(rng: Rng, player: PlayerRecord, date: string, cause: 'contact' | 'training', carrying = false): Injury {
  const recurrence = player.status.recurrence ?? (player.status.injury ? { kind: player.status.injury.kind, part: player.status.injury.part } : null);
  let kind: InjuryKind;
  let part: string;
  let multiplier = 1;
  if (recurrence && (carrying || rng.chance(0.5))) {
    kind = recurrence.kind;
    part = recurrence.part;
    multiplier = carrying ? 1.5 : 1.3;
  } else {
    const kinds = Object.keys(INJURY_TYPES) as InjuryKind[];
    kind = rng.weighted(kinds, (k) => (cause === 'contact' ? INJURY_TYPES[k].contactWeight : INJURY_TYPES[k].trainingWeight));
    part = rng.pick(INJURY_TYPES[kind].parts);
  }
  const [lo, hi] = INJURY_TYPES[kind].days;
  // 軽いほうに寄せる（重いケガはまれ）
  const days = Math.max(1, Math.round((lo + (hi - lo) * rng.next() ** 1.2) * multiplier));
  return { kind, part, date, days, daysLeft: days };
}

/** 選手をケガさせる（今のケガより重いときだけ置き換える） */
export function applyInjury(player: PlayerRecord, injury: Injury): boolean {
  const current = player.status.injury;
  if (current && current.daysLeft >= injury.daysLeft) return false;
  player.status.injury = injury;
  player.status.recurrence = null;
  player.injuryHistory.unshift({ kind: injury.kind, part: injury.part, date: injury.date, days: injury.days });
  if (player.injuryHistory.length > 20) player.injuryHistory.length = 20;
  return true;
}

export const isInjured = (p: PlayerRecord): boolean => p.status.injury !== null;

/** 完治していないが、試合に出せる（再発しやすい） */
export const isCarryingInjury = (p: PlayerRecord): boolean =>
  p.status.injury !== null && p.status.injury.daysLeft <= BALANCE.playableInjuryDays;

/** 出場停止でなく、ケガで出られない状態でもない */
export const canPlay = (p: PlayerRecord): boolean =>
  p.discipline.suspendedMatches === 0 && (p.status.injury === null || isCarryingInjury(p));

/** チームの戦術の熟成度（0〜100）。フォーメーション6割、チーム指示4割 */
export function teamFamiliarity(club: Club): number {
  const formation = club.familiarity.formations[club.tactics.formation] ?? BALANCE.familiarityFloor;
  return 0.6 * formation + 0.4 * club.familiarity.instructions;
}

/** その選手の、試合での戦術の熟成度（0〜1）。新しく入った選手は低い */
export function playerFamiliarity(club: Club, player: PlayerRecord): number {
  return (teamFamiliarity(club) / 100) * (0.5 + 0.5 * (player.status.integration / 100));
}

export function readinessOf(club: Club, player: PlayerRecord): MatchReadiness {
  return {
    condition: player.status.condition,
    fatigue: player.status.fatigue,
    morale: player.status.morale,
    familiarity: playerFamiliarity(club, player),
    carryingInjury: player.status.injury !== null,
  };
}

export function clubReadiness(state: GameState, clubId: string): Record<string, MatchReadiness> {
  const club = state.clubs[clubId];
  const readiness: Record<string, MatchReadiness> = {};
  if (!club) return readiness;
  for (const id of club.playerIds) {
    const player = state.players[id];
    if (player) readiness[id] = readinessOf(club, player);
  }
  return readiness;
}

/** メンバーを自動で選ぶときの、状態による割り引き（1が万全） */
export function selectionFactor(p: PlayerRecord): number {
  const s = p.status;
  let factor = 0.7 + 0.3 * (s.condition / 100);
  if (s.fatigue > 60) factor *= 0.95;
  if (s.injury) factor *= 0.85;
  return factor;
}

export function moraleLabel(morale: number): string {
  if (morale >= 85) return '最高';
  if (morale >= 70) return '良い';
  if (morale >= 50) return '普通';
  if (morale >= 35) return '不満';
  return '最悪';
}

export function moraleTone(morale: number): 'good' | 'ok' | 'warn' | 'bad' {
  if (morale >= 70) return 'good';
  if (morale >= 50) return 'ok';
  if (morale >= 35) return 'warn';
  return 'bad';
}

export function adjustMorale(player: PlayerRecord, delta: number): void {
  player.status.morale = Math.max(0, Math.min(100, player.status.morale + delta));
}
