// 移籍：移籍金での移籍、違約金の支払い、レンタル、海外への移籍、AIクラブ同士の移籍（要件定義書 フェーズ4「移籍交渉」
// 「AIクラブの移籍」「海外への移籍」「レンタル移籍」、フェーズ4-B）。
//
// 移籍期間は冬（1月5日〜3月27日）と夏（7月15日〜8月15日）。期間の外で合意した移籍は、次の移籍期間の初日に成立する。
// 自分のクラブが関わる交渉は bids に残し、受信箱で返事をする。AIクラブ同士の移籍は、その場で決まる。
// レンタルは11月30日まで。12月1日（契約の締め切りの前）に元のクラブに戻る。

import { overallRating } from '../engine/ratings';
import type { Rng } from '../engine/rng';
import type { Position } from '../engine/types';
import { AGENT_STYLES, CONTRACT } from './contractBalance';
import { agentOf, askingSalary, clauseFor, contractStartYear, deservedRole, marketValue, maxYears, projectedSquad, salaryText, wageRoom } from './contracts';
import { addDays, monthDay, yearOf } from './dates';
import { earn, spend, yenText } from './finance';
import { addMessage } from './inbox';
import { LEAGUE_RULES, HOME_NATIONALITY } from './rules';
import { standingsOf } from './standings';
import { TRANSFER, type SizePolicy } from './transferBalance';
import type { BidKind, Club, Contract, GameState, PlayerRecord, TransferBid, TransferKind } from './types';
import { SQUAD_TEMPLATE } from './world';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const roundTo = (v: number, unit: number): number => Math.round(v / unit) * unit;
const feeRound = (v: number): number => Math.max(1e6, roundTo(v, v >= 1e8 ? 1e7 : 1e6));

export const OVERSEAS = 'overseas';

// ---- 移籍期間 ----

/** 今日が移籍期間の中か */
export function windowOpen(date: string): boolean {
  const md = monthDay(date);
  return TRANSFER.windows.some(([from, to]) => md >= from && md <= to);
}

/** 次の移籍期間の初日（今が期間の中なら今日） */
export function nextWindowStart(date: string): string {
  if (windowOpen(date)) return date;
  const year = yearOf(date);
  const md = monthDay(date);
  for (const [from] of TRANSFER.windows) if (md < from) return `${year}-${from}`;
  return `${year + 1}-${TRANSFER.windows[0]![0]}`;
}

export const isForeign = (p: PlayerRecord): boolean => p.nationality !== HOME_NATIONALITY;

export function transferBudgetLeft(club: Club): number {
  return club.finance.budget.transfers - club.finance.budget.transfersSpent;
}

const policyOf = (club: Club): SizePolicy => TRANSFER.policy[club.size];

/** AIクラブが今年使ってよい移籍金の残り */
function aiSpendable(club: Club): number {
  const b = club.finance.budget;
  return b.transfers * policyOf(club).spendShare - b.transfersSpent;
}

function playersOf(state: GameState, clubId: string): PlayerRecord[] {
  return (state.clubs[clubId]?.playerIds ?? []).map((id) => state.players[id]).filter((p): p is PlayerRecord => p !== undefined);
}

const idealCount = (position: Position): number => SQUAD_TEMPLATE.find(([pos]) => pos === position)?.[1] ?? 1;
const minimumCount = (position: Position): number => (position === 'GK' ? 2 : Math.ceil(idealCount(position) / 2));

// ---- 売る側の考え ----

export interface Asking {
  /** 売ってもよい額。null は今は売らない */
  fee: number | null;
  reason: string;
}

/** 夏（6〜8月）に優勝争いをしているクラブ（売る額が上がる） */
export function titleRaceClubs(state: GameState): Set<string> {
  const month = Number(state.date.slice(5, 7));
  if (month < 6 || month > 8) return new Set();
  return new Set(standingsOf(state).filter((r) => r.position <= TRANSFER.titleRace).map((r) => r.clubId));
}

/** 売る側のクラブが、この選手を売ってもよい額（市場価値 × 役割の倍率。主力は規模で決まる。夏に優勝争いをしていれば上がる） */
export function askingFee(state: GameState, player: PlayerRecord, sellerId: string, race: Set<string> = titleRaceClubs(state)): Asking {
  const club = state.clubs[sellerId];
  if (!club || !player.contract) return { fee: null, reason: '契約のない選手です。' };
  if (player.loan) return { fee: null, reason: 'レンタル中の選手は売れません。' };
  if (player.leaving) return { fee: null, reason: '契約満了で退団する選手です。12月からは、移籍金なしで話せます。' };
  const sameSpot = playersOf(state, sellerId).filter((p) => p.position === player.position && !p.leaving).length;
  if (sameSpot - 1 < minimumCount(player.position)) return { fee: null, reason: `${club.name}は、そのポジションの選手が足りないので手放しません。` };
  let multiple = player.listed === 'sale' ? TRANSFER.listed
    : player.contract.role === 'key' ? policyOf(club).sellKey : TRANSFER.sellRole[player.contract.role];
  if (race.has(sellerId)) multiple += TRANSFER.titleRacePremium;
  return { fee: feeRound(marketValue(player, state.season.year) * multiple), reason: '' };
}

/** 選手が移籍に応じるか（AIが決めるとき）。年俸の希望で断る条件があるか、格下のクラブなら応じにくい */
function playerWillMove(state: GameState, player: PlayerRecord, buyerId: string, rng: Rng): boolean {
  const buyer = state.clubs[buyerId];
  if (!buyer) return false;
  const role = deservedRole(state, player, buyerId);
  if (askingSalary(state, player, buyerId, 'signing', { role, years: CONTRACT.preferredYears(player.age), clauseMultiple: CONTRACT.defaultClause }).refuse) return false;
  const seller = player.clubId ? state.clubs[player.clubId] : undefined;
  if (seller && buyer.reputation < seller.reputation - 10) return rng.chance(0.35);
  return rng.chance(TRANSFER.aiPlayerAccept);
}

/** AIクラブが結ぶ契約（代理人の希望どおり）。断られたら null */
function aiContract(state: GameState, player: PlayerRecord, clubId: string): Contract | null {
  const role = deservedRole(state, player, clubId);
  const years = Math.min(maxYears(player), CONTRACT.preferredYears(player.age));
  const ask = askingSalary(state, player, clubId, 'signing', { role, years, clauseMultiple: CONTRACT.defaultClause });
  if (ask.refuse) return null;
  return {
    salary: ask.salary,
    endYear: contractStartYear(state.date) + years - 1,
    role,
    releaseClause: clauseFor(player, state.season.year, CONTRACT.defaultClause),
    bonus: null,
  };
}

// ---- 記録と知らせ ----

function record(state: GameState, player: PlayerRecord, fromClubId: string | null, toClubId: string | null, fee: number, kind: TransferKind): void {
  state.transferHistory ??= [];
  state.transferHistory.unshift({ date: state.date, playerId: player.id, playerName: player.name, fromClubId, toClubId, fee, kind });
  if (state.transferHistory.length > TRANSFER.keepHistory) state.transferHistory.length = TRANSFER.keepHistory;
}

const clubName = (state: GameState, id: string): string => (id === OVERSEAS ? '海外のクラブ' : state.clubs[id]?.name ?? '');

function notify(state: GameState, bid: TransferBid | null, subject: string, body: string, important: boolean, needsAnswer = false): void {
  addMessage(state, {
    category: 'transfer', from: '強化部', important, playerId: bid?.playerId,
    subject, body,
    ...(needsAnswer && bid ? { action: { kind: 'transferBid' as const, bidId: bid.id } } : {}),
  });
}

/** この交渉の、返事を待っている知らせを片付ける */
function resolveMessages(state: GameState, bidId: string): void {
  for (const m of state.inbox) if (m.action?.kind === 'transferBid' && m.action.bidId === bidId) m.resolved = true;
}

function newBid(state: GameState, fields: Omit<TransferBid, 'id' | 'date' | 'counter' | 'contract' | 'rounds' | 'note'>): TransferBid {
  state.bids ??= [];
  state.nextBidNumber ??= 1;
  const bid: TransferBid = { ...fields, id: `b${state.nextBidNumber++}`, date: state.date, counter: null, contract: null, rounds: 0, note: '' };
  state.bids.push(bid);
  return bid;
}

const OPEN: ReadonlySet<string> = new Set(['waiting', 'countered', 'accepted', 'agreed']);
export const isOpen = (bid: TransferBid): boolean => OPEN.has(bid.status);

export function openBidFor(state: GameState, playerId: string): TransferBid | undefined {
  return (state.bids ?? []).find((b) => b.playerId === playerId && isOpen(b));
}

/** 自分のクラブが、選手と契約の話をしてよい交渉（クラブ間で合意した） */
export function acceptedBid(state: GameState, playerId: string, buyerId: string): TransferBid | undefined {
  return (state.bids ?? []).find((b) => b.playerId === playerId && b.buyerId === buyerId && b.status === 'accepted' && (b.kind === 'transfer' || b.kind === 'clause'));
}

// ---- 移籍が成立する ----

function removeFromClub(state: GameState, player: PlayerRecord): void {
  const club = player.clubId ? state.clubs[player.clubId] : undefined;
  if (!club) return;
  club.playerIds = club.playerIds.filter((id) => id !== player.id);
  if (club.selection) club.selection = { lineup: club.selection.lineup.filter((id) => id !== player.id), bench: club.selection.bench.filter((id) => id !== player.id) };
}

function addToClub(state: GameState, player: PlayerRecord, clubId: string): void {
  const club = state.clubs[clubId];
  if (!club) return;
  const used = new Set(club.playerIds.map((id) => state.players[id]?.squadNumber));
  let n = 2;
  while (used.has(n)) n++;
  player.clubId = clubId;
  player.squadNumber = n;
  club.playerIds.push(player.id);
}

/** 移籍金を払い、受け取る。売った額の半分は、その年の移籍予算に足す */
function payFee(state: GameState, buyerId: string | null, sellerId: string | null, fee: number): void {
  if (fee <= 0) return;
  const buyer = buyerId ? state.clubs[buyerId] : undefined;
  const seller = sellerId ? state.clubs[sellerId] : undefined;
  if (buyer) {
    spend(buyer.finance, 'transfers', fee);
    buyer.finance.budget.transfersSpent += fee;
  }
  if (seller) {
    earn(seller.finance, 'transfers', fee);
    seller.finance.budget.transfers += Math.round(fee / 2);
    seller.finance.budget.total += Math.round(fee / 2);
  }
}

/** 選手を新しいクラブに移す（契約は新しいものに替える） */
function moveWithContract(state: GameState, player: PlayerRecord, toClubId: string, contract: Contract): void {
  removeFromClub(state, player);
  player.contract = contract;
  player.listed = null;
  player.loan = null;
  player.leaving = false;
  player.joining = null;
  player.status.integration = Math.min(player.status.integration, 30);
  player.status.morale = Math.max(player.status.morale, 65);
  addToClub(state, player, toClubId);
  delete state.contractTalks?.[player.id];
  delete state.contractDelegation?.[player.id];
}

export function startLoan(state: GameState, player: PlayerRecord, borrowerId: string, wageShare: number): void {
  const parent = player.clubId;
  if (!parent) return;
  removeFromClub(state, player);
  player.loan = { fromClubId: parent, until: `${yearOf(state.date)}-${TRANSFER.loanEnds}`, wageShare };
  player.listed = null;
  player.status.integration = Math.min(player.status.integration, 30);
  addToClub(state, player, borrowerId);
  record(state, player, parent, borrowerId, 0, 'loan');
}

/** 交渉がすべてまとまった移籍を成立させる（移籍期間の中で） */
function complete(state: GameState, bid: TransferBid): void {
  const player = state.players[bid.playerId];
  const myId = state.manager.clubId;
  if (!player || player.clubId !== bid.sellerId || player.retiring) {
    bid.status = 'failed';
    bid.note = '選手の状況が変わったため、移籍は成立しませんでした。';
    resolveMessages(state, bid.id);
    return;
  }
  bid.status = 'done';
  resolveMessages(state, bid.id);
  if (bid.kind === 'loan') {
    startLoan(state, player, bid.buyerId, bid.wageShare);
    if (bid.buyerId === myId || bid.sellerId === myId) {
      notify(state, bid, `${player.name}のレンタルが始まりました`,
        `${player.name}が、${clubName(state, bid.sellerId)}から${clubName(state, bid.buyerId)}へレンタルで移りました（${TRANSFER.loanEnds.replace('-', '月')}日まで）。年俸は借りたクラブが${Math.round(bid.wageShare * 100)}%を払います。`, true);
    }
    return;
  }
  if (bid.buyerId === OVERSEAS) {
    payFee(state, null, bid.sellerId, bid.fee);
    removeFromClub(state, player);
    record(state, player, bid.sellerId, null, bid.fee, 'abroad');
    if (bid.sellerId === myId) {
      notify(state, bid, `${player.name}が海外のクラブへ移籍しました`, `${player.name}が海外のクラブへ移籍しました。移籍金${yenText(bid.fee)}が入りました（半分は今年の移籍予算に足されます）。`, true);
    }
    delete state.players[player.id];
    return;
  }
  const contract = bid.contract;
  if (!contract) {
    bid.status = 'failed';
    return;
  }
  payFee(state, bid.buyerId, bid.sellerId, bid.fee);
  moveWithContract(state, player, bid.buyerId, contract);
  record(state, player, bid.sellerId, bid.buyerId, bid.fee, 'transfer');
  if (bid.buyerId === myId) {
    notify(state, bid, `${player.name}が加入しました`, `${player.name}が${clubName(state, bid.sellerId)}から加入しました（移籍金${yenText(bid.fee)}）。新しく入った選手は、まだ戦術に慣れていません。`, true);
  } else if (bid.sellerId === myId) {
    notify(state, bid, `${player.name}が${clubName(state, bid.buyerId)}へ移籍しました`, `移籍金${yenText(bid.fee)}が入りました。半分は今年の移籍予算に足されます。`, true);
  }
}

/** クラブ間と選手の合意がそろった。移籍期間なら成立、期間の外なら次の期間の初日に成立 */
function settle(state: GameState, bid: TransferBid): void {
  if (windowOpen(state.date)) {
    complete(state, bid);
    return;
  }
  bid.status = 'agreed';
  resolveMessages(state, bid.id);
  const player = state.players[bid.playerId];
  const myId = state.manager.clubId;
  if (player && (bid.buyerId === myId || bid.sellerId === myId)) {
    const start = nextWindowStart(state.date);
    notify(state, bid, `${player.name}の移籍がまとまりました`,
      `${player.name}の${clubName(state, bid.buyerId)}への${bid.kind === 'loan' ? 'レンタル' : '移籍'}がまとまりました。移籍期間に入る${Number(start.slice(5, 7))}月${Number(start.slice(8, 10))}日に成立します。`, true);
  }
}

/** contracts.ts が、選手との契約がまとまったときに呼ぶ（クラブ間で合意している移籍なら true） */
export function onContractAgreed(state: GameState, player: PlayerRecord, buyerId: string, contract: Contract): boolean {
  const bid = acceptedBid(state, player.id, buyerId);
  if (!bid) return false;
  bid.contract = contract;
  settle(state, bid);
  return true;
}

// ---- 自分のクラブが獲りに行く ----

export interface BidRequest {
  kind: 'transfer' | 'clause' | 'loan';
  fee: number;
  wageShare: number;
}

/** レンタルに出してもらえそうな選手か */
export function loanable(player: PlayerRecord): boolean {
  return player.listed === 'loan' || (player.age <= 23 && (player.contract?.role === 'backup' || player.contract?.role === 'youth'));
}

/** 申し込めない理由（なければ null） */
export function bidProblem(state: GameState, playerId: string, req: BidRequest): string | null {
  const myId = state.manager.clubId;
  const club = state.clubs[myId];
  const player = state.players[playerId];
  if (!club || !player) return '今は申し込めません。';
  if (!player.clubId || player.clubId === myId) return '他クラブの選手ではありません。';
  if (player.retiring) return '今シーズン限りで引退します。';
  if (player.leaving) return '契約満了で退団する選手です。12月からは、契約満了の選手として移籍金なしで話せます。';
  if (player.loan) return 'レンタル中の選手です。';
  if (openBidFor(state, playerId)) return 'この選手とは、すでに交渉が進んでいます。';
  if (projectedSquad(state, myId).length >= LEAGUE_RULES.squadMax) return `登録できるのは${LEAGUE_RULES.squadMax}人までです。`;
  const left = transferBudgetLeft(club);
  if (req.kind === 'loan') {
    if (!loanable(player)) return '主力やローテーションの選手は、レンタルに出してもらえません（23歳以下の控えか若手、またはレンタルのリストに載っている選手）。';
    return null;
  }
  const fee = req.kind === 'clause' ? player.contract?.releaseClause ?? null : req.fee;
  if (fee === null) return 'この選手には違約金がありません。';
  if (fee <= 0) return '移籍金を決めてください。';
  if (fee > left) return `移籍予算の残り（${yenText(Math.max(0, left))}）に収まりません。財務の画面で、年俸予算から移籍予算に回すこともできます。`;
  return null;
}

/** 他クラブに移籍金（違約金、レンタル）を申し込む */
export function placeBid(state: GameState, playerId: string, req: BidRequest): { ok: boolean; message: string; bid?: TransferBid } {
  const problem = bidProblem(state, playerId, req);
  const player = state.players[playerId];
  if (problem || !player?.clubId) return { ok: false, message: problem ?? '今は申し込めません。' };
  const myId = state.manager.clubId;
  if (req.kind === 'clause') {
    const fee = player.contract?.releaseClause ?? 0;
    const bid = newBid(state, { kind: 'clause', playerId, sellerId: player.clubId, buyerId: myId, fee, wageShare: 1, status: 'accepted', due: addDays(state.date, TRANSFER.contractDays) });
    return { ok: true, bid, message: `違約金${yenText(fee)}を払うので、${clubName(state, player.clubId)}は断れません。${TRANSFER.contractDays}日以内に、選手と契約の話をしてください。` };
  }
  const bid = newBid(state, {
    kind: req.kind, playerId, sellerId: player.clubId, buyerId: myId,
    fee: req.kind === 'loan' ? 0 : roundTo(req.fee, 1e5), wageShare: req.kind === 'loan' ? req.wageShare : 1,
    status: 'waiting', due: addDays(state.date, TRANSFER.answerDays[0] + (Number(playerId.replace(/\D/g, '')) % (TRANSFER.answerDays[1] - TRANSFER.answerDays[0] + 1))),
  });
  return { ok: true, bid, message: `${clubName(state, player.clubId)}に申し込みました。${Number(bid.due.slice(5, 7))}月${Number(bid.due.slice(8, 10))}日ごろに返事が届きます。` };
}

/** 売る側（AIクラブ）が、自分のクラブの申し込みに返事をする */
function answerMyBid(state: GameState, bid: TransferBid, rng: Rng): void {
  const player = state.players[bid.playerId];
  if (!player || player.clubId !== bid.sellerId) {
    bid.status = 'failed';
    bid.note = '選手がすでにクラブを離れていました。';
    notify(state, bid, '移籍の申し込みが流れました', bid.note, false);
    return;
  }
  const seller = clubName(state, bid.sellerId);
  if (bid.kind === 'loan') {
    const ok = loanable(player) && (player.listed === 'loan' || rng.chance(bid.wageShare >= 1 ? 0.6 : 0.3));
    if (!ok) {
      bid.status = 'rejected';
      bid.note = `${seller}は、${player.name}を今はレンタルに出さないそうです。`;
      notify(state, bid, `${player.name}のレンタル：断られました`, bid.note, true);
      return;
    }
    notify(state, bid, `${player.name}のレンタル：受けてもらえました`, `${seller}が、${player.name}のレンタルを受けてくれました。`, true);
    settle(state, bid);
    return;
  }
  const ask = askingFee(state, player, bid.sellerId);
  if (ask.fee === null) {
    bid.status = 'rejected';
    bid.note = ask.reason;
    notify(state, bid, `${player.name}の獲得：断られました`, `${seller}：${ask.reason}`, true);
    return;
  }
  if (bid.fee >= ask.fee) {
    bid.status = 'accepted';
    bid.due = addDays(state.date, TRANSFER.contractDays);
    notify(state, bid, `${player.name}の獲得：受けてもらえました`,
      `${seller}が、移籍金${yenText(bid.fee)}で${player.name}を手放すことに合意しました。${TRANSFER.contractDays}日以内に、選手と契約の話をしてください（移籍の画面の「交渉」から）。`, true, true);
    return;
  }
  if (bid.fee >= ask.fee * TRANSFER.counterFloor && bid.rounds < TRANSFER.maxRounds) {
    bid.status = 'countered';
    bid.counter = ask.fee;
    bid.rounds++;
    bid.due = addDays(state.date, TRANSFER.decideDays);
    notify(state, bid, `${player.name}の獲得：額を返してきました`,
      `${seller}：移籍金${salaryText(ask.fee)}なら手放します。\n${TRANSFER.decideDays}日以内に、この額で出すか、あきらめるかを決めてください。`, true, true);
    return;
  }
  bid.status = 'rejected';
  bid.note = 'もっと高い額でないと、話になりません。';
  notify(state, bid, `${player.name}の獲得：断られました`, `${seller}：${bid.note}`, true);
}

/** 売る側が返した額で出す（その場で合意） */
export function acceptCounter(state: GameState, bidId: string): string | null {
  const bid = state.bids?.find((b) => b.id === bidId);
  const club = state.clubs[state.manager.clubId];
  if (!bid || bid.status !== 'countered' || bid.counter === null || !club) return 'この交渉は終わっています。';
  if (bid.counter > transferBudgetLeft(club)) return `移籍予算の残り（${yenText(Math.max(0, transferBudgetLeft(club)))}）に収まりません。`;
  bid.fee = bid.counter;
  bid.status = 'accepted';
  bid.due = addDays(state.date, TRANSFER.contractDays);
  resolveMessages(state, bid.id);
  return null;
}

/** 自分の申し込みを取り下げる */
export function withdrawBid(state: GameState, bidId: string): void {
  const bid = state.bids?.find((b) => b.id === bidId);
  if (!bid || !isOpen(bid) || bid.status === 'agreed') return;
  bid.status = 'withdrawn';
  bid.note = '取り下げました。';
  resolveMessages(state, bid.id);
}

// ---- 他クラブ（と海外）からの申し込みに答える ----

/** 自分の選手への申し込みを受ける。AIクラブは選手と話をつけて、移籍期間に成立させる */
export function acceptIncoming(state: GameState, bidId: string, rng: Rng): string {
  const bid = state.bids?.find((b) => b.id === bidId);
  const player = bid ? state.players[bid.playerId] : undefined;
  if (!bid || !player || bid.status !== 'waiting' || bid.sellerId !== state.manager.clubId) return 'この申し込みは終わっています。';
  resolveMessages(state, bid.id);
  if (bid.buyerId === OVERSEAS || bid.kind === 'loan') {
    settle(state, bid);
    return bid.kind === 'loan' ? 'レンタルに出すことにしました。' : '海外への移籍を認めました。';
  }
  const contract = playerWillMove(state, player, bid.buyerId, rng) ? aiContract(state, player, bid.buyerId) : null;
  if (!contract) {
    bid.status = 'failed';
    bid.note = `${player.name}が、${clubName(state, bid.buyerId)}への移籍を断りました。`;
    notify(state, bid, `${player.name}は残ります`, bid.note, true);
    return bid.note;
  }
  bid.contract = contract;
  payAgentFee(state, player, bid.buyerId, contract);
  settle(state, bid);
  return `${player.name}の移籍を受けました。`;
}

/** 自分の選手への申し込みを断る。海外への移籍を、行きたがっている選手に断るとモラルが大きく下がる */
export function rejectIncoming(state: GameState, bidId: string): void {
  const bid = state.bids?.find((b) => b.id === bidId);
  if (!bid || bid.status !== 'waiting' || bid.sellerId !== state.manager.clubId) return;
  bid.status = 'rejected';
  bid.note = '断りました。';
  resolveMessages(state, bid.id);
  const player = state.players[bid.playerId];
  if (player && bid.buyerId === OVERSEAS) {
    player.status.morale = clamp(player.status.morale - TRANSFER.overseasRefuseMorale, 0, 100);
    player.overseasRefused = (player.overseasRefused ?? 0) + 1;
  }
}

/** もっと高い額を返す。相手が出せる額なら、その場で受ける */
export function counterIncoming(state: GameState, bidId: string, amount: number, rng: Rng): string {
  const bid = state.bids?.find((b) => b.id === bidId);
  const player = bid ? state.players[bid.playerId] : undefined;
  const buyer = bid ? state.clubs[bid.buyerId] : undefined;
  if (!bid || !player || !buyer || bid.status !== 'waiting' || bid.kind !== 'transfer') return 'この申し込みは終わっています。';
  const max = marketValue(player, state.season.year) * policyOf(buyer).buyerMax;
  if (amount > Math.min(max, aiSpendable(buyer) + bid.fee) || bid.rounds >= TRANSFER.maxRounds) {
    bid.status = 'withdrawn';
    bid.note = `${buyer.name}：その額は出せません。`;
    resolveMessages(state, bid.id);
    return bid.note;
  }
  bid.fee = roundTo(amount, 1e5);
  bid.rounds++;
  return acceptIncoming(state, bidId, rng);
}

/** 移籍予算から年俸予算に、まだ回せる額 */
function shiftRoom(club: Club): number {
  const b = club.finance.budget;
  return b.wages * TRANSFER.maxShift - (b.shifted ?? 0);
}

/** 移籍予算の一部を、年俸予算に回す */
function shiftToWages(club: Club, amount: number): void {
  const b = club.finance.budget;
  const x = Math.ceil(amount / 1e6) * 1e6;
  b.transfers -= x;
  b.wages += x;
  b.shifted = (b.shifted ?? 0) + x;
}

/** クラブの上位18人の平均総合力 */
export function clubStrength(state: GameState, clubId: string): number {
  const top = playersOf(state, clubId).map(overallRating).sort((a, b) => b - a).slice(0, 18);
  return top.length === 0 ? 0 : top.reduce((a, b) => a + b, 0) / top.length;
}

function strengths(state: GameState): { by: Map<string, number>; average: number } {
  const by = new Map(Object.keys(state.clubs).map((id) => [id, clubStrength(state, id)]));
  const values = [...by.values()];
  return { by, average: values.reduce((a, b) => a + b, 0) / Math.max(1, values.length) };
}

function payAgentFee(state: GameState, player: PlayerRecord, clubId: string, contract: Contract): void {
  const club = state.clubs[clubId];
  if (club) spend(club.finance, 'agentFees', contract.salary * AGENT_STYLES[agentOf(state, player).style].feeRate);
}

// ---- リスト（売る・レンタルに出す） ----

export function setListing(state: GameState, playerId: string, listing: 'sale' | 'loan' | null): void {
  const player = state.players[playerId];
  if (player && player.clubId === state.manager.clubId && !player.loan) player.listed = listing;
}

/** AIクラブが、出番のない選手を移籍リストに、伸びしろのある若手をレンタルのリストに載せる */
function aiListings(state: GameState): void {
  const myId = state.manager.clubId;
  for (const club of Object.values(state.clubs)) {
    if (club.id === myId) continue;
    const ranked = playersOf(state, club.id).filter((p) => !p.loan).sort((a, b) => overallRating(b) - overallRating(a));
    ranked.forEach((p, rank) => {
      if (p.age <= TRANSFER.loanAge && rank >= TRANSFER.loanRank && p.hidden.potential >= club.level) p.listed = 'loan';
      else if (rank >= TRANSFER.listRank && p.age >= TRANSFER.listAge && p.contract?.role !== 'key') p.listed = 'sale';
      else p.listed = null;
    });
  }
}

// ---- AIクラブの移籍 ----

interface Candidate {
  player: PlayerRecord;
  fee: number;
  kind: BidKind;
  gain: number;
  fromPool: boolean;
}

/** AIクラブが、足りないポジションか、強くなる選手を、国内の他クラブか海外の選手プールから買う（1回に1人まで） */
function aiBuyRound(state: GameState, rng: Rng): void {
  const myId = state.manager.clubId;
  const year = state.season.year;
  const bought = new Map<string, number>();
  for (const r of state.transferHistory ?? []) {
    if (yearOf(r.date) === year && r.toClubId && (r.kind === 'transfer' || r.kind === 'fromAbroad')) bought.set(r.toClubId, (bought.get(r.toClubId) ?? 0) + 1);
  }
  const clubs = Object.values(state.clubs).filter((c) => c.id !== myId);
  for (let i = clubs.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [clubs[i], clubs[j]] = [clubs[j] as Club, clubs[i] as Club];
  }
  const taken = new Set<string>();
  const race = titleRaceClubs(state);
  const poolIds = new Set(state.overseasPool);
  const power = strengths(state);
  for (const club of clubs) {
    if (!rng.chance(TRANSFER.aiBuyChance)) continue;
    const policy = policyOf(club);
    if ((bought.get(club.id) ?? 0) >= policy.maxBuys) continue;
    const squad = playersOf(state, club.id).filter((p) => !p.leaving);
    if (squad.length >= LEAGUE_RULES.squadMax) continue;
    const budget = aiSpendable(club);
    if (budget <= 0) continue;
    const foreigners = squad.filter(isForeign).length;
    const byPosition = new Map<Position, number[]>();
    for (const p of squad) byPosition.set(p.position, [...(byPosition.get(p.position) ?? []), overallRating(p)].sort((a, b) => b - a));
    // 十分に強いクラブは、足りないポジションを埋めるだけ
    const saturated = (power.by.get(club.id) ?? 0) >= power.average + TRANSFER.saturation;
    const gainFor = (p: PlayerRecord): number => {
      const here = byPosition.get(p.position) ?? [];
      const overall = overallRating(p);
      if (here.length < idealCount(p.position)) return overall >= club.level - policy.minBelowLevel ? overall - (club.level - 2) : -1;
      if (saturated) return -1;
      return overall - (here[1] ?? 0) - TRANSFER.upgrade;
    };
    const [minAge, maxAge] = policy.age;
    const candidates: Candidate[] = [];
    for (const p of Object.values(state.players)) {
      if (taken.has(p.id) || p.age < minAge || p.age > maxAge) continue;
      const pool = p.clubId === null && poolIds.has(p.id);
      if (!pool && (!p.clubId || p.clubId === club.id || p.leaving || p.loan || p.joining || p.retiring || !p.contract)) continue;
      if (pool && foreigners >= TRANSFER.foreignMax) continue;
      if (overallRating(p) < club.level - policy.minBelowLevel) continue;
      const gain = gainFor(p);
      if (gain <= 0) continue;
      const value = marketValue(p, year);
      if (pool) {
        candidates.push({ player: p, fee: feeRound(value * TRANSFER.poolFee), kind: 'transfer', gain, fromPool: true });
        continue;
      }
      if (openBidFor(state, p.id)) continue;
      const ask = askingFee(state, p, p.clubId!, race);
      if (ask.fee !== null && ask.fee <= value * policy.buyerMax) {
        candidates.push({ player: p, fee: Math.max(ask.fee, feeRound(value * TRANSFER.aiOpening[0])), kind: 'transfer', gain, fromPool: false });
      } else if (ask.fee === null && club.size === 'large' && p.contract?.releaseClause != null && gain >= 1) {
        candidates.push({ player: p, fee: p.contract.releaseClause, kind: 'clause', gain, fromPool: false });
      }
    }
    // 移籍予算に収まる選手を、強くなる順に試す（年俸の希望を聞くのは重いので、上から20人まで）
    const affordable = candidates.filter((c) => c.fee <= budget).sort((a, b) => b.gain - a.gain || a.fee - b.fee);
    let refusals = 0;
    for (const c of affordable.slice(0, 20)) {
      if (refusals >= 3) break;
      const contract = aiContract(state, c.player, club.id);
      if (!contract) continue;
      // 年俸予算が足りなければ、移籍予算の残りから回す（監督が財務の画面でできるのと同じ）
      const short = contract.salary - wageRoom(state, club.id);
      if (short > 0 && (c.fee + short > budget || short > shiftRoom(club))) continue;
      taken.add(c.player.id);
      if (short > 0) shiftToWages(club, short);
      if (c.fromPool) {
        // 海外の選手プール：移籍金を払えば来る
        state.overseasPool = state.overseasPool.filter((id) => id !== c.player.id);
        poolIds.delete(c.player.id);
        payFee(state, club.id, null, c.fee);
        payAgentFee(state, c.player, club.id, contract);
        c.player.contract = contract;
        addToClub(state, c.player, club.id);
        c.player.status.integration = 30;
        record(state, c.player, null, club.id, c.fee, 'fromAbroad');
        bought.set(club.id, (bought.get(club.id) ?? 0) + 1);
        break;
      }
      const sellerId = c.player.clubId!;
      if (sellerId === myId) {
        // 自分のクラブの選手：申し込みが届き、監督が決める（違約金なら選手が決める）
        incomingBid(state, c, club, rng);
        break;
      }
      if (!playerWillMove(state, c.player, club.id, rng)) {
        refusals++;
        continue;
      }
      const bid = newBid(state, { kind: c.kind, playerId: c.player.id, sellerId, buyerId: club.id, fee: c.fee, wageShare: 1, status: 'accepted', due: state.date });
      bid.contract = contract;
      payAgentFee(state, c.player, club.id, contract);
      complete(state, bid);
      bought.set(club.id, (bought.get(club.id) ?? 0) + 1);
      break;
    }
  }
}

/** AIクラブから自分の選手への申し込み */
function incomingBid(state: GameState, c: Candidate, buyer: Club, rng: Rng): void {
  const player = c.player;
  const value = marketValue(player, state.season.year);
  if (c.kind === 'clause') {
    const bid = newBid(state, { kind: 'clause', playerId: player.id, sellerId: state.manager.clubId, buyerId: buyer.id, fee: c.fee, wageShare: 1, status: 'accepted', due: state.date });
    const contract = playerWillMove(state, player, buyer.id, rng) ? aiContract(state, player, buyer.id) : null;
    if (!contract) {
      bid.status = 'failed';
      bid.note = `${player.name}は残ることを選びました。`;
      notify(state, bid, `${buyer.name}が${player.name}の違約金を払いましたが、本人は残ります`, `${buyer.name}が違約金${yenText(c.fee)}を払って${player.name}と話しましたが、${player.name}は残ることを選びました。`, true);
      return;
    }
    bid.contract = contract;
    payAgentFee(state, player, buyer.id, contract);
    notify(state, bid, `${buyer.name}が${player.name}の違約金を払いました`, `${buyer.name}が違約金${yenText(c.fee)}を払い、${player.name}は移籍を決めました。違約金を払われると、クラブは断れません。`, true);
    settle(state, bid);
    return;
  }
  const offer = feeRound(Math.min(c.fee, value * (TRANSFER.aiOpening[0] + rng.next() * (TRANSFER.aiOpening[1] - TRANSFER.aiOpening[0]))));
  const bid = newBid(state, { kind: 'transfer', playerId: player.id, sellerId: state.manager.clubId, buyerId: buyer.id, fee: offer, wageShare: 1, status: 'waiting', due: addDays(state.date, TRANSFER.decideDays) });
  notify(state, bid, `${buyer.name}から${player.name}への申し込み`,
    `${buyer.name}が、${player.name}を移籍金${yenText(offer)}で獲りたいと言っています（市場価値は${yenText(value)}）。\n${TRANSFER.decideDays}日以内に、受けるか、断るか、もっと高い額を返すかを決めてください。返事をしないと断ったことになります。`,
    true, true);
}

/** レンタル：AIクラブの若手を、出番のありそうなクラブに貸す。自分のクラブのレンタルのリストの選手には、申し込みが届く */
function aiLoanRound(state: GameState, rng: Rng): void {
  const myId = state.manager.clubId;
  const sizeRank: Record<string, number> = { small: 0, medium: 1, large: 2 };
  const listed = Object.values(state.players).filter((p) => p.listed === 'loan' && p.clubId && !p.loan && !p.leaving && !openBidFor(state, p.id));
  for (const player of listed) {
    if (!rng.chance(TRANSFER.loanChance)) continue;
    const parent = state.clubs[player.clubId!];
    if (!parent) continue;
    const overall = overallRating(player);
    const borrowers = Object.values(state.clubs).filter((c) => {
      if (c.id === parent.id || c.id === myId || sizeRank[c.size]! > sizeRank[parent.size]!) return false;
      const squad = playersOf(state, c.id).filter((p) => !p.leaving);
      if (squad.length >= CONTRACT.aiSquadAfterNewcomers) return false;
      if (squad.filter((p) => p.loan).length >= 2) return false;
      const here = squad.filter((p) => p.position === player.position).map(overallRating).sort((a, b) => b - a);
      const useful = here.length < idealCount(player.position) || overall >= (here[1] ?? 0);
      return useful && (player.contract?.salary ?? 0) <= wageRoom(state, c.id);
    });
    if (borrowers.length === 0) continue;
    const borrower = rng.pick(borrowers);
    if (parent.id === myId) {
      const bid = newBid(state, { kind: 'loan', playerId: player.id, sellerId: myId, buyerId: borrower.id, fee: 0, wageShare: 1, status: 'waiting', due: addDays(state.date, TRANSFER.decideDays) });
      notify(state, bid, `${borrower.name}から${player.name}のレンタルの申し込み`,
        `${borrower.name}が、${player.name}をレンタルで借りたいと言っています（${TRANSFER.loanEnds.replace('-', '月')}日まで、年俸は相手が全額払う）。\n試合に出られれば、成長しやすくなります。${TRANSFER.decideDays}日以内に決めてください。`, true, true);
      continue;
    }
    startLoan(state, player, borrower.id, 1);
  }
}

// ---- 海外への移籍 ----

/** 活躍した選手に、海外のクラブから申し込みが届く（6月20日と12月10日） */
function overseasRound(state: GameState, rng: Rng): void {
  const myId = state.manager.clubId;
  const pool = Object.values(state.players).filter((p) => {
    if (!p.clubId || !p.contract || p.leaving || p.retiring || p.loan || p.joining || openBidFor(state, p.id)) return false;
    const overall = overallRating(p);
    return (p.age <= TRANSFER.overseasYoungAge && overall >= TRANSFER.overseasYoung) || (overall >= TRANSFER.overseasStar && p.age <= 31);
  });
  const count = rng.int(...TRANSFER.overseasPerDate);
  const power = strengths(state);
  const clubFactor = (p: PlayerRecord): number => Math.max(0.5, 1 + TRANSFER.overseasStrongClub * ((power.by.get(p.clubId ?? '') ?? power.average) - power.average));
  for (let k = 0; k < count && pool.length > 0; k++) {
    const weights = pool.map((p) => Math.max(0.1, overallRating(p) - 13) * (p.hidden.ambition / 10) * (1 + 0.5 * (p.overseasRefused ?? 0)) * clubFactor(p));
    let pick = rng.next() * weights.reduce((a, b) => a + b, 0);
    let index = 0;
    while (index < weights.length - 1 && pick > weights[index]!) pick -= weights[index++]!;
    const player = pool.splice(index, 1)[0]!;
    const sellerId = player.clubId!;
    const value = marketValue(player, state.season.year);
    const wants = rng.chance(TRANSFER.overseasWant(player.hidden.ambition, player.overseasRefused ?? 0));
    if (!wants) {
      if (sellerId === myId) {
        notify(state, null, `${player.name}に海外から話がありましたが、本人は残ります`, `${player.name}に海外のクラブから話がありましたが、本人は「今はこのクラブで結果を出したい」と言っています。`, false);
      }
      continue;
    }
    const offer = feeRound(value * (TRANSFER.overseasFee[0] + rng.next() * (TRANSFER.overseasFee[1] - TRANSFER.overseasFee[0])));
    const clause = player.contract?.releaseClause ?? null;
    const byClause = clause !== null && clause <= offer;
    const fee = byClause ? clause : offer;
    if (sellerId !== myId) {
      const bid = newBid(state, { kind: byClause ? 'clause' : 'overseas', playerId: player.id, sellerId, buyerId: OVERSEAS, fee, wageShare: 1, status: 'accepted', due: state.date });
      settle(state, bid);
      continue;
    }
    if (byClause) {
      const bid = newBid(state, { kind: 'clause', playerId: player.id, sellerId, buyerId: OVERSEAS, fee, wageShare: 1, status: 'accepted', due: state.date });
      notify(state, bid, `海外のクラブが${player.name}の違約金を払いました`, `海外のクラブが違約金${yenText(fee)}を払い、${player.name}は移籍を決めました。違約金を払われると、クラブは断れません。`, true);
      settle(state, bid);
      continue;
    }
    const bid = newBid(state, { kind: 'overseas', playerId: player.id, sellerId, buyerId: OVERSEAS, fee, wageShare: 1, status: 'waiting', due: addDays(state.date, TRANSFER.overseasDecideDays) });
    notify(state, bid, `海外のクラブから${player.name}への申し込み`,
      `ヨーロッパのクラブが、${player.name}を移籍金${yenText(fee)}で獲りたいと言っています（市場価値は${yenText(value)}）。${player.name}は行きたがっています。\n`
      + `断ることもできますが、モラルが大きく下がり、次も話が来やすくなります。${TRANSFER.overseasDecideDays}日以内に決めてください。`, true, true);
  }
}

// ---- 毎日 ----

/** 12月1日：レンタルの選手を元のクラブに戻す（契約の締め切りの前） */
function endLoans(state: GameState): void {
  const myId = state.manager.clubId;
  const back: PlayerRecord[] = [];
  for (const player of Object.values(state.players)) {
    if (!player.loan || state.date <= player.loan.until) continue;
    const parent = player.loan.fromClubId;
    const borrower = player.clubId;
    removeFromClub(state, player);
    player.loan = null;
    addToClub(state, player, parent);
    record(state, player, borrower, parent, 0, 'loanReturn');
    if (parent === myId || borrower === myId) back.push(player);
  }
  if (back.length > 0) {
    notify(state, null, 'レンタルの選手が戻りました', `レンタルが終わり、次の選手が元のクラブに戻りました：${back.map((p) => p.name).join('、')}`, false);
  }
}

function prune(state: GameState): void {
  const closed = (state.bids ?? []).filter((b) => !isOpen(b));
  if (closed.length > TRANSFER.keepBids) {
    const drop = new Set(closed.slice(0, closed.length - TRANSFER.keepBids).map((b) => b.id));
    state.bids = state.bids.filter((b) => !drop.has(b.id));
  }
}

/** advanceDay が毎日呼ぶ（契約の出来事の前） */
export function transferEvents(state: GameState, rng: Rng): void {
  state.bids ??= [];
  const myId = state.manager.clubId;
  const md = monthDay(state.date);
  if (md === addDays(`2001-${TRANSFER.loanEnds}`, 1).slice(5)) endLoans(state);

  for (const bid of [...state.bids]) {
    if (!isOpen(bid)) continue;
    const due = state.date >= bid.due;
    if (bid.buyerId === myId && bid.status === 'waiting' && due) answerMyBid(state, bid, rng);
    else if (bid.buyerId === myId && bid.status === 'countered' && state.date > bid.due) {
      bid.status = 'withdrawn';
      bid.note = '期限までに返事をしなかったので、流れました。';
      resolveMessages(state, bid.id);
    } else if (bid.buyerId === myId && bid.status === 'accepted' && state.date > bid.due) {
      bid.status = 'failed';
      bid.note = '期限までに選手と契約がまとまりませんでした。';
      resolveMessages(state, bid.id);
      const player = state.players[bid.playerId];
      notify(state, bid, `${player?.name ?? '選手'}の獲得が流れました`, bid.note, true);
    } else if (bid.sellerId === myId && bid.status === 'waiting' && state.date > bid.due) {
      rejectIncoming(state, bid.id);
      bid.note = '返事をしなかったので、断ったことになりました。';
    }
  }
  if (windowOpen(state.date)) {
    for (const bid of state.bids.filter((b) => b.status === 'agreed')) complete(state, bid);
  }
  const aiDay = TRANSFER.aiDays.includes(md) && windowOpen(state.date);
  if (aiDay) {
    aiListings(state);
    aiBuyRound(state, rng);
    aiLoanRound(state, rng);
  }
  if (TRANSFER.overseasDays.includes(md)) overseasRound(state, rng);
  prune(state);
}
