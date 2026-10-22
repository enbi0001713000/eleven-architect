// 契約：市場価値、代理人、契約の更新の交渉、契約満了の選手の移籍（要件定義書 フェーズ4「選手の市場価値」「代理人」
// 「契約の条件」「契約の更新」、フェーズ4-A）。
//
// 7月1日〜11月30日 今年で契約が切れる自分の選手と、更新の交渉ができる
// 12月1日          締め切り。更新しなかった選手は契約満了。強化部に任せた選手と、AIクラブの選手は、決まりで更新するか決める
// 12月             契約満了の選手と、仮の契約ができる（1月1日に加入する）。AIクラブも獲る
// 1月1日           仮の契約をした選手が移り、決まらなかった選手は所属なしになる
// 1月1日〜3月27日  所属なしの選手を獲ると、すぐに加入する
// 3月28日          それでも決まらなかった選手は去る

import { overallRating } from '../engine/ratings';
import type { Rng } from '../engine/rng';
import type { Position } from '../engine/types';
import { BALANCE } from './balance';
import { AGENT_STYLES, CONTRACT, ROLE_RANK } from './contractBalance';
import { GIVEN_NAMES, SURNAMES } from '../data/names';
import { addDays, monthDay, yearOf } from './dates';
import { roleByRank } from './defaults';
import { renewalFactor, spend, yenText } from './finance';
import { addMessage } from './inbox';
import { knowledgeOf } from './knowledge';
import { SQUAD_ROLE_LABEL } from './morale';
import { LEAGUE_RULES } from './rules';
import { acceptedBid, onContractAgreed, recordTransfer } from './transfers';
import type { Agent, AgentStyle, Club, Contract, ContractBonus, GameState, PlayerRecord, SquadRole } from './types';
import { salaryFor, SIZE_PROFILE, SQUAD_TEMPLATE } from './world';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const roundTo = (v: number, unit: number): number => Math.round(v / unit) * unit;

// ---- 代理人 ----

/** 代理人を作る（世界ごとに決まる） */
export function createAgents(rng: Rng): Agent[] {
  const styles = Object.entries(AGENT_STYLES) as [AgentStyle, (typeof AGENT_STYLES)[AgentStyle]][];
  const used = new Set<string>();
  const agents: Agent[] = [];
  for (let i = 0; i < CONTRACT.agents; i++) {
    let name = `${rng.pick(SURNAMES)} ${rng.pick(GIVEN_NAMES)}`;
    for (let tries = 0; used.has(name) && tries < 20; tries++) name = `${rng.pick(SURNAMES)} ${rng.pick(GIVEN_NAMES)}`;
    used.add(name);
    // 割合に合わせて、穏やか・ふつう・強気を順に割り当てる
    let cut = (i + 0.5) / CONTRACT.agents;
    let style: AgentStyle = 'normal';
    for (const [key, profile] of styles) {
      if (cut < profile.share) {
        style = key;
        break;
      }
      cut -= profile.share;
    }
    agents.push({ id: `a${String(i + 1).padStart(2, '0')}`, name, style });
  }
  return agents;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 選手の代理人（選手ごとに決まっていて、変わらない） */
export function agentOf(state: GameState, player: PlayerRecord): Agent {
  const agents = state.agents ?? [];
  return agents[hash(player.id) % Math.max(1, agents.length)] ?? { id: 'a00', name: '代理人', style: 'normal' };
}

// ---- 市場価値 ----

function ageMultiple(age: number): number {
  for (const [upTo, multiple] of CONTRACT.ageMultiple) if (age <= upTo) return multiple;
  return 0.5;
}

/** 市場価値（円）。年俸の相場（ふつうのクラブでの額）× 年齢の倍率 × 伸びしろ × 契約の残り × 今季の活躍 */
export function marketValue(player: PlayerRecord, year: number): number {
  const overall = overallRating(player);
  let value = salaryFor(overall, 1) * ageMultiple(player.age);
  if (player.age <= CONTRACT.growthAge) {
    value *= clamp(1 + CONTRACT.growthPerPoint * Math.max(0, player.hidden.potential - overall), 1, CONTRACT.growthMax);
  }
  if (player.contract) {
    const left = player.contract.endYear - year;
    if (left <= 0) value *= CONTRACT.expiringFactor;
    else if (left === 1) value *= CONTRACT.twoYearsFactor;
  }
  const s = player.season;
  if (s.appearances >= CONTRACT.formApps && s.ratingCount > 0) {
    const rating = s.ratingTotal / s.ratingCount;
    if (rating >= CONTRACT.formHigh[0]) value *= CONTRACT.formHigh[1];
    else if (rating <= CONTRACT.formLow[0]) value *= CONTRACT.formLow[1];
  }
  return Math.max(100e4, roundTo(value, value >= 1e8 ? 1e7 : 1e6));
}

/** 画面に出す市場価値。他クラブの選手は、知識度が低いほど幅が広い */
export function marketValueRange(state: GameState, player: PlayerRecord): { low: number; high: number; exact: boolean } {
  const value = marketValue(player, state.season.year);
  const knowledge = knowledgeOf(state, player);
  if (knowledge >= 100) return { low: value, high: value, exact: true };
  const spread = (100 - knowledge) / 200;
  const unit = value >= 1e8 ? 1e7 : 1e6;
  return { low: Math.max(100e4, roundTo(value * (1 - spread), unit)), high: roundTo(value * (1 + spread), unit), exact: false };
}

/** 年俸を万円まで正確に（交渉の希望の額など）。例：1億1,400万円 */
export function salaryText(yen: number): string {
  const man = Math.round(yen / 1e4);
  const oku = Math.floor(man / 1e4);
  const rest = man % 1e4;
  if (oku === 0) return `${rest.toLocaleString('ja-JP')}万円`;
  return `${oku}億${rest > 0 ? `${rest.toLocaleString('ja-JP')}万` : ''}円`;
}

export function formatValueRange(range: { low: number; high: number; exact: boolean }): string {
  return range.exact ? yenText(range.low) : `${yenText(range.low)}〜${yenText(range.high)}`;
}

/** 違約金の額（市場価値の倍率から） */
export function clauseFor(player: PlayerRecord, year: number, multiple: number | null): number | null {
  return multiple === null ? null : roundTo(marketValue(player, year) * multiple, 1e6);
}

// ---- クラブの選手と、年俸の予算 ----

/** 来季もクラブにいる見込みの選手（契約満了・引退を除き、仮の契約で入る選手を足す） */
export function projectedSquad(state: GameState, clubId: string): PlayerRecord[] {
  const club = state.clubs[clubId];
  if (!club) return [];
  // レンタルで借りている選手は来季いない。貸している選手は戻ってくる（フェーズ4-B）
  const staying = club.playerIds.map((id) => state.players[id])
    .filter((p): p is PlayerRecord => p !== undefined && !p.leaving && !p.retiring && !p.retired && !p.loan);
  const others = Object.values(state.players).filter((p) => p.joining?.clubId === clubId || (p.loan?.fromClubId === clubId && !p.leaving && !p.retiring));
  return [...staying, ...others];
}

const salaryIn = (p: PlayerRecord, clubId: string): number => (p.joining?.clubId === clubId ? p.joining.contract.salary : p.contract?.salary ?? 0);

/** 年俸予算の残り（来季もいる見込みの選手の年俸を引いた額） */
export function wageRoom(state: GameState, clubId: string): number {
  const club = state.clubs[clubId];
  if (!club) return 0;
  const payroll = projectedSquad(state, clubId).reduce((n, p) => n + salaryIn(p, clubId), 0);
  return club.finance.budget.wages - payroll;
}

/** そのクラブで、選手がふさわしいと思う役割（来季の選手の中での序列から） */
export function deservedRole(state: GameState, player: PlayerRecord, clubId: string): SquadRole {
  const overall = overallRating(player);
  const better = projectedSquad(state, clubId).filter((p) => p.id !== player.id && overallRating(p) > overall).length;
  return roleByRank(better, player.age);
}

// ---- 選手の希望 ----

export type TalkKind = 'renewal' | 'signing';

/** 提示する条件（違約金は市場価値の倍率で選ぶ） */
export interface ContractOffer {
  salary: number;
  years: number;
  role: SquadRole;
  clauseMultiple: number | null;
  bonus: ContractBonus;
}

/** 出来高ボーナスを、選手が年俸と同じように数える額（1年分） */
export function bonusValue(player: PlayerRecord, role: SquadRole, bonus: ContractBonus | null): number {
  if (!bonus) return 0;
  const apps = CONTRACT.expectedApps[role];
  const goals = apps * (CONTRACT.goalRate[player.position] ?? 0);
  return CONTRACT.bonusShare * (apps * bonus.appearance + goals * bonus.goal);
}

export interface Ask {
  /** ボーナスなしで求める年俸 */
  salary: number;
  /** 断る理由（あれば、条件を変えないと合意しない） */
  refuse: string | null;
}

/** 選手（代理人）が求める年俸。提示の形（役割、年数、違約金）とクラブで変わる */
export function askingSalary(state: GameState, player: PlayerRecord, clubId: string, kind: TalkKind, offer: Pick<ContractOffer, 'role' | 'years' | 'clauseMultiple'>): Ask {
  const club = state.clubs[clubId];
  if (!club) return { salary: Infinity, refuse: 'クラブがありません' };
  const overall = overallRating(player);
  let ask = salaryFor(overall, SIZE_PROFILE[club.size].salary) * AGENT_STYLES[agentOf(state, player).style].demand;
  let refuse: string | null = null;

  const deserved = deservedRole(state, player, clubId);
  const down = ROLE_RANK[deserved] - ROLE_RANK[offer.role];
  if (down >= 2) refuse = `${SQUAD_ROLE_LABEL[deserved]}として約束してもらえないなら、話はできません。`;
  else if (down === 1) ask *= CONTRACT.roleOneDown;
  else if (down < 0) ask *= CONTRACT.roleUp;

  ask *= CONTRACT.clauseDemand.get(offer.clauseMultiple) ?? 1;

  const preferred = CONTRACT.preferredYears(player.age);
  if (player.age >= 30 && offer.years > preferred) ask *= 1 - CONTRACT.veteranLongDiscount * (offer.years - preferred);
  else ask *= 1 + CONTRACT.yearsPenalty * Math.abs(offer.years - preferred);

  const gap = CONTRACT.wantedReputation(overall) - club.reputation;
  if (gap > 0) {
    ask *= 1 + gap * CONTRACT.reputationPerPoint * (player.hidden.ambition / 10);
    if (gap > CONTRACT.refuseGap && player.hidden.ambition >= CONTRACT.refuseAmbition) refuse ??= 'もっと上のクラブで挑戦したいと考えています。';
  }

  if (kind === 'renewal' && player.contract) {
    ask *= 1 - (player.hidden.loyalty - 10) * CONTRACT.loyaltyPerPoint;
    if (player.status.morale < CONTRACT.lowMorale[0]) ask *= CONTRACT.lowMorale[1];
    ask = Math.max(ask, player.contract.salary * (player.age >= 30 ? CONTRACT.veteranCut : CONTRACT.renewalFloor));
  }
  return { salary: Math.max(CONTRACT.minSalary, roundTo(ask, 1e5)), refuse };
}

/** 提示した出来高ボーナスのもとで、合意に必要な年俸 */
export function neededSalary(state: GameState, player: PlayerRecord, clubId: string, kind: TalkKind, offer: ContractOffer): Ask {
  const ask = askingSalary(state, player, clubId, kind, offer);
  return { salary: Math.max(CONTRACT.minSalary, roundTo(ask.salary - bonusValue(player, offer.role, offer.bonus), 1e5)), refuse: ask.refuse };
}

// ---- 交渉 ----

export interface TalkCheck {
  ok: boolean;
  kind: TalkKind;
  reason: string;
}

const inRange = (md: string, from: string, to: string): boolean => md >= from && md <= to;

/** 自分のクラブが、この選手と契約の話ができるか */
export function talkStatus(state: GameState, playerId: string): TalkCheck {
  const myId = state.manager.clubId;
  const player = state.players[playerId];
  const no = (reason: string, kind: TalkKind = 'signing'): TalkCheck => ({ ok: false, kind, reason });
  if (!player || !myId) return no('今は契約の話ができません。');
  if (player.retiring || player.retired) return no('今シーズン限りで引退します。');
  const talk = state.contractTalks?.[playerId];
  const md = monthDay(state.date);
  const own = player.clubId === myId && !player.leaving;
  const kind: TalkKind = own ? 'renewal' : 'signing';
  if (talk?.closedUntil && state.date < talk.closedUntil) return no(`話し合いが決裂しました。${talk.closedUntil.slice(5).replace('-', '月')}日まで話せません。`, kind);
  if (own) {
    const end = player.contract?.endYear ?? 0;
    if (end > yearOf(state.date)) return no(`契約は${end}年まで残っています。更新の交渉は、契約が切れる年の7月1日からできます。`, kind);
    if (!inRange(md, CONTRACT.renewalOpens, CONTRACT.renewalCloses)) return no('更新の交渉は、7月1日から11月30日までです。', kind);
    return { ok: true, kind, reason: '' };
  }
  if (player.joining) return no(player.joining.clubId === myId ? 'すでに仮の契約をしています。1月1日に加入します。' : `${state.clubs[player.joining.clubId]?.name ?? '他クラブ'}と仮の契約をしています。`);
  if (player.leaving && player.clubId && md.startsWith('12-')) return { ok: true, kind, reason: '' };
  if ((state.freeAgents ?? []).includes(playerId) && md <= CONTRACT.freeAgencyEnds) return { ok: true, kind, reason: '' };
  if (player.clubId && acceptedBid(state, playerId, myId)) return { ok: true, kind, reason: '' };
  if (player.clubId && player.contract) return no('契約が残っている選手です。先にクラブと移籍の交渉（移籍金か違約金）をしてください。');
  return no('今は契約の話ができません。');
}

export type Verdict = 'accept' | 'counter' | 'refuse' | 'brokeOff' | 'invalid';

export interface OfferAnswer {
  verdict: Verdict;
  /** 代理人のセリフ */
  message: string;
  /** 代理人が求める年俸（返した場合） */
  ask: number | null;
}

/** 契約が始まる年（7月以降は来年から） */
export function contractStartYear(date: string): number {
  return Number(date.slice(5, 7)) >= 7 ? yearOf(date) + 1 : yearOf(date);
}

export function maxYears(player: PlayerRecord): number {
  return player.age >= CONTRACT.veteranAge ? CONTRACT.veteranMaxYears : CONTRACT.maxYears;
}

/** 提示の決まりごと（年俸予算、登録の上限、年数）。だめなら理由 */
export function offerProblem(state: GameState, player: PlayerRecord, kind: TalkKind, offer: ContractOffer): string | null {
  const myId = state.manager.clubId;
  if (offer.years < 1 || offer.years > maxYears(player)) return `契約年数は1〜${maxYears(player)}年で決めてください。`;
  if (offer.salary < CONTRACT.minSalary) return `年俸は${yenText(CONTRACT.minSalary)}以上にしてください。`;
  const current = kind === 'renewal' ? player.contract?.salary ?? 0 : 0;
  const room = wageRoom(state, myId);
  if (offer.salary > current && offer.salary - current > room) {
    return `年俸予算の残り（${yenText(Math.max(0, room))}）に収まりません。財務の画面で、オーナーに年俸予算を増やしてもらうこともできます。`;
  }
  if (kind === 'signing' && projectedSquad(state, myId).length >= LEAGUE_RULES.squadMax) return `登録できるのは${LEAGUE_RULES.squadMax}人までです。`;
  return null;
}

/** 自分のクラブから、選手（の代理人）に契約を提示する。その場で返事が来る */
export function offerContract(state: GameState, playerId: string, offer: ContractOffer): OfferAnswer {
  const player = state.players[playerId];
  const check = talkStatus(state, playerId);
  if (!player || !check.ok) return { verdict: 'invalid', message: check.reason, ask: null };
  const problem = offerProblem(state, player, check.kind, offer);
  if (problem) return { verdict: 'invalid', message: problem, ask: null };

  const myId = state.manager.clubId;
  const agent = agentOf(state, player);
  const profile = AGENT_STYLES[agent.style];
  state.contractTalks ??= {};
  const talk = state.contractTalks[playerId] ?? { rounds: 0, closedUntil: null, lastAsk: null };
  state.contractTalks[playerId] = talk;
  const needed = neededSalary(state, player, myId, check.kind, offer);

  if (!needed.refuse && offer.salary >= needed.salary * (1 - CONTRACT.tolerance)) {
    const contract: Contract = {
      salary: roundTo(offer.salary, 1e5),
      endYear: contractStartYear(state.date) + offer.years - 1,
      role: offer.role,
      releaseClause: clauseFor(player, state.season.year, offer.clauseMultiple),
      bonus: offer.bonus.appearance > 0 || offer.bonus.goal > 0 ? { ...offer.bonus } : null,
    };
    signContract(state, player, myId, contract, check.kind);
    delete state.contractTalks[playerId];
    return { verdict: 'accept', message: `${agent.name}（代理人）：この条件で合意します。よろしくお願いします。`, ask: null };
  }

  // 安すぎる提示は2回分と数える（最初の提示だけは1回分）
  talk.rounds += talk.rounds > 0 && offer.salary < needed.salary * CONTRACT.lowball ? 2 : 1;
  talk.lastAsk = needed.refuse ? null : needed.salary;
  if (talk.rounds >= profile.patience) {
    talk.rounds = 0;
    talk.closedUntil = addDays(state.date, CONTRACT.breakOffDays);
    if (player.clubId === myId) player.status.morale = clamp(player.status.morale - 5, 0, 100);
    return { verdict: 'brokeOff', message: `${agent.name}（代理人）：これ以上は話になりません。しばらく時間を置きましょう。`, ask: null };
  }
  if (needed.refuse) return { verdict: 'refuse', message: `${agent.name}（代理人）：${needed.refuse}`, ask: null };
  const left = profile.patience - talk.rounds;
  return {
    verdict: 'counter',
    message: `${agent.name}（代理人）：年俸${salaryText(needed.salary)}なら合意します。${left === 1 ? '次が最後の話し合いです。' : ''}`,
    ask: needed.salary,
  };
}

/** 新しい選手の背番号（空いている一番小さい番号。1はGK用に残す） */
function freeNumber(state: GameState, club: Club): number {
  const used = new Set(club.playerIds.map((id) => state.players[id]?.squadNumber));
  let n = 2;
  while (used.has(n)) n++;
  return n;
}

/** 選手をクラブに入れる（所属なしの選手を獲ったとき、仮の契約の選手が1月1日に移るとき） */
export function joinClub(state: GameState, player: PlayerRecord, clubId: string, contract: Contract): void {
  const club = state.clubs[clubId];
  if (!club) return;
  const from = player.clubId ? state.clubs[player.clubId] : undefined;
  recordTransfer(state, player, player.clubId, clubId, 0, 'free');
  if (from) from.playerIds = from.playerIds.filter((id) => id !== player.id);
  state.freeAgents = (state.freeAgents ?? []).filter((id) => id !== player.id);
  player.clubId = clubId;
  player.contract = contract;
  player.squadNumber = freeNumber(state, club);
  player.leaving = false;
  player.joining = null;
  player.listed = null;
  player.loan = null;
  player.status.integration = Math.min(player.status.integration, BALANCE.newcomerIntegration);
  player.status.morale = Math.max(player.status.morale, 65);
  club.playerIds.push(player.id);
  if (from?.selection) {
    from.selection = { lineup: from.selection.lineup.filter((id) => id !== player.id), bench: from.selection.bench.filter((id) => id !== player.id) };
  }
}

/** 合意した契約を結ぶ。代理人の手数料を払う */
function signContract(state: GameState, player: PlayerRecord, clubId: string, contract: Contract, kind: TalkKind): void {
  const club = state.clubs[clubId];
  if (!club) return;
  spend(club.finance, 'agentFees', contract.salary * AGENT_STYLES[agentOf(state, player).style].feeRate);
  if (kind === 'renewal') {
    player.contract = contract;
    player.status.morale = clamp(player.status.morale + 5, 0, 100);
    return;
  }
  // クラブ間で合意している移籍（フェーズ4-B）
  if (onContractAgreed(state, player, clubId, contract)) return;
  if (player.clubId && player.leaving) {
    player.joining = { clubId, contract, date: state.date };
    return;
  }
  joinClub(state, player, clubId, contract);
}

// ---- 強化部に任せる ----

/** 契約の更新を強化部に任せているか（主力とローテーションの選手は任せられない） */
export function isDelegated(state: GameState, player: PlayerRecord): boolean {
  const role = player.contract?.role;
  if (role === 'key' || role === 'rotation') return false;
  return state.contractDelegation?.[player.id] ?? true;
}

export function canDelegate(player: PlayerRecord): boolean {
  const role = player.contract?.role;
  return role === 'backup' || role === 'youth';
}

export function setDelegation(state: GameState, playerId: string, value: boolean): void {
  state.contractDelegation ??= {};
  state.contractDelegation[playerId] = value;
}

/** 今年で契約が切れる自分の選手 */
export function expiringPlayers(state: GameState): PlayerRecord[] {
  const club = state.clubs[state.manager.clubId];
  if (!club) return [];
  const year = yearOf(state.date);
  return club.playerIds.map((id) => state.players[id])
    .filter((p): p is PlayerRecord => p !== undefined && !!p.contract && p.contract.endYear <= year && !p.retiring)
    .sort((a, b) => overallRating(b) - overallRating(a));
}

// ---- 12月1日：締め切り ----

/** AIのクラブが契約を更新しない選手：序列が20番目より下の24歳以上と、15番目より下の30歳以上 */
const releases = (rank: number, age: number): boolean => (rank >= 20 && age >= 24) || (rank >= 15 && age >= 30);
/** 退団させても、この人数は残す */
const RELEASE_MIN_SQUAD = 24;

/** 契約の締め切り：自分で更新しなかった選手は契約満了。任せた選手とAIクラブの選手は、決まりで更新するか決める */
export function contractDeadline(state: GameState, rng: Rng): void {
  const myId = state.manager.clubId;
  const year = yearOf(state.date);
  const renewedByStaff: PlayerRecord[] = [];
  const releasedByStaff: PlayerRecord[] = [];
  const declined: PlayerRecord[] = [];
  const notRenewed: PlayerRecord[] = [];
  let myFactor = 1;
  for (const club of Object.values(state.clubs)) {
    const ranked = club.playerIds.map((id) => state.players[id]).filter((p): p is PlayerRecord => p !== undefined && !p.retiring)
      .sort((a, b) => overallRating(b) - overallRating(a));
    let remaining = ranked.length;
    const renewing: { player: PlayerRecord; rank: number }[] = [];
    ranked.forEach((player, rank) => {
      if (!player.contract || player.contract.endYear > year || player.leaving) return;
      const mine = club.id === myId;
      if (mine && !isDelegated(state, player)) {
        player.leaving = true;
        remaining--;
        notRenewed.push(player);
        return;
      }
      if (releases(rank, player.age) && remaining > RELEASE_MIN_SQUAD) {
        player.leaving = true;
        remaining--;
        if (mine) releasedByStaff.push(player);
        return;
      }
      // 選手のほうから断ることもある（出場機会や新しい挑戦を求める。格下のクラブなら野心のある選手は出ていく）
      const role = roleByRank(rank, player.age + 1);
      const refuse = askingSalary(state, player, club.id, 'renewal', { role, years: CONTRACT.preferredYears(player.age), clauseMultiple: CONTRACT.defaultClause }).refuse;
      if (refuse || rng.chance(CONTRACT.declineChance[player.contract.role])) {
        player.leaving = true;
        remaining--;
        if (mine) declined.push(player);
        return;
      }
      renewing.push({ player, rank });
    });
    const market = (p: PlayerRecord): number => salaryFor(overallRating(p), SIZE_PROFILE[club.size].salary);
    const continuing = ranked.filter((p) => p.contract && p.contract.endYear > year).reduce((n, p) => n + (p.contract?.salary ?? 0), 0);
    const factor = renewalFactor(club, continuing, renewing.reduce((n, r) => n + market(r.player), 0));
    for (const { player, rank } of renewing) {
      const salary = Math.max(CONTRACT.minSalary, roundTo(market(player) * factor, 1e5));
      player.contract = {
        salary,
        endYear: year + (player.age >= 31 ? 1 : rng.int(1, 3)),
        role: roleByRank(rank, player.age + 1),
        releaseClause: clauseFor(player, year + 1, CONTRACT.defaultClause),
        bonus: null,
      };
      spend(club.finance, 'agentFees', salary * AGENT_STYLES[agentOf(state, player).style].feeRate);
      if (club.id === myId) renewedByStaff.push(player);
    }
    if (club.id === myId) myFactor = factor;
  }
  const club = state.clubs[myId];
  if (!club) return;
  const names = (list: PlayerRecord[]) => list.map((p) => `${p.name}（${p.age}歳）`).join('、');
  addMessage(state, {
    category: 'transfer', from: '強化部', important: true,
    subject: '契約の締め切り：更新した選手と、契約満了の選手',
    body: [
      renewedByStaff.length > 0 ? `強化部が更新した選手：${names(renewedByStaff)}` : '',
      renewedByStaff.length > 0 && myFactor < 0.99 ? `年俸予算に収めるため、相場より${Math.round((1 - myFactor) * 100)}%低い年俸で更新しました。` : '',
      releasedByStaff.length > 0 ? `強化部が更新しなかった選手：${names(releasedByStaff)}` : '',
      declined.length > 0 ? `更新を断って退団する選手：${names(declined)}（出場機会や新しい挑戦を求めています）` : '',
      notRenewed.length > 0 ? `更新の交渉がまとまらなかった選手：${names(notRenewed)}` : '',
      renewedByStaff.length + releasedByStaff.length + declined.length + notRenewed.length === 0 ? '今年で契約が切れる選手はいませんでした。' : '',
      '',
      '契約満了の選手は、12月の間に他クラブと仮の契約ができ、1月1日に移ります。',
      '他クラブの契約満了の選手とも、移籍の画面から話ができます（移籍金はかかりません）。',
    ].filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== '')).join('\n').trim(),
  });
}

// ---- AIクラブが契約満了の選手を獲る ----

/** 今、獲れる契約満了の選手（12月は仮の契約の前の選手、1〜3月は所属なしの選手） */
export function marketPlayers(state: GameState): PlayerRecord[] {
  if (monthDay(state.date).startsWith('12-')) {
    return Object.values(state.players).filter((p) => p.leaving && p.clubId && !p.joining && !p.retiring);
  }
  if (monthDay(state.date) > CONTRACT.freeAgencyEnds) return [];
  return (state.freeAgents ?? []).map((id) => state.players[id]).filter((p): p is PlayerRecord => p !== undefined);
}

function positionCounts(players: PlayerRecord[]): Map<Position, PlayerRecord[]> {
  const map = new Map<Position, PlayerRecord[]>();
  for (const p of players) map.set(p.position, [...(map.get(p.position) ?? []), p]);
  return map;
}

/** AIクラブが、足りないポジションや強くなる選手を、契約満了の選手から獲る（1回に1クラブ1人まで） */
export function aiSigningRound(state: GameState, rng: Rng): void {
  const market = marketPlayers(state);
  if (market.length === 0) return;
  const myId = state.manager.clubId;
  const md = monthDay(state.date);
  const cap = md.startsWith('12-') || md < '01-10' ? CONTRACT.aiSquadBeforeNewcomers : CONTRACT.aiSquadAfterNewcomers;
  const clubs = Object.values(state.clubs).filter((c) => c.id !== myId);
  for (let i = clubs.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [clubs[i], clubs[j]] = [clubs[j] as Club, clubs[i] as Club];
  }
  for (const club of clubs) {
    const squad = projectedSquad(state, club.id);
    if (squad.length >= cap) continue;
    const byPosition = positionCounts(squad);
    const [minAge, maxAge] = CONTRACT.aiAgeRange[club.size] ?? [18, 32];
    const scored = market
      .filter((p) => !p.joining && p.clubId !== club.id && p.age >= minAge && p.age <= maxAge && overallRating(p) >= club.level - CONTRACT.aiMinBelowLevel)
      .map((p) => {
        const ideal = SQUAD_TEMPLATE.find(([pos]) => pos === p.position)?.[1] ?? 1;
        const here = (byPosition.get(p.position) ?? []).map(overallRating).sort((a, b) => b - a);
        const gap = ideal - here.length;
        const overall = overallRating(p);
        const upgrade = overall >= (here[1] ?? 0) + CONTRACT.aiUpgrade;
        return { p, ok: gap >= 1 || upgrade, score: overall + (gap >= 1 ? 1 : 0) - 0.1 * Math.max(0, p.age - 29) };
      })
      .filter((c) => c.ok)
      .sort((a, b) => b.score - a.score);
    // 評価の高い順に、断られず年俸予算に収まる選手を探す
    for (const { p } of scored) {
      const role = deservedRole(state, p, club.id);
      const years = Math.min(maxYears(p), CONTRACT.preferredYears(p.age));
      const ask = askingSalary(state, p, club.id, 'signing', { role, years, clauseMultiple: CONTRACT.defaultClause });
      if (ask.refuse || ask.salary > wageRoom(state, club.id)) continue;
      if (!rng.chance(CONTRACT.aiAcceptChance)) break;
      const from = p.clubId;
      signContract(state, p, club.id, {
        salary: ask.salary,
        endYear: contractStartYear(state.date) + years - 1,
        role,
        releaseClause: clauseFor(p, state.season.year, CONTRACT.defaultClause),
        bonus: null,
      }, 'signing');
      market.splice(market.indexOf(p), 1);
      if (from === myId) {
        addMessage(state, {
          category: 'transfer', from: '強化部', important: false, playerId: p.id,
          subject: `${p.name}が${club.name}と仮の契約`,
          body: `契約満了で退団する${p.name}が、${club.name}と仮の契約をしました。1月1日に移籍します。`,
        });
      }
      break;
    }
  }
}

// ---- 1月1日と3月28日 ----

/** 1月1日：仮の契約をした選手を移し、決まらなかった選手を所属なしにする */
export function completeExpiries(state: GameState): void {
  const myId = state.manager.clubId;
  const arrived: PlayerRecord[] = [];
  state.freeAgents ??= [];
  for (const player of Object.values(state.players)) {
    if (!player.leaving) continue;
    if (player.joining) {
      const { clubId, contract } = player.joining;
      joinClub(state, player, clubId, contract);
      if (clubId === myId) arrived.push(player);
      continue;
    }
    const club = player.clubId ? state.clubs[player.clubId] : undefined;
    if (club) {
      club.playerIds = club.playerIds.filter((id) => id !== player.id);
      if (club.selection) club.selection = { lineup: club.selection.lineup.filter((id) => id !== player.id), bench: club.selection.bench.filter((id) => id !== player.id) };
    }
    player.clubId = null;
    player.contract = null;
    player.squadNumber = null;
    player.leaving = false;
    state.freeAgents.push(player.id);
  }
  if (arrived.length > 0) {
    addMessage(state, {
      category: 'transfer', from: '強化部', important: true,
      subject: '仮の契約をした選手が加入しました',
      body: `${arrived.map((p) => `${p.name}（${p.position}、${p.age}歳）`).join('\n')}\n\n新しく入った選手は、まだ戦術に慣れていません。`,
    });
  }
}

/** 3月28日：所属が決まらなかった選手は去る */
export function closeFreeAgency(state: GameState): void {
  const left = (state.freeAgents ?? []).filter((id) => state.players[id]);
  for (const id of left) {
    delete state.players[id];
    delete state.contractTalks?.[id];
    delete state.contractDelegation?.[id];
  }
  state.freeAgents = [];
  if (left.length > 0) {
    addMessage(state, {
      category: 'league', from: 'リーグ事務局', important: false,
      subject: '冬の移籍期間が終わりました',
      body: `所属先が決まらなかった${left.length}人の選手は、引退するか、下部リーグや海外のクラブへ移りました。`,
    });
  }
}

// ---- 毎日 ----

function remindRenewals(state: GameState, opening: boolean): void {
  const players = expiringPlayers(state).filter((p) => !p.leaving && (opening || !isDelegated(state, p)));
  if (players.length === 0) return;
  const line = (p: PlayerRecord) => `${p.name}（${SQUAD_ROLE_LABEL[p.contract?.role ?? 'backup']}、${p.age}歳、年俸 ${yenText(p.contract?.salary ?? 0)}）${isDelegated(state, p) ? '：強化部に任せる' : ''}`;
  addMessage(state, {
    category: 'transfer', from: '強化部', important: true,
    subject: opening ? '契約の更新の交渉が始まりました' : '契約の更新の締め切りが近づいています',
    body: [
      opening ? `今年で契約が切れる選手は${players.length}人です。11月30日までに更新の交渉をしてください。` : '次の選手と、まだ契約を更新していません。11月30日までに更新しないと、契約満了で退団します。',
      '',
      ...players.map(line),
      '',
      opening ? '主力とローテーションの選手は、監督が自分で交渉します。控えと若手は、強化部に任せることもできます（移籍の画面）。' : '',
    ].join('\n').trim(),
  });
}

/** advanceDay が毎日呼ぶ：交渉の期間の知らせ、締め切り、AIクラブの獲得、契約満了の選手の移動 */
export function contractEvents(state: GameState, rng: Rng): void {
  const md = monthDay(state.date);
  const sameYear = yearOf(state.date) === state.season.year;
  if (md === CONTRACT.renewalOpens && state.manager.clubId) remindRenewals(state, true);
  if (md === CONTRACT.reminder && state.manager.clubId) remindRenewals(state, false);
  if (md === CONTRACT.deadline && sameYear) contractDeadline(state, rng);
  if (CONTRACT.aiSigningDays.includes(md)) aiSigningRound(state, rng);
  if (md === addDays(`2001-${CONTRACT.freeAgencyEnds}`, 1).slice(5)) closeFreeAgency(state);
}

/** 試合に出た選手に、出来高ボーナスを払う */
export function payBonus(club: Club, player: PlayerRecord, goals: number): void {
  const bonus = player.contract?.bonus;
  if (!bonus) return;
  const amount = bonus.appearance + bonus.goal * goals;
  if (amount > 0) spend(club.finance, 'wages', amount);
}
