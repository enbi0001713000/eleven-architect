// クラブのお金（フェーズ3-A：会計と予算）。要件定義書「フェーズ3：財務とオーナー」の
// 「収入と支出」「チケット料金」「予算」「お金が足りなくなったとき」と、「金額の目安」に対応する。
//
// お金が動くとき
//   ホームゲームの日：入場料、試合の日のグッズ販売、試合の運営費
//   毎月1日（前の月の分）：スポンサー、リーグからの配分、グッズ販売、年俸、運営費、借り入れの利息と返済
//   12月10日（シーズンの総括）：賞金。成績で評判とファンの数が変わる
//   1月1日：年度（1月〜12月）を締め、新しい年のスポンサー、配分、運営費、オーナーの予算を決める
//   12月1日：契約が今年で切れるスポンサーの枠に、提案が届く（自分のクラブ。選ばなければ標準の契約になる）
//   ファンクラブの会費（12月、1月、2月）とイベントの費用は fanClub.ts で動く
// 手元のお金が足りなくなったら、自動で緊急の借り入れをし、上限を超える分はオーナーが入れる（破産はしない）。

import { overallRating } from '../engine/ratings';
import { createRng, type Rng } from '../engine/rng';
import { daySeed, monthDay, weekday, yearOf } from './dates';
import { FAN_CLUB } from './fanClubBalance';
import {
  FINANCE, REPUTATION_BASE, SEAT_KINDS, SEATS, SPONSOR_DEALS, SPONSOR_PREFIXES, SPONSOR_SLOT_ORDER, SPONSOR_SLOTS, SPONSOR_SUFFIXES,
} from './financeBalance';
import { addMessage } from './inbox';
import { budgetTrustFactor, OWNER } from './ownerBalance';
import { LEAGUE_RULES } from './rules';
import type { StandingRow } from './standings';
import type {
  Budget, Club, ClubFinance, ExpenseKind, Fixture, GameState, IncomeKind, Ledger, Loan, SeatKind, SponsorDeal, SponsorDealKind, SponsorOffer,
} from './types';

const HOME_MATCHES = LEAGUE_RULES.rounds / 2;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const roundTo = (yen: number, unit: number): number => Math.round(yen / unit) * unit;
const isMine = (state: GameState, club: Club): boolean => club.id === state.manager.clubId;

// ---- 集計 ----

export function emptyLedger(): Ledger {
  return {
    income: { tickets: 0, broadcast: 0, sponsor: 0, merchandise: 0, fanClub: 0, prize: 0, transfers: 0 },
    expense: { wages: 0, operations: 0, matchday: 0, merchandiseCost: 0, fanClubCost: 0, interest: 0, transfers: 0, agentFees: 0 },
    financing: { borrowed: 0, repaid: 0, owner: 0 },
  };
}

export function sumLedgers(ledgers: readonly Ledger[]): Ledger {
  const total = emptyLedger();
  for (const l of ledgers) {
    // 古い記録（フェーズ3.5より前）には、ファンクラブの項目がない
    for (const k of Object.keys(total.income) as IncomeKind[]) total.income[k] += l.income[k] ?? 0;
    for (const k of Object.keys(total.expense) as ExpenseKind[]) total.expense[k] += l.expense[k] ?? 0;
    total.financing.borrowed += l.financing.borrowed;
    total.financing.repaid += l.financing.repaid;
    total.financing.owner += l.financing.owner;
  }
  return total;
}

export const totalIncome = (l: Ledger): number => Object.values(l.income).reduce((a, b) => a + b, 0);
export const totalExpense = (l: Ledger): number => Object.values(l.expense).reduce((a, b) => a + b, 0);
/** 差し引き（黒字ならプラス） */
export const netResult = (l: Ledger): number => totalIncome(l) - totalExpense(l);

/** 今年（1月から今日まで）の収支 */
export function yearToDate(fin: ClubFinance): Ledger {
  return sumLedgers([...fin.months.map((m) => m.ledger), fin.current]);
}

export function earn(fin: ClubFinance, kind: IncomeKind, yen: number): void {
  const value = Math.round(yen);
  fin.current.income[kind] += value;
  fin.balance += value;
}

export function spend(fin: ClubFinance, kind: ExpenseKind, yen: number): void {
  const value = Math.round(yen);
  fin.current.expense[kind] += value;
  fin.balance -= value;
}

/** 選手の年俸の合計（1年分） */
export function payrollOf(state: GameState, clubId: string): number {
  return (state.clubs[clubId]?.playerIds ?? []).reduce((n, id) => n + (state.players[id]?.contract?.salary ?? 0), 0);
}

export const debtOf = (fin: ClubFinance): number => fin.loans.reduce((n, l) => n + l.remaining, 0);

// ---- チケットと観客 ----

export function listPrice(club: Club, seat: SeatKind): number {
  return roundTo(SEATS[seat].price * FINANCE.listPriceFactor[club.size], 100);
}

export function defaultTicketPrices(club: Club): Record<SeatKind, number> {
  return Object.fromEntries(SEAT_KINDS.map((s) => [s, listPrice(club, s)])) as Record<SeatKind, number>;
}

/** プレイヤーが決められる範囲に収める（100円単位） */
export function clampTicketPrice(club: Club, seat: SeatKind, price: number): number {
  const list = listPrice(club, seat);
  return roundTo(clamp(price, list * FINANCE.priceRange[0], list * FINANCE.priceRange[1]), 100);
}

/** 定価に対する、席の割合で重みをつけた値段の倍率 */
export function priceLevel(club: Club, prices: Record<SeatKind, number>): number {
  return SEAT_KINDS.reduce((n, s) => n + SEATS[s].share * (prices[s] / listPrice(club, s)), 0);
}

/** ファンクラブの会員の割合が基準より何ポイント高いか（フェーズ3.5） */
function memberPoints(club: Club): number {
  const m = club.fanClub?.members;
  if (!m || club.fans <= 0) return 0;
  return ((m.regular + m.gold + m.platinum) / club.fans - FAN_CLUB.baseRate) * 100;
}

/** 会員が多いほど、スタジアムに人が来て、グッズも売れる */
const memberDemand = (club: Club): number => clamp(1 + FAN_CLUB.attendancePerPoint * memberPoints(club), 0.85, 1.2);
const memberMerch = (club: Club): number => clamp(1 + FAN_CLUB.merchPerPoint * memberPoints(club), 0.85, 1.2);

/** ゴールド以上の会員はチケットとグッズが割引になる。観客のうち、その会員の割合 */
function premiumShare(club: Club, spectators: number): number {
  const m = club.fanClub?.members;
  if (!m || spectators <= 0) return 0;
  return Math.min(0.4, FAN_CLUB.premiumAttendance * (m.gold + m.platinum) / spectators);
}

/** 普通の条件で、スタジアムに来たい人の数（収容人数で切る前） */
export function baseDemand(club: Club, mood: number): number {
  return FINANCE.attendanceScale * club.fans ** FINANCE.attendanceExponent * (0.85 + 0.3 * mood / 100) * memberDemand(club);
}

export interface Gate {
  total: number;
  seats: Record<SeatKind, number>;
  /** 入場料の収入 */
  tickets: number;
  /** 収容人数に対する割合 */
  fill: number;
}

/** 来たい人の数から、席の種類ごとの観客と入場料を決める。値上げした席ほど人が減る */
export function gateFor(club: Club, prices: Record<SeatKind, number>, demand: number): Gate {
  const seats = {} as Record<SeatKind, number>;
  let total = 0;
  let tickets = 0;
  for (const s of SEAT_KINDS) {
    const capacity = club.stadium.capacity * SEATS[s].share;
    const wanting = demand * SEATS[s].share * Math.exp(-SEATS[s].sensitivity * (prices[s] / listPrice(club, s) - 1));
    seats[s] = Math.round(Math.min(capacity, wanting));
    total += seats[s];
    tickets += seats[s] * prices[s] * FINANCE.ticketYield;
  }
  return { total, seats, tickets: Math.round(tickets), fill: total / club.stadium.capacity };
}

/** 普通の条件（週末、ダービーでない、成績は平均）のホームゲームの見込み */
export function expectedGate(club: Club, prices: Record<SeatKind, number> = club.finance.ticketPrices, mood = 50): Gate {
  return gateFor(club, prices, baseDemand(club, mood));
}

/** 評判の順位（1が最も高い）。期待される順位として使う */
export function reputationRanks(state: GameState): Map<string, number> {
  const ids = Object.values(state.clubs).sort((a, b) => b.reputation - a.reputation || a.id.localeCompare(b.id)).map((c) => c.id);
  return new Map(ids.map((id, i) => [id, i + 1]));
}

/** 成績による増減：期待された順位との差と、直近5試合の勝ち点 */
function formFactor(row: StandingRow | undefined, expectedRank: number): number {
  if (!row || row.played < 5) return 1;
  const recent = row.form.reduce((n, r) => n + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
  return clamp(1 + 0.012 * (expectedRank - row.position) + 0.03 * (recent - 7) / 4, 0.8, 1.25);
}

const moodOf = (state: GameState, club: Club): number => (isMine(state, club) ? state.fanMood : 50);

/** その試合の観客。table は試合の前の順位表 */
export function matchGate(state: GameState, fixture: Fixture, table: readonly StandingRow[]): Gate {
  const club = state.clubs[fixture.homeId] as Club;
  const opponent = state.clubs[fixture.awayId];
  const rng = createRng(daySeed(state.seed, fixture.date, `gate-${fixture.id}`));
  const expectedRank = reputationRanks(state).get(club.id) ?? 9;
  let demand = baseDemand(club, moodOf(state, club))
    * formFactor(table.find((r) => r.clubId === club.id), expectedRank)
    * (1 + ((opponent?.reputation ?? 60) - 60) / 200);
  if (club.rivalId === fixture.awayId) demand *= FINANCE.derbyFactor;
  const day = weekday(fixture.date);
  if (day >= 1 && day <= 5) demand *= FINANCE.weekdayFactor;
  if (fixture.round === 1) demand *= FINANCE.openingFactor;
  demand *= clamp(rng.normal(1, 0.05), 0.85, 1.15);
  return gateFor(club, club.finance.ticketPrices, demand);
}

/** 人気選手（総合力の高い選手）が多いほど、グッズが売れる */
function starFactor(state: GameState, club: Club): number {
  const stars = club.playerIds.filter((id) => {
    const p = state.players[id];
    return p !== undefined && overallRating(p) >= FINANCE.starOverall;
  }).length;
  return 1 + FINANCE.merchStarBonus * Math.min(5, stars);
}

/** ホームゲームのお金（入場料、試合の日のグッズ、試合の運営費）を記録して、観客数を返す */
export function settleHomeMatch(state: GameState, fixture: Fixture, table: readonly StandingRow[]): number {
  const club = state.clubs[fixture.homeId];
  if (!club) return 0;
  const fin = club.finance;
  const gate = matchGate(state, fixture, table);
  const discount = 1 - FAN_CLUB.premiumDiscount * premiumShare(club, gate.total);
  earn(fin, 'tickets', gate.tickets * discount);
  const merch = gate.total * FINANCE.merchPerSpectator * starFactor(state, club) * memberMerch(club) * discount;
  earn(fin, 'merchandise', merch);
  spend(fin, 'merchandiseCost', merch * FINANCE.merchCostRate);
  spend(fin, 'matchday', FINANCE.matchdayFixed + FINANCE.matchdayPerSpectator * gate.total);
  if (isMine(state, club)) {
    // 値上げするとファンの雰囲気が少し悪くなり、値下げや満員のスタジアムで良くなる
    const level = priceLevel(club, fin.ticketPrices);
    let mood = 0;
    if (level > 1.05) mood -= (level - 1.05) * FINANCE.priceMoodUp;
    if (level < 0.95) mood += (0.95 - level) * FINANCE.priceMoodDown;
    if (gate.fill >= 0.97) mood += 0.5;
    state.fanMood = clamp(state.fanMood + mood, 0, 100);
  }
  return gate.total;
}

// ---- 毎月 ----

function monthlyMerch(state: GameState, club: Club, mood = moodOf(state, club)): number {
  return club.fans * FINANCE.merchPerFanMonthly * starFactor(state, club) * (0.85 + 0.3 * mood / 100) * memberMerch(club);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

function bookMonth(state: GameState, club: Club, month: string): void {
  const fin = club.finance;
  earn(fin, 'sponsor', sponsorIncome(fin) / 12);
  earn(fin, 'broadcast', fin.broadcast / 12);
  const merch = monthlyMerch(state, club);
  earn(fin, 'merchandise', merch);
  spend(fin, 'merchandiseCost', merch * FINANCE.merchCostRate);
  spend(fin, 'wages', payrollOf(state, club.id) / 12);
  spend(fin, 'operations', fin.operations / 12);
  for (const loan of fin.loans) {
    spend(fin, 'interest', loan.remaining * loan.rate / 12);
    const principal = month >= loan.endMonth ? loan.remaining : Math.min(loan.remaining, loan.monthly);
    loan.remaining -= principal;
    fin.balance -= principal;
    fin.current.financing.repaid += principal;
  }
  fin.loans = fin.loans.filter((l) => l.remaining > 0);
}

function createLoan(club: Club, amount: number, months: number, month: string, emergency: boolean): Loan {
  const fin = club.finance;
  const loan: Loan = {
    id: `${club.id}-${++fin.loanCount}`,
    amount,
    remaining: amount,
    rate: FINANCE.loanRate[club.size] + (emergency ? FINANCE.emergencyExtraRate : 0),
    monthly: Math.ceil(amount / months),
    startMonth: month,
    endMonth: addMonths(month, months - 1),
    emergency,
  };
  fin.loans.push(loan);
  fin.balance += amount;
  fin.current.financing.borrowed += amount;
  return loan;
}

/** 手元のお金がマイナスになったら：緊急の借り入れ、それでも足りなければオーナーが入れる */
function coverShortfall(state: GameState, club: Club, month: string): void {
  const fin = club.finance;
  if (fin.balance >= 0) return;
  const monthlyCost = (payrollOf(state, club.id) + fin.operations) / 12;
  const need = Math.ceil((-fin.balance + monthlyCost) / 1e8) * 1e8;
  const room = Math.floor((FINANCE.loanLimit[club.size] - debtOf(fin)) / 1e7) * 1e7;
  const borrowed = Math.min(need, Math.max(0, room));
  if (borrowed > 0) createLoan(club, borrowed, FINANCE.emergencyTerm, month, true);
  let owner = 0;
  if (fin.balance < 0) {
    owner = Math.ceil((-fin.balance + monthlyCost) / 1e7) * 1e7;
    fin.balance += owner;
    fin.current.financing.owner += owner;
  }
  if (isMine(state, club)) {
    addMessage(state, {
      category: 'finance', from: '経理担当', important: true, topic: 'shortfall',
      subject: '手元のお金が足りなくなりました',
      lines: [
        '監督、お金のことで急ぎのご報告です。',
        '月末の支払いで、手元のお金が足りなくなりました。',
        borrowed > 0 ? `銀行から${yenText(borrowed)}を緊急で借りて、支払いを済ませました。普段より金利が高い借り入れです。` : '',
        owner > 0 ? `借り入れの上限を超えてしまうので、オーナーに${yenText(owner)}を出していただきました。` : '',
        'このままでは毎月お金が出ていくばかりです。チケットの値段や年俸を見直してください。',
      ].filter((l) => l !== ''),
      body: [
        '月末の支払いで、手元のお金がマイナスになりました。',
        borrowed > 0 ? `銀行から緊急の借り入れをしました：${yenText(borrowed)}（${FINANCE.emergencyTerm}か月で返済、年利${((FINANCE.loanRate[club.size] + FINANCE.emergencyExtraRate) * 100).toFixed(1)}%）。` : '',
        owner > 0 ? `借り入れの上限を超えるため、オーナーが${yenText(owner)}を入れました。` : '',
        '収入を増やすか（チケットの値段など）、支出を抑えてください。（オーナーの評価はフェーズ3-Bで加わります）',
      ].filter((l) => l !== '').join('\n'),
    });
  }
}

/** 金額を「1.2億円」「3,400万円」のように書く */
export function yenText(yen: number): string {
  const sign = yen < 0 ? '-' : '';
  const abs = Math.abs(yen);
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(abs >= 1e10 ? 0 : 1)}億円`;
  if (abs < 5e3) return '0円';
  return `${sign}${Math.round(abs / 1e4).toLocaleString('ja-JP')}万円`;
}

const monthLabel = (month: string): string => `${Number(month.slice(5, 7))}月`;

/** 月を締める（毎月1日に、前の月の分を） */
export function closeMonth(state: GameState, month: string, report = true): void {
  for (const club of Object.values(state.clubs)) {
    const fin = club.finance;
    bookMonth(state, club, month);
    coverShortfall(state, club, month);
    const record = { month, ledger: fin.current, balance: fin.balance, debt: debtOf(fin) };
    fin.months.push(record);
    fin.current = emptyLedger();
    if (report && isMine(state, club)) {
      const net = netResult(record.ledger);
      const year = yearToDate(fin);
      addMessage(state, {
        category: 'finance', from: '経理担当', important: false,
        subject: `${monthLabel(month)}の収支：${net >= 0 ? '黒字' : '赤字'} ${yenText(net)}`,
        body: [
          `収入 ${yenText(totalIncome(record.ledger))}　支出 ${yenText(totalExpense(record.ledger))}　差し引き ${yenText(net)}`,
          `今年の累計：収入 ${yenText(totalIncome(year))}　支出 ${yenText(totalExpense(year))}　差し引き ${yenText(netResult(year))}`,
          `手元のお金 ${yenText(fin.balance)}${record.debt > 0 ? `　借り入れの残り ${yenText(record.debt)}` : ''}`,
          '詳しくは財務の画面で見られます。',
        ].join('\n'),
      });
    }
  }
}

// ---- 年度 ----

/** その年のホームゲームの平均の観客 */
function averageAttendance(state: GameState, clubId: string, year: number): number | null {
  const gates = state.fixtures
    .filter((f) => f.homeId === clubId && f.date.startsWith(`${year}-`) && f.result?.attendance !== undefined)
    .map((f) => f.result?.attendance ?? 0);
  return gates.length === 0 ? null : Math.round(gates.reduce((a, b) => a + b, 0) / gates.length);
}

/** 年度を締める（1月1日に、前の年の分を。12月の分は先に closeMonth で締めておく） */
export function closeYear(state: GameState, year: number): void {
  const season = state.history.find((h) => h.year === year);
  for (const club of Object.values(state.clubs)) {
    const fin = club.finance;
    const ledger = sumLedgers([...fin.months.map((m) => m.ledger), fin.current]);
    fin.history.push({
      year, ledger, balance: fin.balance, debt: debtOf(fin),
      position: season?.table.find((r) => r.clubId === club.id)?.position ?? null,
      averageAttendance: averageAttendance(state, club.id, year),
      balances: fin.months.map((m) => ({ month: m.month, balance: m.balance })),
    });
    if (fin.history.length > 30) fin.history.shift();
    club.revenue = totalIncome(ledger);
    fin.months = [];
    fin.current = emptyLedger();
  }
}

/** リーグからの配分（年額）。前年の順位が高いほど多い */
export function distributionFor(position: number, clubs: number): number {
  const share = ((clubs - position) / Math.max(1, clubs - 1)) ** FINANCE.broadcastCurve;
  return roundTo(FINANCE.broadcastBase + FINANCE.broadcastTop * share, 1e6);
}

/** スポンサーが出せる年額（全部の枠の合計の相場）：評判と、地元企業の力で決まる */
export function sponsorValue(club: Club): number {
  return FINANCE.sponsorScale * club.reputation ** 2 * club.finance.localStrength;
}

/** スポンサー収入の年額（今の契約の合計） */
export const sponsorIncome = (fin: ClubFinance): number => fin.sponsors.reduce((n, d) => n + d.annual, 0);

/** ホームゲーム1試合のお金の見込み（普通の条件） */
function expectedMatchMoney(state: GameState, club: Club): { income: number; costs: number } {
  const gate = expectedGate(club);
  const discount = 1 - FAN_CLUB.premiumDiscount * premiumShare(club, gate.total);
  const merch = gate.total * FINANCE.merchPerSpectator * starFactor(state, club) * memberMerch(club) * discount;
  return {
    income: gate.tickets * discount + merch,
    costs: merch * FINANCE.merchCostRate + FINANCE.matchdayFixed + FINANCE.matchdayPerSpectator * gate.total,
  };
}

/** 1年の見込み：年俸と移籍以外の収入と支出、返す元金 */
export function yearPlan(state: GameState, club: Club): { income: number; costs: number; principal: number } {
  const fin = club.finance;
  const { income, costs } = incomeAndCosts(state, club);
  const repaid = (l: Loan): number => Math.min(l.remaining, l.monthly * 12);
  // 利息は、1年の間に返して減っていく分を考えて、平均の残りにかかる
  const interest = fin.loans.reduce((n, l) => n + l.rate * (l.remaining - repaid(l) / 2), 0);
  return { income, costs: fin.operations + costs + interest, principal: fin.loans.reduce((n, l) => n + repaid(l), 0) };
}

/** 年俸と運営費のほかの、1年の収入と支出の見込み */
function incomeAndCosts(state: GameState, club: Club): { income: number; costs: number } {
  const fin = club.finance;
  const match = expectedMatchMoney(state, club);
  const merch = 12 * monthlyMerch(state, club, 50);
  // ファンクラブの会費は、今の会員がそのまま続く見込みで数える
  const m = club.fanClub?.members;
  const fees = club.fanClub?.activeFees;
  const fanClub = m && fees ? m.regular * fees.regular + m.gold * fees.gold + m.platinum * fees.platinum : 0;
  return {
    income: sponsorIncome(fin) + fin.broadcast + HOME_MATCHES * match.income + merch + fanClub,
    costs: HOME_MATCHES * match.costs + merch * FINANCE.merchCostRate + fanClub * FAN_CLUB.costRate,
  };
}

/**
 * 最初の運営費（年額）：今の年俸で少し利益が残る額。ただし、規模に合った年俸の割合から決めた額の
 * 8割〜1.15倍に収める（年俸が高すぎるクラブは、最初から少し赤字になる）。
 */
function initialOperations(state: GameState, club: Club): number {
  const { income, costs } = incomeAndCosts(state, club);
  const atTarget = Math.max(0, income * (1 - FINANCE.targetWageRatio[club.size] - FINANCE.targetMargin) - costs);
  const atPayroll = income * (1 - FINANCE.targetMargin) - costs - payrollOf(state, club.id);
  return clamp(atPayroll, atTarget * 0.8, atTarget * 1.15);
}

/** オーナーが手元に残しておきたいお金（年俸と運営費の数か月分） */
function reserveOf(state: GameState, club: Club): number {
  return FINANCE.reserveMonths * (payrollOf(state, club.id) + club.finance.operations) / 12;
}

/** オーナーが決める予算。見込みの収支の余りと、手元のお金の余裕の一部を、年俸と移籍に回す */
export function ownerBudget(state: GameState, club: Club, year: number): Budget {
  const fin = club.finance;
  const plan = yearPlan(state, club);
  const payroll = payrollOf(state, club.id);
  const total = Math.max(0, plan.income - plan.costs - plan.principal + FINANCE.reserveRelease * (fin.balance - reserveOf(state, club)));
  // 契約満了で選手が抜けた分は、前の年に払った年俸まで埋められる（毎年ふくらまないように、今の年俸の1.05倍とどちらか大きいほう。フェーズ4-A）
  const lastYear = fin.history.find((h) => h.year === year - 1)?.ledger.expense.wages ?? 0;
  const base = Math.max(payroll * FINANCE.wageBudgetHeadroom, lastYear);
  const wages = Math.min(total, base);
  const roundedTotal = roundTo(total, 1e7);
  const roundedWages = Math.min(roundedTotal, roundTo(wages, 1e7));
  return { year, total: roundedTotal, wages: roundedWages, transfers: roundedTotal - roundedWages, transfersSpent: 0, extra: 0 };
}

/** オーナーに頼めば、今年の予算に足してもらえる残りの額（手元のお金の余裕の半分まで。信頼度が低いと減る） */
export function budgetIncreaseRoom(state: GameState, club: Club): number {
  const spare = club.finance.balance - reserveOf(state, club);
  const trust = isMine(state, club) ? budgetTrustFactor(state.owner?.trust ?? OWNER.startTrust) : 1;
  return Math.max(0, Math.floor((spare * FINANCE.budgetIncreaseShare * trust - club.finance.budget.extra) / 1e7) * 1e7);
}

/** 手元のお金から、年俸予算か移籍予算を増やしてもらう（貯めた黒字を、選手に高い年俸を出すのに使える） */
export function requestBudgetIncrease(state: GameState, clubId: string, amount: number, target: 'wages' | 'transfers'): OwnerAnswer {
  const club = state.clubs[clubId];
  if (!club) return { approved: false, reason: 'クラブが見つかりません。' };
  const room = budgetIncreaseRoom(state, club);
  if (amount <= 0) return { approved: false, reason: '増やす額を決めてください。' };
  if (room <= 0) {
    return {
      approved: false,
      reason: budgetTrustFactor(state.owner?.trust ?? OWNER.startTrust) === 0
        ? '今の成績では、予算を増やすことはできません。まずは結果を出してください。'
        : '手元のお金に余裕がありません。今のお金は、支払いのために残しておきたい。',
    };
  }
  if (amount > room) return { approved: false, reason: `今年、手元のお金から足せるのは${yenText(room)}までです。` };
  const budget = club.finance.budget;
  budget.total += amount;
  budget.extra += amount;
  budget[target] += amount;
  addMessage(state, {
    category: 'finance', from: 'オーナー', important: false,
    subject: `予算を${yenText(amount)}増やしました`,
    body: `手元のお金から${yenText(amount)}を、${target === 'wages' ? '年俸予算' : '移籍予算'}に足しました。\n総予算 ${yenText(budget.total)}（年俸予算 ${yenText(budget.wages)}、移籍予算 ${yenText(budget.transfers)}）`,
  });
  return { approved: true, reason: '' };
}

/** 年俸予算と移籍予算の配分を変える（総予算は変わらない） */
export function setWageBudget(club: Club, wages: number): void {
  const budget = club.finance.budget;
  budget.wages = clamp(roundTo(wages, 1e7), 0, budget.total);
  budget.transfers = budget.total - budget.wages;
}

// ---- スポンサー ----

/** 新しい会社の名前（同じクラブの中で重ならないように） */
function companyName(rng: Rng, club: Club): string {
  const fin = club.finance;
  const used = new Set([...fin.sponsors.flatMap((d) => [d.company, d.next?.company ?? '']), ...fin.sponsorOffers.map((o) => o.company)]);
  for (let i = 0; i < 30; i++) {
    const name = `${rng.chance(0.3) ? club.shortName : rng.pick(SPONSOR_PREFIXES)}${rng.pick(SPONSOR_SUFFIXES)}`;
    if (!used.has(name)) return name;
  }
  return `${rng.pick(SPONSOR_PREFIXES)}${rng.pick(SPONSOR_PREFIXES)}${rng.pick(SPONSOR_SUFFIXES)}`;
}

/** 枠の相場と契約の種類から、年額とボーナスを決める。startYear の1月から始まる */
function makeDeal(club: Club, slot: SponsorDeal['slot'], kind: SponsorDealKind, company: string, startYear: number, noise: number): SponsorDeal {
  const spec = SPONSOR_DEALS[kind];
  const annual = roundTo(sponsorValue(club) * SPONSOR_SLOTS[slot].share * spec.factor * noise, 1e6);
  return { slot, company, kind, annual, endYear: startYear + spec.years - 1, bonus: roundTo(annual * spec.bonus, 1e6) };
}

const dealFromOffer = (offer: SponsorOffer, startYear: number): SponsorDeal => ({
  slot: offer.slot, company: offer.company, kind: offer.kind, annual: offer.annual, endYear: startYear + offer.years - 1, bonus: offer.bonus,
});

function resolveSponsorMessages(state: GameState): void {
  for (const m of state.inbox) if (m.action?.kind === 'sponsorOffer') m.resolved = true;
}

/** 12月1日：自分のクラブの、今年で切れる枠（オフィシャルパートナーを除く）に、3つずつ提案が届く */
export function makeSponsorOffers(state: GameState, rng: Rng): void {
  const club = state.clubs[state.manager.clubId];
  if (!club) return;
  const fin = club.finance;
  const year = yearOf(state.date);
  const ending = fin.sponsors.filter((d) => d.endYear === year && d.slot !== 'partners' && !d.next);
  if (ending.length === 0) return;
  fin.sponsorOffers = [];
  for (const deal of ending) {
    const kinds = (Object.keys(SPONSOR_DEALS) as SponsorDealKind[]).sort(() => rng.next() - 0.5).slice(0, 3);
    kinds.forEach((kind, i) => {
      // 1つ目は、今のスポンサーが続けたいと言ってくることが多い
      const company = i === 0 && rng.chance(0.6) ? deal.company : companyName(rng, club);
      const d = makeDeal(club, deal.slot, kind, company, year + 1, 0.95 + rng.next() * 0.1);
      fin.sponsorOffers.push({ id: `${deal.slot}-${year}-${i}`, slot: deal.slot, company, kind, annual: d.annual, years: SPONSOR_DEALS[kind].years, bonus: d.bonus });
    });
  }
  const slots = ending.map((d) => SPONSOR_SLOTS[d.slot].label);
  addMessage(state, {
    category: 'finance', from: '営業担当', important: true, action: { kind: 'sponsorOffer' }, topic: 'sponsorOffer',
    subject: `スポンサーの提案が届きました（${slots.join('、')}）`,
    body: [
      `今年で契約が切れる枠に、来年からの提案が届いています。12月31日までに選んでください（選ばなければ、標準の契約を結びます）。`,
      ...ending.map((d) => `${SPONSOR_SLOTS[d.slot].label}：今は${d.company}（年額${yenText(d.annual)}）`),
    ].join('\n'),
    lines: [
      '監督、スポンサーの件でご相談です。',
      `${slots.join('、')}の契約が、今年で切れます。`,
      '来年からの提案がいくつか届いています。年額が高い1年の契約や、長く続く契約、成績で上乗せがある契約など、中身はいろいろです。',
      'どの会社と組むか、選んでいただけますか。',
    ],
  });
}

/** 提案を選ぶ。選んだ契約は、今の契約が切れた次の1月から始まる */
export function chooseSponsorOffer(state: GameState, offerId: string): SponsorDeal | null {
  const fin = state.clubs[state.manager.clubId]?.finance;
  const offer = fin?.sponsorOffers.find((o) => o.id === offerId);
  const deal = offer ? fin?.sponsors.find((d) => d.slot === offer.slot) : undefined;
  if (!fin || !offer || !deal) return null;
  deal.next = dealFromOffer(offer, deal.endYear + 1);
  fin.sponsorOffers = fin.sponsorOffers.filter((o) => o.slot !== offer.slot);
  if (fin.sponsorOffers.length === 0) resolveSponsorMessages(state);
  return deal.next;
}

/** 1月1日：切れた契約を、結んである次の契約か、新しい契約に入れ替える。始まった契約を返す */
function renewSponsors(state: GameState, club: Club, year: number, rng: Rng): SponsorDeal[] {
  const fin = club.finance;
  const mine = isMine(state, club);
  const started: SponsorDeal[] = [];
  fin.sponsors = fin.sponsors.map((deal) => {
    if (deal.endYear >= year) return deal;
    let next = deal.next;
    if (!next) {
      // 選ばれなかった提案は、標準の契約にする。AIのクラブは、契約の種類がクラブごとにばらばら
      const offers = mine ? fin.sponsorOffers.filter((o) => o.slot === deal.slot) : [];
      const offer = offers.find((o) => o.kind === 'standard') ?? offers[0];
      next = offer
        ? dealFromOffer(offer, year)
        : makeDeal(club, deal.slot, mine ? 'standard' : rng.pick(Object.keys(SPONSOR_DEALS) as SponsorDealKind[]),
          deal.slot === 'partners' || rng.chance(0.7) ? deal.company : companyName(rng, club), year, 0.95 + rng.next() * 0.1);
    }
    started.push(next);
    return next;
  });
  if (mine) {
    fin.sponsorOffers = [];
    resolveSponsorMessages(state);
  }
  return started;
}

/** 自分のクラブの、新しい年度の始まりの様子（オーナーとの話に使う） */
export interface YearStart {
  /** 新しく始まったスポンサー契約 */
  started: SponsorDeal[];
  /** リーグからの配分を決めた順位（前年の順位、最初の年は評判の順位） */
  position: number;
}

/** 新しい年度の始まり：スポンサー、リーグからの配分、運営費、オーナーの予算。自分のクラブの様子を返す */
export function startYear(state: GameState, year: number, rng: Rng): YearStart | null {
  let mine: YearStart | null = null;
  const last = state.history.find((h) => h.year === year - 1);
  const ranks = reputationRanks(state);
  const count = Object.keys(state.clubs).length;
  for (const club of Object.values(state.clubs)) {
    const fin = club.finance;
    const started = renewSponsors(state, club, year, rng);
    const position = last?.table.find((r) => r.clubId === club.id)?.position ?? ranks.get(club.id) ?? count;
    fin.broadcast = distributionFor(position, count);
    // 運営費は、見込みの収入に合わせて増減する（割合はクラブごとに変わらない）
    fin.operations = roundTo(fin.operationsRate * incomeAndCosts(state, club).income, 1e6);
    fin.budget = ownerBudget(state, club, year);
    if (isMine(state, club)) mine = { started, position };
  }
  return mine;
}

/** 予算のセリフ（オーナーが話す形）。目標と評価の話は owner.ts で前後に足す */
export function budgetLines(state: GameState, club: Club): string[] {
  const fin = club.finance;
  const payroll = payrollOf(state, club.id);
  const last = fin.history.at(-1);
  const net = last ? netResult(last.ledger) : 0;
  return [
    `予算は、総額${yenText(fin.budget.total)}です。年俸予算を${yenText(fin.budget.wages)}、移籍予算を${yenText(fin.budget.transfers)}にしてあります。`,
    payroll > fin.budget.wages
      ? `今の年俸の合計は${yenText(payroll)}で、年俸予算を超えています。契約を更新するときは、年俸を抑えてください。`
      : `今の年俸の合計は${yenText(payroll)}なので、年俸予算にはまだ${yenText(fin.budget.wages - payroll)}の余裕があります。`,
    last ? `昨年は${net >= 0 ? `${yenText(net)}の黒字` : `${yenText(-net)}の赤字`}でした。手元のお金は${yenText(fin.balance)}あります。` : `手元のお金は${yenText(fin.balance)}あります。`,
    budgetIncreaseRoom(state, club) > 0 ? '手元のお金には余裕があるので、良い選手を獲るためなら、もう少し予算に回すこともできます。' : '',
    '年俸と移籍の配分は、財務の画面で変えてかまいません。',
  ].filter((l) => l !== '');
}

/** 予算の知らせの本文（受信箱で読む形） */
export function budgetReport(state: GameState, club: Club, year: number, start: YearStart): string[] {
  const fin = club.finance;
  const payroll = payrollOf(state, club.id);
  const last = fin.history.at(-1);
  const { started, position } = start;
  return [
    `${year}年の予算を決めました。総予算は${yenText(fin.budget.total)}です。`,
    `年俸予算 ${yenText(fin.budget.wages)}（今の年俸の合計は${yenText(payroll)}）`,
    `移籍予算 ${yenText(fin.budget.transfers)}`,
    payroll > fin.budget.wages ? '年俸の合計が年俸予算を超えています。契約の更新では、年俸を抑えることになります。' : '',
    '',
    last ? `${last.year}年の決算：収入 ${yenText(totalIncome(last.ledger))}、支出 ${yenText(totalExpense(last.ledger))}、差し引き ${yenText(netResult(last.ledger))}（${netResult(last.ledger) >= 0 ? '黒字' : '赤字'}）` : '',
    `手元のお金 ${yenText(fin.balance)}${debtOf(fin) > 0 ? `、借り入れの残り ${yenText(debtOf(fin))}` : ''}`,
    `スポンサー：${fin.sponsors.length}社、年額の合計${yenText(sponsorIncome(fin))}`,
    ...started.map((d) => `　新しく始まった契約：${SPONSOR_SLOTS[d.slot].label} ${d.company}（年額${yenText(d.annual)}、${d.endYear}年まで）`),
    `リーグからの配分：年額${yenText(fin.broadcast)}（${state.history.length > 0 ? `前年の${position}位` : `評判の順位${position}位`}に応じた額）`,
    '',
    '年俸予算と移籍予算の配分は、財務の画面で変えられます。',
  ].filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== ''));
}

// ---- 借り入れ ----

/** オーナーへの申し出（借り入れ、予算の増額）への返事 */
export interface OwnerAnswer {
  approved: boolean;
  reason: string;
}
export type LoanAnswer = OwnerAnswer;

/** 借り入れの申請への、オーナーの返事。trust を渡すと、信頼度が低いときは断る */
export function loanDecision(club: Club, amount: number, trust?: number): LoanAnswer {
  const fin = club.finance;
  const limit = FINANCE.loanLimit[club.size];
  const debt = debtOf(fin);
  if (amount <= 0) return { approved: false, reason: '借りる額を決めてください。' };
  if (trust !== undefined && trust < OWNER.loanMinTrust) {
    return { approved: false, reason: '今の成績では、クラブとしてお金を借りる判断はできません。' };
  }
  if (debt + amount > limit) {
    return { approved: false, reason: `借り入れの上限は${yenText(limit)}です（今の残り${yenText(debt)}）。` };
  }
  const last = fin.history.at(-1);
  if (last && netResult(last.ledger) < 0 && debt + amount > limit * 0.5) {
    return { approved: false, reason: '前の年が赤字なので、上限の半分を超える借り入れは認められません。' };
  }
  return { approved: true, reason: '' };
}

/** 借り入れを申請する。認められたら、すぐにお金が入る */
export function requestLoan(state: GameState, clubId: string, amount: number, months: number): LoanAnswer {
  const club = state.clubs[clubId];
  if (!club) return { approved: false, reason: 'クラブが見つかりません。' };
  const answer = loanDecision(club, amount, isMine(state, club) ? state.owner?.trust : undefined);
  if (!answer.approved) return answer;
  const loan = createLoan(club, amount, months, state.date.slice(0, 7), false);
  addMessage(state, {
    category: 'finance', from: 'オーナー', important: false,
    subject: `借り入れを認めました：${yenText(amount)}`,
    body: `${yenText(amount)}の借り入れを認めました。年利${(loan.rate * 100).toFixed(1)}%で、${months}か月で返します（毎月の元金 ${yenText(loan.monthly)}）。\n借り入れが多いと、クラブの評価に響きます。`,
  });
  return answer;
}

/** 残りを一度に返す */
export function repayLoan(state: GameState, clubId: string, loanId: string): boolean {
  const fin = state.clubs[clubId]?.finance;
  const loan = fin?.loans.find((l) => l.id === loanId);
  if (!fin || !loan || fin.balance < loan.remaining) return false;
  fin.balance -= loan.remaining;
  fin.current.financing.repaid += loan.remaining;
  fin.loans = fin.loans.filter((l) => l.id !== loanId);
  return true;
}

// ---- シーズンの終わり ----

/** 賞金を払い、成績に応じて評判とファンの数を変える（12月10日、シーズンの総括で） */
export function seasonEndMoney(state: GameState, table: readonly { clubId: string; position: number }[]): void {
  const ranks = reputationRanks(state);
  for (const row of table) {
    const club = state.clubs[row.clubId];
    if (!club) continue;
    const prize = FINANCE.prize[row.position - 1] ?? 0;
    if (prize > 0) earn(club.finance, 'prize', prize);
    // 成績連動のスポンサー契約の上乗せ
    const bonus = row.position <= FINANCE.sponsorBonusPosition
      ? club.finance.sponsors.reduce((n, d) => n + d.bonus, 0) : 0;
    if (bonus > 0) earn(club.finance, 'sponsor', bonus);
    const expected = ranks.get(club.id) ?? 9;
    const before = club.reputation;
    const change = clamp((expected - row.position) * FINANCE.reputationPerRank, -4, 4)
      + (row.position === 1 ? FINANCE.reputationChampion : 0)
      + (REPUTATION_BASE[club.size] - club.reputation) * FINANCE.reputationReversion;
    club.reputation = Math.round(clamp(club.reputation + change, 1, 100));
    club.fans = Math.round(club.fans * (1 + clamp((expected - row.position) * 0.004, -0.04, 0.05)) / 1000) * 1000;
    if (isMine(state, club)) {
      addMessage(state, {
        category: 'finance', from: '経理担当', important: false,
        subject: prize > 0 ? `賞金 ${yenText(prize)}が入りました` : 'シーズンの成績と、クラブの評判',
        body: [
          prize > 0 ? `${row.position}位の賞金として、${yenText(prize)}が入りました。` : '',
          bonus > 0 ? `成績連動のスポンサー契約から、上乗せの${yenText(bonus)}が入りました。` : '',
          `クラブの評判：${before} → ${club.reputation}（評判が高いほど、スポンサーの条件と観客が良くなります）`,
          `ファンの数：約${club.fans.toLocaleString('ja-JP')}人`,
        ].filter((l) => l !== '').join('\n'),
      });
    }
  }
}

// ---- 契約の更新 ----

/**
 * 契約を更新するときの年俸の倍率。年俸予算から、続く契約の年俸を引いた残りに収まるように、相場から下げる。
 * continuing は来年も続く契約の年俸の合計、market は更新する選手の相場の年俸の合計。
 */
export function renewalFactor(club: Club, continuing: number, market: number): number {
  if (market <= 0) return 1;
  const [lo, hi] = FINANCE.renewalFactorRange;
  return clamp((club.finance.budget.wages - continuing) / market, lo, hi);
}

// ---- 日付が変わったとき ----

/** advanceDay が、シーズンの出来事の前に呼ぶ：月の初めに前の月を、1月1日に前の年度を締める */
export function financeBeforeEvents(state: GameState): void {
  if (!state.date.endsWith('-01')) return;
  const previous = addMonths(state.date.slice(0, 7), -1);
  closeMonth(state, previous);
  if (monthDay(state.date) === '01-01') closeYear(state, yearOf(previous));
}

/**
 * advanceDay が、シーズンの出来事の後に呼ぶ：1月1日に新しい年度を始める（引退した選手が去った後の年俸で予算を決める）。
 * 年度を始めた日は、自分のクラブの様子を返す（オーナーとの話に使う）
 */
export function financeAfterEvents(state: GameState, rng: Rng): YearStart | null {
  if (monthDay(state.date) === '12-01') makeSponsorOffers(state, rng);
  return monthDay(state.date) === '01-01' ? startYear(state, yearOf(state.date), rng) : null;
}

// ---- 新しいゲーム ----

/** 中身が空のお金（クラブを作るときの仮の値。initFinances で決め直す） */
export function emptyFinance(): ClubFinance {
  return {
    balance: 0,
    current: emptyLedger(),
    months: [],
    history: [],
    sponsors: [],
    sponsorOffers: [],
    localStrength: 1,
    broadcast: 0,
    operations: 0,
    operationsRate: 0,
    ticketPrices: { goal: 0, back: 0, main: 0, vip: 0 },
    budget: { year: 0, total: 0, wages: 0, transfers: 0, transfersSpent: 0, extra: 0 },
    loans: [],
    loanCount: 0,
  };
}

/** クラブのお金の初期値（予算は initFinances で決める） */
export function createFinance(rng: Rng, club: Club, position: number, clubs: number): ClubFinance {
  const [lo, hi] = FINANCE.startingBalance[club.size];
  const fin = emptyFinance();
  fin.balance = roundTo(lo + rng.next() * (hi - lo), 1e7);
  fin.localStrength = 0.85 + rng.next() * 0.3;
  fin.broadcast = distributionFor(position, clubs);
  club.finance = fin;
  fin.ticketPrices = defaultTicketPrices(club);
  return fin;
}

/**
 * 全クラブのお金を用意する（新しいゲームと、古いセーブデータの変換で）。
 * janFirst を渡すと、その年の1月の分を締めた状態から始める（ゲームは開幕の1週間前から始まるため）。
 */
export function initFinances(state: GameState, rng: Rng, year: number, janFirst: boolean): void {
  const ranks = reputationRanks(state);
  const count = Object.keys(state.clubs).length;
  for (const club of Object.values(state.clubs)) {
    const fin = createFinance(rng, club, ranks.get(club.id) ?? count, count);
    // スポンサーは枠ごとに、切れる年をばらけさせる（毎年どこかの枠を結び直す）
    for (const slot of SPONSOR_SLOT_ORDER) {
      const company = slot === 'partners' ? `地元企業など${rng.int(18, 45)}社` : companyName(rng, club);
      const deal = makeDeal(club, slot, 'standard', company, year, 0.95 + rng.next() * 0.1);
      fin.sponsors.push({ ...deal, endYear: year + rng.int(0, 2) });
    }
    fin.operations = roundTo(initialOperations(state, club), 1e6);
    fin.operationsRate = fin.operations / Math.max(1, incomeAndCosts(state, club).income);
    fin.budget = ownerBudget(state, club, year);
  }
  if (janFirst) closeMonth(state, `${year}-01`, false);
}

/** 新しいゲームの始まりの様子（オーナーとの最初の話に使う） */
export function firstYearStart(state: GameState): YearStart {
  return { started: [], position: reputationRanks(state).get(state.manager.clubId) ?? 9 };
}
