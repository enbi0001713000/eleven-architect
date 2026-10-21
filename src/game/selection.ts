// 先発と控えの選び方（AIのクラブと「自動で選ぶ」ボタン）と、メンバーのルールのチェック。

import { FORMATIONS } from '../engine/formations';
import { overallRating, positionRating } from '../engine/ratings';
import type { FormationName, Position } from '../engine/types';
import { HOME_NATIONALITY, LEAGUE_RULES } from './rules';
import type { GameState, PlayerRecord } from './types';

export interface Selection {
  lineup: string[];
  bench: string[];
}

export const isForeign = (p: PlayerRecord): boolean => p.nationality !== HOME_NATIONALITY;
export const isAvailable = (p: PlayerRecord): boolean => p.discipline.suspendedMatches === 0;

export function clubPlayers(state: GameState, clubId: string): PlayerRecord[] {
  const club = state.clubs[clubId];
  if (!club) return [];
  return club.playerIds.map((id) => state.players[id]).filter((p): p is PlayerRecord => p !== undefined);
}

/** フォーメーションの枠に、試合に出られる選手を当てはめる（外国人枠も守る） */
export function autoSelect(state: GameState, clubId: string, formation: FormationName): Selection {
  const slots = FORMATIONS[formation];
  const available = clubPlayers(state, clubId).filter(isAvailable);
  const lineup: (string | null)[] = slots.map(() => null);
  const used = new Set<string>();
  let foreign = 0;

  // 全部の「枠×選手」の組み合わせを、そのポジションでの総合力が高い順に見て、空いていれば入れる
  const pairs = slots.flatMap((slot, i) => available.map((p) => ({ i, p, score: positionRating(p, slot.position) })))
    .sort((a, b) => b.score - a.score);
  for (const { i, p } of pairs) {
    if (lineup[i] !== null || used.has(p.id)) continue;
    if (isForeign(p) && foreign >= LEAGUE_RULES.foreignLimit) continue;
    lineup[i] = p.id;
    used.add(p.id);
    if (isForeign(p)) foreign++;
  }
  // 人数が足りないとき（出場停止が多いなど）は、残っている選手で埋める
  for (let i = 0; i < lineup.length; i++) {
    if (lineup[i] !== null) continue;
    const rest = available.find((p) => !used.has(p.id) && (!isForeign(p) || foreign < LEAGUE_RULES.foreignLimit));
    if (!rest) break;
    lineup[i] = rest.id;
    used.add(rest.id);
    if (isForeign(rest)) foreign++;
  }

  const bench = pickBench(available.filter((p) => !used.has(p.id)), LEAGUE_RULES.foreignLimit - foreign);
  return { lineup: lineup.filter((id): id is string => id !== null), bench };
}

/** 控えは、GK1人と、守備・中盤・前線を最低1人ずつ入れてから、総合力の高い順に埋める */
function pickBench(candidates: PlayerRecord[], foreignSlots: number): string[] {
  const bench: PlayerRecord[] = [];
  let foreignLeft = foreignSlots;
  const sorted = [...candidates].sort((a, b) => overallRating(b) - overallRating(a));
  const take = (match: (p: PlayerRecord) => boolean) => {
    const p = sorted.find((c) => !bench.includes(c) && match(c) && (!isForeign(c) || foreignLeft > 0));
    if (!p || bench.length >= LEAGUE_RULES.benchSize) return;
    bench.push(p);
    if (isForeign(p)) foreignLeft--;
  };
  const group = (positions: Position[]) => (p: PlayerRecord) => positions.includes(p.position);
  take(group(['GK']));
  take(group(['CB', 'SB']));
  take(group(['DM', 'CM', 'AM', 'WM']));
  take(group(['W', 'FW']));
  for (let i = 0; i < sorted.length && bench.length < LEAGUE_RULES.benchSize; i++) take((p) => p.position !== 'GK');
  return bench.map((p) => p.id);
}

/** メンバーがルールに合っているか。合っていなければ理由の一覧を返す。 */
export function validateSelection(state: GameState, clubId: string, formation: FormationName, selection: Selection): string[] {
  const errors: string[] = [];
  const club = state.clubs[clubId];
  if (!club) return ['クラブが見つかりません'];
  const slots = FORMATIONS[formation];
  const all = [...selection.lineup, ...selection.bench];
  if (selection.lineup.length !== slots.length) errors.push(`先発は${slots.length}人必要です（今は${selection.lineup.length}人）`);
  if (selection.bench.length > LEAGUE_RULES.benchSize) errors.push(`控えは${LEAGUE_RULES.benchSize}人までです`);
  if (new Set(all).size !== all.length) errors.push('同じ選手が2回入っています');
  const players = all.map((id) => state.players[id]);
  if (players.some((p) => !p || p.clubId !== clubId)) errors.push('自分のクラブにいない選手が入っています');
  const valid = players.filter((p): p is PlayerRecord => p !== undefined);
  const suspended = valid.filter((p) => !isAvailable(p));
  if (suspended.length > 0) errors.push(`出場停止の選手が入っています：${suspended.map((p) => p.name).join('、')}`);
  const foreign = valid.filter(isForeign).length;
  if (foreign > LEAGUE_RULES.foreignLimit) errors.push(`外国籍選手は${LEAGUE_RULES.foreignLimit}人までです（今は${foreign}人）`);
  return errors;
}

/** 新しいフォーメーションの枠に、今の先発11人を適性の高い順に並べ直す */
export function arrangeForFormation(state: GameState, ids: readonly string[], formation: FormationName): string[] {
  const slots = FORMATIONS[formation];
  const players = ids.map((id) => state.players[id]).filter((p): p is PlayerRecord => p !== undefined);
  const order: (string | null)[] = slots.map(() => null);
  const used = new Set<string>();
  const pairs = slots.flatMap((slot, i) => players.map((p) => ({ i, p, score: positionRating(p, slot.position) })))
    .sort((a, b) => b.score - a.score);
  for (const { i, p } of pairs) {
    if (order[i] !== null || used.has(p.id)) continue;
    order[i] = p.id;
    used.add(p.id);
  }
  const rest = players.filter((p) => !used.has(p.id)).map((p) => p.id);
  return order.map((id) => id ?? rest.shift() ?? '').filter((id) => id !== '');
}
