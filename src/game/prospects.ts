// 新人（高校生・大学生）の獲得（要件定義書 フェーズ4「新人の獲得（高校生・大学生）」、フェーズ4-C）。
//
// 6月1日   新人の候補が発表される（高校生と大学生。どのクラブにも属さない）
// 6〜10月  内定を出せる。AIクラブも内定を出す。候補は、最初の内定から21日後に、届いた内定の中からクラブを選ぶ
// 1月10日  内定した候補が加入する。足りない分は、強化部が今までどおり新人を獲って埋める。決まらなかった候補は去る

import { generatePlayer, playerName } from '../data/generate';
import { overallRating } from '../engine/ratings';
import { createRng, type Rng } from '../engine/rng';
import type { Position } from '../engine/types';
import { BALANCE } from './balance';
import { CONTRACT } from './contractBalance';
import { clauseFor, projectedSquad, salaryText, wageRoom } from './contracts';
import { addDays, daySeed, monthDay, yearOf } from './dates';
import { assignSquadRoles, defaultStatus, playerPhase2Fields } from './defaults';
import { potentialFor } from './development';
import { addMessage } from './inbox';
import { HOME_NATIONALITY, LEAGUE_RULES } from './rules';
import { PROSPECTS } from './scoutingBalance';
import type { GameState, PlayerRecord, ProspectOffer, ProspectSchool, SquadRole } from './types';
import { emptySeason, salaryFor, SIZE_PROFILE, SQUAD_TEMPLATE } from './world';

const roundTo = (n: number, unit: number): number => Math.round(n / unit) * unit;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function uniqueName(rng: Rng, names: Set<string>, name: string, nationality: string): string {
  let candidate = name;
  for (let tries = 0; names.has(candidate) && tries < 50; tries++) candidate = playerName(rng, nationality);
  names.add(candidate);
  return candidate;
}

/** 足りないポジション（理想の内訳と比べて、いちばん足りないところ） */
export function neededPosition(state: GameState, clubId: string): Position {
  const club = state.clubs[clubId];
  const counts = new Map<Position, number>();
  for (const id of club?.playerIds ?? []) {
    const p = state.players[id];
    if (p) counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
  }
  let best: Position = 'CM';
  let bestGap = -Infinity;
  for (const [position, ideal] of SQUAD_TEMPLATE) {
    const gap = (ideal - (counts.get(position) ?? 0)) / ideal;
    if (gap > bestGap) {
      best = position;
      bestGap = gap;
    }
  }
  return best;
}

export const SCHOOL_LABEL: Record<ProspectSchool, string> = { high: '高校', university: '大学' };

export function prospectPlayers(state: GameState): PlayerRecord[] {
  return (state.prospects ?? []).map((id) => state.players[id]).filter((p): p is PlayerRecord => !!p?.prospect);
}

// ---- 6月1日：候補の発表 ----

export function createProspects(state: GameState, rng: Rng): void {
  const year = yearOf(state.date);
  if (prospectPlayers(state).some((p) => p.prospect?.joinYear === year + 1)) return;
  const clubs = Object.values(state.clubs);
  const average = clubs.reduce((n, c) => n + c.level, 0) / Math.max(1, clubs.length);
  const names = new Set(Object.values(state.players).map((p) => p.name));
  const positions = SQUAD_TEMPLATE.flatMap(([position, count]) => Array.from({ length: count }, () => position));
  state.prospects ??= [];
  for (const school of ['high', 'university'] as ProspectSchool[]) {
    for (let i = 0; i < PROSPECTS.count[school]; i++) {
      const age = PROSPECTS.age[school];
      const base = generatePlayer(rng, rng.pick(positions), average + PROSPECTS.level[school] + rng.normal(0, PROSPECTS.spread), {
        id: `p${String(state.nextPlayerNumber++).padStart(4, '0')}`, age, nationality: HOME_NATIONALITY,
      });
      base.name = uniqueName(rng, names, base.name, base.nationality);
      base.hidden.potential = potentialFor(rng, overallRating(base), age + 1);
      state.players[base.id] = {
        ...base, clubId: null, squadNumber: null, contract: null, season: emptySeason(),
        discipline: { yellowAccumulation: 0, suspendedMatches: 0 }, ...playerPhase2Fields(),
        prospect: { school, joinYear: year + 1, offers: [], decideBy: null, signed: null },
      };
      state.prospects.push(base.id);
    }
  }
  addMessage(state, {
    category: 'scout', from: '強化部', important: true,
    subject: `${year + 1}年の新人の候補が発表されました`,
    body: `高校生${PROSPECTS.count.high}人と大学生${PROSPECTS.count.university}人が、来年プロになります。`
      + `\nスカウトの画面の「新人の候補」で調べて、内定を出せます（${Number(PROSPECTS.offersClose.slice(0, 2))}月${Number(PROSPECTS.offersClose.slice(3))}日まで）。`
      + '\n他クラブも内定を出します。候補は、クラブの評判、出番の見込み、条件を比べて選びます。'
      + '\n内定を出さなくても、足りない分は強化部が新人を獲って埋めます。',
  });
}

// ---- 内定 ----

export function offersOpen(date: string): boolean {
  const md = monthDay(date);
  return md >= PROSPECTS.announce && md <= PROSPECTS.offersClose;
}

/** 年俸の目安（総合力で決まる相場 × 約束する役割） */
export function standardSalary(state: GameState, player: PlayerRecord, clubId: string, role: SquadRole): number {
  const club = state.clubs[clubId];
  return roundTo(salaryFor(overallRating(player), SIZE_PROFILE[club?.size ?? 'medium'].salary) * PROSPECTS.roleSalary[role], 1e5);
}

export function offerFrom(player: PlayerRecord, clubId: string): ProspectOffer | undefined {
  return player.prospect?.offers.find((o) => o.clubId === clubId);
}

/** そのクラブが内定を出している（決まった選手も含む）候補 */
function offeredBy(state: GameState, clubId: string): PlayerRecord[] {
  return prospectPlayers(state).filter((p) => p.prospect!.signed ? p.prospect!.signed.clubId === clubId : !!offerFrom(p, clubId));
}

/** 内定を出せない理由（なければ null） */
export function offerProblem(state: GameState, playerId: string, role: SquadRole, salary: number): string | null {
  const myId = state.manager.clubId;
  const player = state.players[playerId];
  const prospect = player?.prospect;
  if (!myId || !state.clubs[myId]) return '監督をしているクラブがありません。';
  if (!player || !prospect) return '新人の候補ではありません。';
  if (!offersOpen(state.date)) return `内定を出せるのは、6月1日から${Number(PROSPECTS.offersClose.slice(0, 2))}月${Number(PROSPECTS.offersClose.slice(3))}日までです。`;
  if (prospect.signed) return `${state.clubs[prospect.signed.clubId]?.name ?? '他クラブ'}に決まりました。`;
  if (offerFrom(player, myId)) return 'すでに内定を出しています。';
  const mine = offeredBy(state, myId);
  if (mine.filter((p) => !p.prospect!.signed).length >= PROSPECTS.myOpenMax) return `返事を待っている内定は、${PROSPECTS.myOpenMax}人までです。`;
  if (projectedSquad(state, myId).length + mine.length >= LEAGUE_RULES.squadMax) return `来季の登録が上限（${LEAGUE_RULES.squadMax}人）を超えてしまいます。`;
  const least = Math.round(standardSalary(state, player, myId, 'youth') * 0.8);
  if (salary < least) return `年俸が安すぎます（${salaryText(least)}以上にしてください）。`;
  if (salary > wageRoom(state, myId)) return `年俸予算の残り（${salaryText(Math.max(0, wageRoom(state, myId)))}）に収まりません。`;
  return null;
}

function addOffer(state: GameState, player: PlayerRecord, offer: ProspectOffer): void {
  const prospect = player.prospect!;
  prospect.offers.push(offer);
  prospect.decideBy ??= addDays(state.date, PROSPECTS.decideDays);
}

/** 内定を出す */
export function makeOffer(state: GameState, playerId: string, role: SquadRole, salary: number): string {
  const problem = offerProblem(state, playerId, role, salary);
  const player = state.players[playerId];
  if (problem || !player?.prospect) return problem ?? '新人の候補ではありません。';
  addOffer(state, player, { clubId: state.manager.clubId, role, salary: roundTo(salary, 1e5), date: state.date });
  const by = player.prospect.decideBy!;
  return `${player.name}に内定を出しました。${Number(by.slice(5, 7))}月${Number(by.slice(8, 10))}日ごろに、どのクラブにするか決めます。`;
}

export function withdrawOffer(state: GameState, playerId: string): void {
  const prospect = state.players[playerId]?.prospect;
  if (!prospect || prospect.signed) return;
  prospect.offers = prospect.offers.filter((o) => o.clubId !== state.manager.clubId);
  if (prospect.offers.length === 0) prospect.decideBy = null;
}

/** 候補から見た、内定の魅力（クラブの評判、出番の見込み、約束する役割、年俸） */
export function offerAppeal(state: GameState, player: PlayerRecord, offer: ProspectOffer): number {
  const club = state.clubs[offer.clubId];
  const overall = overallRating(player);
  const stronger = (club?.playerIds ?? []).map((id) => state.players[id])
    .filter((p): p is PlayerRecord => p !== undefined && p.position === player.position && overallRating(p) >= overall + 1).length;
  const depth = Math.max(-1.5, 1 - 0.25 * stronger);
  const pay = clamp((offer.salary / standardSalary(state, player, offer.clubId, 'youth') - 1) * 2, -1, 2);
  return (club?.reputation ?? 50) / 25 + PROSPECTS.roleAppeal[offer.role] + depth + pay;
}

function decide(state: GameState, player: PlayerRecord, rng: Rng): void {
  const prospect = player.prospect!;
  prospect.decideBy = null;
  if (prospect.offers.length === 0) return;
  const scored = prospect.offers.map((o) => ({ o, score: offerAppeal(state, player, o) + rng.normal(0, 0.6) })).sort((a, b) => b.score - a.score);
  const best = scored[0]!.o;
  prospect.signed = best;
  const myId = state.manager.clubId;
  const mine = offerFrom(player, myId);
  if (!mine) return;
  const school = `${SCHOOL_LABEL[prospect.school]}${prospect.school === 'high' ? '3年' : '4年'}`;
  addMessage(state, {
    category: 'scout', from: '強化部', important: true, playerId: player.id,
    subject: best.clubId === myId ? `${player.name}が内定を受けました` : `${player.name}は${state.clubs[best.clubId]?.name ?? '他クラブ'}を選びました`,
    body: best.clubId === myId
      ? `${player.name}（${player.position}、${school}）が、うちの内定を受けてくれました。${prospect.joinYear}年1月10日に加入します。`
      : `${player.name}（${player.position}、${school}）は、${prospect.offers.length}つのクラブの内定の中から${state.clubs[best.clubId]?.name ?? '他クラブ'}を選びました。`,
  });
}

/** AIクラブが内定を出す（決まった日に、1クラブ1人ずつ） */
function aiOffers(state: GameState, rng: Rng): void {
  const myId = state.manager.clubId;
  const open = prospectPlayers(state).filter((p) => !p.prospect!.signed);
  for (const club of Object.values(state.clubs)) {
    if (club.id === myId) continue;
    const pending = offeredBy(state, club.id).length;
    if (pending >= PROSPECTS.aiMax || projectedSquad(state, club.id).length + pending >= LEAGUE_RULES.squadMax - 1) continue;
    if (!rng.chance(0.6)) continue;
    const need = neededPosition(state, club.id);
    const targets = open.filter((p) => !offerFrom(p, club.id) && p.hidden.potential >= club.level - 1.5)
      .map((p) => ({ p, score: p.hidden.potential + (p.position === need ? 0.8 : 0) + rng.normal(0, 0.8) }))
      .sort((a, b) => b.score - a.score);
    const pick = targets[0]?.p;
    if (!pick) continue;
    const role: SquadRole = pick.hidden.potential >= club.level + 1 ? 'backup' : 'youth';
    addOffer(state, pick, { clubId: club.id, role, salary: standardSalary(state, pick, club.id, role), date: state.date });
  }
}

/** 毎日：候補の発表、AIクラブの内定、候補の決定 */
export function prospectEvents(state: GameState): void {
  const md = monthDay(state.date);
  const rng = createRng(daySeed(state.seed, state.date, 'prospects'));
  if (md === PROSPECTS.announce) createProspects(state, rng);
  if (PROSPECTS.aiDays.includes(md)) aiOffers(state, rng);
  for (const p of prospectPlayers(state)) {
    if (!p.prospect!.signed && p.prospect!.decideBy && state.date >= p.prospect!.decideBy) decide(state, p, rng);
  }
}

// ---- 1月10日：新人の加入 ----

/** 内定した候補が加入し、足りない分は強化部が新人を獲って埋める。決まらなかった候補は去る */
export function newcomers(state: GameState, rng: Rng): void {
  const myId = state.manager.clubId;
  const year = state.season.year;
  const names = new Set(Object.values(state.players).map((p) => p.name));
  const signedBy = new Map<string, PlayerRecord[]>();
  for (const p of prospectPlayers(state)) {
    const clubId = p.prospect!.signed?.clubId;
    if (clubId) signedBy.set(clubId, [...(signedBy.get(clubId) ?? []), p]);
  }
  const fromOffers: PlayerRecord[] = [];
  const byStaff: PlayerRecord[] = [];
  const noRoom: PlayerRecord[] = [];
  for (const club of Object.values(state.clubs)) {
    const count = club.playerIds.length;
    // 毎年2〜3人。登録が少なければ埋める（登録の上限まで）。内定した候補の分は、強化部が獲る人数から引く
    const need = Math.min(LEAGUE_RULES.squadMax - count, Math.max(CONTRACT.newcomerMinSquad - count, rng.int(...CONTRACT.newcomers)));
    const numbers = new Set(club.playerIds.map((id) => state.players[id]?.squadNumber));
    const nextNumber = (): number => {
      let n = 2;
      while (numbers.has(n)) n++;
      numbers.add(n);
      return n;
    };
    let joined = 0;
    for (const p of signedBy.get(club.id) ?? []) {
      const offer = p.prospect!.signed!;
      if (club.playerIds.length >= LEAGUE_RULES.squadMax) {
        if (club.id === myId) noRoom.push(p);
        continue;
      }
      p.clubId = club.id;
      p.squadNumber = nextNumber();
      p.prospect = null;
      p.contract = { salary: offer.salary, endYear: year + PROSPECTS.years - 1, role: offer.role, releaseClause: null, bonus: null };
      p.contract.releaseClause = clauseFor(p, year, CONTRACT.defaultClause);
      p.status = defaultStatus(BALANCE.newcomerIntegration);
      club.playerIds.push(p.id);
      joined++;
      if (club.id === myId) fromOffers.push(p);
    }
    for (let i = joined; i < need; i++) {
      const position = neededPosition(state, club.id);
      const fromHighSchool = rng.chance(0.55);
      const age = fromHighSchool ? 18 : 22;
      const level = club.level - (fromHighSchool ? 3.6 : 2.8) + rng.normal(0, 0.6);
      const base = generatePlayer(rng, position, level, {
        id: `p${String(state.nextPlayerNumber++).padStart(4, '0')}`, age, nationality: HOME_NATIONALITY,
      });
      base.name = uniqueName(rng, names, base.name, base.nationality);
      base.hidden.potential = potentialFor(rng, overallRating(base), age);
      const record: PlayerRecord = {
        ...base,
        clubId: club.id,
        squadNumber: nextNumber(),
        contract: { salary: salaryFor(overallRating(base), SIZE_PROFILE[club.size].salary), endYear: year + 2, role: 'youth', releaseClause: null, bonus: null },
        season: emptySeason(),
        discipline: { yellowAccumulation: 0, suspendedMatches: 0 },
        ...playerPhase2Fields(),
        status: defaultStatus(BALANCE.newcomerIntegration),
      };
      record.contract!.releaseClause = clauseFor(record, year, CONTRACT.defaultClause);
      state.players[record.id] = record;
      club.playerIds.push(record.id);
      if (club.id === myId) byStaff.push(record);
    }
    if (club.id !== myId) assignSquadRoles(state, club.id);
  }
  // 決まらなかった候補は、ほかのリーグや社会人のチームへ（ゲームから去る）
  for (const p of prospectPlayers(state)) {
    delete state.players[p.id];
    delete state.scouting?.knowledge[p.id];
  }
  state.prospects = [];
  const line = (p: PlayerRecord): string => `${p.name}（${p.position}、${p.age}歳、総合力 ${overallRating(p).toFixed(1)}）`;
  addMessage(state, {
    category: 'club', from: '強化部', important: true,
    subject: '新人選手が加入しました',
    body: fromOffers.length + byStaff.length > 0
      ? [
        fromOffers.length > 0 ? `内定を出した選手：\n${fromOffers.map(line).join('\n')}` : '',
        byStaff.length > 0 ? `強化部が獲った選手：\n${byStaff.map(line).join('\n')}` : '',
        noRoom.length > 0 ? `登録の上限で入れなかった選手：${noRoom.map((p) => p.name).join('、')}` : '',
        '新しく入った選手は、まだ戦術に慣れていません。',
      ].filter((t) => t).join('\n\n')
      : '今年は新人の加入はありません（登録の上限に達しています）。',
  });
}
