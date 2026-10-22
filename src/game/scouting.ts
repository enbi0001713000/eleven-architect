// スカウト（要件定義書 フェーズ4「スカウト」「能力の見え方」、フェーズ4-C）。
// スカウトは、選手を指名して調べるか、条件（地域、ポジション、年齢）を付けて探す。
// 終わるとレポートが届き、その選手の知識度が上がる。知識度は下がらない。対戦した相手の選手も少しずつ分かってくる。

import { overallRating, positionWeights } from '../engine/ratings';
import { createRng } from '../engine/rng';
import type { AttributeKey, MatchResult } from '../engine/types';
import { marketValueRange } from './contracts';
import { addDays, daySeed } from './dates';
import { addMessage } from './inbox';
import { formatView, hash, knowledgeOf, potentialStars, viewAttribute, type AttributeView } from './knowledge';
import { SCOUT_REGIONS, SCOUTING } from './scoutingBalance';
import type { Fixture, GameState, PlayerRecord, ScoutAssignment, ScoutRegion, ScoutingState } from './types';
import type { Position } from '../engine/types';

export function emptyScouting(): ScoutingState {
  return { knowledge: {}, assignments: [], reports: [], found: [], nextAssignment: 1 };
}

const scouting = (state: GameState): ScoutingState => (state.scouting ??= emptyScouting());

/** 自分のクラブのスカウトの人数（規模で決まる。無職なら0） */
export function scoutCount(state: GameState): number {
  const club = state.clubs[state.manager.clubId];
  return club ? SCOUTING.scouts[club.size] : 0;
}

export const freeScouts = (state: GameState): number => Math.max(0, scoutCount(state) - scouting(state).assignments.length);

/** 知識度を上げる（下がることはない） */
export function raiseKnowledge(state: GameState, player: PlayerRecord, gain: number, cap = 100): void {
  const now = knowledgeOf(state, player);
  if (now >= cap) return;
  scouting(state).knowledge[player.id] = Math.min(cap, now + gain);
}

// ---- どこにいる選手か ----

export const inOverseasPool = (state: GameState, player: PlayerRecord): boolean => !player.clubId && (state.overseasPool ?? []).includes(player.id);

/** 選手のいる地域 */
export function regionOf(state: GameState, player: PlayerRecord): ScoutRegion {
  if (player.prospect) return 'students';
  if (inOverseasPool(state, player)) {
    const hit = (Object.keys(SCOUT_REGIONS) as ScoutRegion[]).find((r) => SCOUT_REGIONS[r].nationalities?.includes(player.nationality));
    return hit ?? 'europe';
  }
  return 'domestic';
}

const isOverseasRegion = (region: ScoutRegion): boolean => region !== 'domestic' && region !== 'students';

/** 画面に出してよい海外の選手か（スカウトが見つけた選手だけ） */
export function isFoundOverseas(state: GameState, player: PlayerRecord): boolean {
  return inOverseasPool(state, player) && scouting(state).found.includes(player.id);
}

// ---- 仕事を頼む ----

export interface SearchFilter {
  region: ScoutRegion;
  position: Position | null;
  maxAge: number | null;
}

/** 選手を調べられない理由（なければ null） */
export function scoutProblem(state: GameState, playerId: string): string | null {
  const player = state.players[playerId];
  if (!player) return '選手が見つかりません。';
  if (scoutCount(state) === 0) return '監督をしているクラブがないので、スカウトを送れません。';
  if (player.clubId === state.manager.clubId) return '自分のクラブの選手です。';
  if (knowledgeOf(state, player) >= 100) return 'もうすべて分かっています。';
  if (scouting(state).assignments.some((a) => a.playerId === playerId)) return 'この選手は、いまスカウトが調べています。';
  if (freeScouts(state) === 0) return '空いているスカウトがいません。今の仕事が終わるのを待ってください。';
  if (inOverseasPool(state, player) && !isFoundOverseas(state, player)) return 'まだ見つけていない海外の選手です。';
  return null;
}

/** 選手を指名して調べる */
export function scoutPlayer(state: GameState, playerId: string): string {
  const problem = scoutProblem(state, playerId);
  const player = state.players[playerId];
  if (problem || !player) return problem ?? '選手が見つかりません。';
  const days = isOverseasRegion(regionOf(state, player)) ? SCOUTING.playerDays.overseas : SCOUTING.playerDays.near;
  const s = scouting(state);
  const assignment: ScoutAssignment = {
    id: `s${s.nextAssignment++}`, kind: 'player', playerId, region: null, position: null, maxAge: null, start: state.date, due: addDays(state.date, days),
  };
  s.assignments.push(assignment);
  return `スカウトが${player.name}を調べに行きました。${days}日ほどでレポートが届きます。`;
}

/** 条件を付けて探せない理由（なければ null） */
export function searchProblem(state: GameState, filter: SearchFilter): string | null {
  if (scoutCount(state) === 0) return '監督をしているクラブがないので、スカウトを送れません。';
  if (freeScouts(state) === 0) return '空いているスカウトがいません。今の仕事が終わるのを待ってください。';
  if (filter.region === 'students' && (state.prospects ?? []).length === 0) return '今は新人の候補がいません（6月1日に発表されます）。';
  return null;
}

/** 条件を付けて探す */
export function startSearch(state: GameState, filter: SearchFilter): string {
  const problem = searchProblem(state, filter);
  if (problem) return problem;
  const days = isOverseasRegion(filter.region) ? SCOUTING.searchDays.overseas : SCOUTING.searchDays.near;
  const s = scouting(state);
  s.assignments.push({
    id: `s${s.nextAssignment++}`, kind: 'search', playerId: null, region: filter.region, position: filter.position, maxAge: filter.maxAge,
    start: state.date, due: addDays(state.date, days),
  });
  return `スカウトが${SCOUT_REGIONS[filter.region].label}へ選手を探しに行きました。${days}日ほどで報告が届きます。`;
}

export function cancelAssignment(state: GameState, id: string): void {
  const s = scouting(state);
  s.assignments = s.assignments.filter((a) => a.id !== id);
}

// ---- 仕事が終わる ----

/** 条件に合う選手（自分のクラブ以外。よく知っている選手は除く） */
function searchPool(state: GameState, filter: SearchFilter): PlayerRecord[] {
  const myId = state.manager.clubId;
  return Object.values(state.players).filter((p) => {
    if (p.retiring || p.retired || p.clubId === myId || p.loan?.fromClubId === myId) return false;
    if (filter.position && p.position !== filter.position) return false;
    if (filter.maxAge && p.age > filter.maxAge) return false;
    if (knowledgeOf(state, p) >= SCOUTING.potentialExact) return false;
    if (filter.region === 'students') return !!p.prospect && !p.prospect.signed;
    if (filter.region === 'domestic') return !p.prospect && (!!p.clubId || (state.freeAgents ?? []).includes(p.id));
    return inOverseasPool(state, p) && regionOf(state, p) === filter.region;
  });
}

/** スカウトの目で見た良さ（本当の総合力と、若い選手の伸びしろ。少しずれる） */
function scoutEye(player: PlayerRecord, noise: number): number {
  const overall = overallRating(player);
  const growth = player.age <= 23 ? Math.max(0, player.hidden.potential - overall) * 0.5 : 0;
  return overall + growth + noise;
}

function addReport(state: GameState, player: PlayerRecord): void {
  const s = scouting(state);
  s.reports = [{ playerId: player.id, date: state.date }, ...s.reports.filter((r) => r.playerId !== player.id)].slice(0, SCOUTING.keepReports);
  if (inOverseasPool(state, player) && !s.found.includes(player.id)) s.found.push(player.id);
}

function finish(state: GameState, a: ScoutAssignment): void {
  if (a.kind === 'player') {
    const player = a.playerId ? state.players[a.playerId] : undefined;
    if (!player) return;
    raiseKnowledge(state, player, SCOUTING.playerGain);
    addReport(state, player);
    const report = scoutReport(state, player);
    addMessage(state, {
      category: 'scout', from: 'スカウト', important: true, playerId: player.id,
      subject: `スカウトレポート：${player.name}`,
      body: `${player.name}（${player.position}、${player.age}歳）を調べました。\n${report.summary}\n選手の詳細の「スカウトレポート」で、くわしく見られます。`,
    });
    return;
  }
  const filter: SearchFilter = { region: a.region ?? 'domestic', position: a.position, maxAge: a.maxAge };
  const rng = createRng(daySeed(state.seed, state.date, `search-${a.id}`));
  const found = searchPool(state, filter)
    .map((p) => ({ p, eye: scoutEye(p, rng.normal(0, 0.8)) }))
    .sort((x, y) => y.eye - x.eye)
    .slice(0, SCOUTING.searchFinds)
    .map((x) => x.p);
  for (const p of found) {
    raiseKnowledge(state, p, SCOUTING.searchGain);
    addReport(state, p);
  }
  const what = [SCOUT_REGIONS[filter.region].label, filter.position ?? '', filter.maxAge ? `${filter.maxAge}歳以下` : ''].filter((t) => t).join('、');
  addMessage(state, {
    category: 'scout', from: 'スカウト', important: true,
    subject: found.length > 0 ? `スカウトの報告：${what}（${found.length}人）` : `スカウトの報告：${what}（見つからず）`,
    body: found.length > 0
      ? `条件に合う選手を${found.length}人見つけました。\n${found.map((p) => `・${p.name}（${p.position}、${p.age}歳）：${scoutReport(state, p).summary}`).join('\n')}\nスカウトの画面の「レポート」で、くわしく見られます。`
      : '条件に合う、まだ調べていない選手は見つかりませんでした。条件を変えて探してください。',
  });
}

/** 毎日：期限の来た仕事を終わらせる */
export function scoutingEvents(state: GameState): void {
  const s = scouting(state);
  const done = s.assignments.filter((a) => state.date >= a.due);
  if (done.length === 0) return;
  s.assignments = s.assignments.filter((a) => state.date < a.due);
  for (const a of done) finish(state, a);
}

/** 試合のあと：相手の出場した選手が少しずつ分かってくる */
export function learnFromMatch(state: GameState, fixture: Fixture, result: MatchResult): void {
  const myId = state.manager.clubId;
  if (fixture.homeId !== myId && fixture.awayId !== myId) return;
  for (const line of result.players) {
    const player = state.players[line.player.id];
    if (player && player.clubId !== myId) raiseKnowledge(state, player, SCOUTING.matchGain, SCOUTING.matchCap);
  }
}

/** 新しい年：いなくなった選手の記録を消す */
export function pruneScouting(state: GameState): void {
  const s = scouting(state);
  for (const id of Object.keys(s.knowledge)) if (!state.players[id]) delete s.knowledge[id];
  s.reports = s.reports.filter((r) => state.players[r.playerId]);
  s.found = s.found.filter((id) => state.players[id] && (state.overseasPool ?? []).includes(id));
  s.assignments = s.assignments.filter((a) => a.kind === 'search' || (a.playerId && state.players[a.playerId]));
}

// ---- レポートの中身 ----

export type Grade = 'A' | 'B' | 'C' | 'D';

export const GRADE_LABEL: Record<Grade, string> = {
  A: '強く勧める',
  B: '勧める',
  C: '状況しだい',
  D: '今は必要ない',
};

export interface ScoutView {
  knowledge: number;
  overall: AttributeView;
  /** 伸びしろ（星の数の目安。low〜high） */
  potential: [number, number];
  value: { low: number; high: number; exact: boolean };
  strengths: AttributeKey[];
  weaknesses: AttributeKey[];
  hints: string[];
  grade: Grade;
  /** 勧める理由 */
  reason: string;
  /** 1行のまとめ */
  summary: string;
}

/** 性格のほのめかし（隠れ能力は数字で見せない） */
function personalityHints(player: PlayerRecord): string[] {
  const h = player.hidden;
  const hints: [number, string][] = [];
  if (h.injuryProneness >= 14) hints.push([h.injuryProneness, 'ケガをしがちな傾向があります。']);
  if (h.professionalism >= 15) hints.push([h.professionalism, '練習に真剣に取り組む、プロ意識の高い選手です。']);
  if (h.professionalism <= 6) hints.push([21 - h.professionalism, '練習への取り組みに、ややむらがあります。']);
  if (h.ambition >= 15) hints.push([h.ambition, '野心があり、上のレベルを目指しています。']);
  if (h.loyalty >= 15) hints.push([h.loyalty, '今のクラブへの愛着が強い選手です。']);
  if (h.temperament <= 6) hints.push([21 - h.temperament, 'カッとなりやすく、カードをもらうことがあります。']);
  if (h.consistency <= 6) hints.push([21 - h.consistency, '調子の波が大きいタイプです。']);
  if (h.consistency >= 15) hints.push([h.consistency, '安定して力を出せます。']);
  if (h.bigMatch >= 15) hints.push([h.bigMatch, '大きな試合に強い選手です。']);
  if (h.pressure <= 6) hints.push([21 - h.pressure, 'プレッシャーのかかる場面で力を出し切れないことがあります。']);
  return hints.sort((a, b) => b[0] - a[0]).map(([, text]) => text);
}

/** 自分のクラブの、同じポジションの選手と比べた勧める度合い */
function gradeFor(state: GameState, player: PlayerRecord, overall: number, stars: number, knowledge: number): { grade: Grade; reason: string } {
  const myId = state.manager.clubId;
  const same = (state.clubs[myId]?.playerIds ?? []).map((id) => state.players[id])
    .filter((p): p is PlayerRecord => p !== undefined && p.position === player.position && !p.leaving && !p.retiring)
    .map(overallRating).sort((a, b) => b - a);
  if (!myId) return { grade: 'C', reason: '' };
  if (knowledge < SCOUTING.gradeFrom) return { grade: 'C', reason: 'まだよく分かりません。スカウトを送って調べてください。' };
  const young = player.age <= 21;
  if (overall >= (same[0] ?? 0) - 0.2) return { grade: 'A', reason: 'うちに来れば、すぐに主力になれます。' };
  if (overall >= (same[1] ?? 0) - 0.2) return { grade: 'B', reason: 'ローテーションに入れる力があります。' };
  if (young && stars >= 4) return { grade: 'B', reason: '今は力が足りませんが、将来の主力候補です。' };
  if (overall >= (same[2] ?? 0) || (young && stars >= 3)) return { grade: 'C', reason: '控えとしてなら、役に立ちます。' };
  return { grade: 'D', reason: '今のうちの選手より力が落ちます。' };
}

/** スカウトレポート（今の知識度で見える範囲で作る） */
export function scoutReport(state: GameState, player: PlayerRecord): ScoutView {
  const knowledge = knowledgeOf(state, player);
  const overallTrue = overallRating(player);
  const overall = viewAttribute(overallTrue, knowledge, `${player.id}:overall`);
  const stars = potentialStars(player);
  let potential: [number, number];
  if (knowledge >= SCOUTING.potentialExact) potential = [stars, stars];
  else if (knowledge >= SCOUTING.potentialNear) potential = hash(`${player.id}:stars`) % 2 === 0 ? [Math.max(1, stars - 1), stars] : [stars, Math.min(5, stars + 1)];
  else potential = [Math.max(1, stars - 1), Math.min(5, stars + 1)];
  const [, strong, weak, hintCount] = [...SCOUTING.traitsAt].reverse().find(([at]) => knowledge >= at) ?? [0, 1, 0, 0];
  const keys = (Object.keys(positionWeights(player.position)) as AttributeKey[]).sort((a, b) => player.attributes[b] - player.attributes[a]);
  const strengths = keys.slice(0, strong);
  const weaknesses = keys.slice(-weak).filter((k) => weak > 0 && !strengths.includes(k));
  const hints = personalityHints(player).slice(0, hintCount);
  const estimate = (overall.low + overall.high) / 2;
  const { grade, reason } = gradeFor(state, player, estimate, Math.round((potential[0] + potential[1]) / 2), knowledge);
  const starText = potential[0] === potential[1] ? `${'★'.repeat(potential[0])}` : `${'★'.repeat(potential[0])}〜${'★'.repeat(potential[1])}`;
  return {
    knowledge, overall, potential, value: marketValueRange(state, player), strengths, weaknesses, hints, grade, reason,
    summary: `総合力 ${formatView(overall)}、伸びしろ ${starText}。${GRADE_LABEL[grade]}（${reason}）`,
  };
}
