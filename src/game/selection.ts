// 先発と控えの選び方（AIのクラブと「自動で選ぶ」ボタン）と、メンバーのルールのチェック。

import { FORMATIONS } from '../engine/formations';
import { overallRating, positionRating } from '../engine/ratings';
import type { FormationName, Position } from '../engine/types';
import { canPlay, isCarryingInjury, selectionFactor } from './condition';
import { HOME_NATIONALITY, LEAGUE_RULES } from './rules';
import type { GameState, PlayerRecord } from './types';

export interface Selection {
  lineup: string[];
  bench: string[];
}

export const isForeign = (p: PlayerRecord): boolean => p.nationality !== HOME_NATIONALITY;
/** 試合に出せる（出場停止でなく、ケガで出られない状態でもない） */
export const isAvailable = canPlay;

/** 出られない理由（出られるなら null） */
export function unavailableReason(p: PlayerRecord): string | null {
  if (p.discipline.suspendedMatches > 0) return '出場停止';
  if (p.status.injury && !isCarryingInjury(p)) return 'ケガ';
  return null;
}

export function clubPlayers(state: GameState, clubId: string): PlayerRecord[] {
  const club = state.clubs[clubId];
  if (!club) return [];
  return club.playerIds.map((id) => state.players[id]).filter((p): p is PlayerRecord => p !== undefined);
}

/** フォーメーションの枠に、試合に出られる選手を当てはめる（外国人枠も守る） */
export function autoSelect(state: GameState, clubId: string, formation: FormationName): Selection {
  const slots = FORMATIONS[formation];
  const playable = clubPlayers(state, clubId).filter(isAvailable);
  // 完治していない選手は、人数が足りないときだけ使う
  const healthy = playable.filter((p) => p.status.injury === null);
  const available = healthy.length >= slots.length + 5 ? healthy : playable;
  const lineup: (string | null)[] = slots.map(() => null);
  const used = new Set<string>();
  let foreign = 0;

  // 全部の「枠×選手」の組み合わせを、そのポジションでの力（コンディションで割り引く）が高い順に見て、空いていれば入れる
  const pairs = slots.flatMap((slot, i) => available.map((p) => ({ i, p, score: positionRating(p, slot.position) * selectionFactor(p) })))
    .sort((a, b) => b.score - a.score);
  for (const { i, p } of pairs) {
    if (lineup[i] !== null || used.has(p.id)) continue;
    if (isForeign(p) && foreign >= LEAGUE_RULES.foreignLimit) continue;
    lineup[i] = p.id;
    used.add(p.id);
    if (isForeign(p)) foreign++;
  }
  // 人数が足りないとき（出場停止やケガが多いなど）は、残っている選手で埋める。
  // それでも足りなければ、出場停止でない選手の中から、ケガの軽い順に無理をさせる
  const emergency = clubPlayers(state, clubId)
    .filter((p) => p.discipline.suspendedMatches === 0 && !available.includes(p))
    .sort((a, b) => (a.status.injury?.daysLeft ?? 0) - (b.status.injury?.daysLeft ?? 0));
  for (let i = 0; i < lineup.length; i++) {
    if (lineup[i] !== null) continue;
    const rest = [...available, ...emergency].find((p) => !used.has(p.id) && (!isForeign(p) || foreign < LEAGUE_RULES.foreignLimit));
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
  const suspended = valid.filter((p) => p.discipline.suspendedMatches > 0);
  if (suspended.length > 0) errors.push(`出場停止の選手が入っています：${suspended.map((p) => p.name).join('、')}`);
  const injured = valid.filter((p) => p.status.injury && !isCarryingInjury(p));
  if (injured.length > 0) errors.push(`ケガの選手が入っています：${injured.map((p) => p.name).join('、')}`);
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

/** ルール違反ではないが、気をつけたほうがよいこと（完治前の選手、コンディション、疲労） */
export function selectionWarnings(state: GameState, selection: Selection): string[] {
  const warnings: string[] = [];
  const players = selection.lineup.map((id) => state.players[id]).filter((p): p is PlayerRecord => p !== undefined);
  const carrying = [...players, ...selection.bench.map((id) => state.players[id])]
    .filter((p): p is PlayerRecord => p !== undefined && isCarryingInjury(p));
  if (carrying.length > 0) warnings.push(`完治していない選手がいます（再発しやすい）：${carrying.map((p) => p.name).join('、')}`);
  const tired = players.filter((p) => p.status.condition < 75);
  if (tired.length > 0) warnings.push(`コンディションが低い先発：${tired.map((p) => `${p.name}（${Math.round(p.status.condition)}%）`).join('、')}`);
  const fatigued = players.filter((p) => p.status.fatigue >= 70);
  if (fatigued.length > 0) warnings.push(`疲れがたまっている先発：${fatigued.map((p) => p.name).join('、')}`);
  return warnings;
}

/** 出られない選手だけを入れ替える（ほかの選手と並びはそのまま） */
export function repairSelection(state: GameState, clubId: string, formation: FormationName, selection: Selection): Selection {
  const slots = FORMATIONS[formation];
  const ok = (id: string) => {
    const p = state.players[id];
    return p !== undefined && p.clubId === clubId && isAvailable(p);
  };
  const lineup = slots.map((_, i) => {
    const id = selection.lineup[i];
    return id !== undefined && ok(id) ? id : null;
  });
  const bench = selection.bench.filter(ok);
  const foreignCount = () => [...lineup, ...bench].filter((id) => id && isForeign(state.players[id] as PlayerRecord)).length;
  for (let i = 0; i < lineup.length; i++) {
    if (lineup[i] !== null) continue;
    const slot = slots[i];
    if (!slot) continue;
    const used = new Set([...lineup, ...bench]);
    const candidates = clubPlayers(state, clubId)
      .filter((p) => !used.has(p.id) && isAvailable(p) && (!isForeign(p) || foreignCount() < LEAGUE_RULES.foreignLimit));
    // 控えから優先して上げる
    const fromBench = bench.map((id) => state.players[id]).filter((p): p is PlayerRecord => p !== undefined);
    const pool = [...fromBench, ...candidates];
    const best = pool.sort((a, b) => positionRating(b, slot.position) * selectionFactor(b) - positionRating(a, slot.position) * selectionFactor(a))[0];
    if (!best) continue;
    lineup[i] = best.id;
    const benchIndex = bench.indexOf(best.id);
    if (benchIndex >= 0) bench.splice(benchIndex, 1);
  }
  const filledLineup = lineup.filter((id): id is string => id !== null);
  const used = new Set([...filledLineup, ...bench]);
  const extra = pickBench(clubPlayers(state, clubId).filter((p) => !used.has(p.id) && isAvailable(p)),
    LEAGUE_RULES.foreignLimit - foreignCount());
  for (const id of extra) {
    if (bench.length >= LEAGUE_RULES.benchSize) break;
    bench.push(id);
  }
  return { lineup: filledLineup, bench };
}
