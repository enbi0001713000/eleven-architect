// フェーズ3-A のお金のテスト（収入と支出、チケットと観客、月と年度の締め、予算、借り入れ、古いセーブの変換）

import { describe, expect, it } from 'vitest';
import { simulateMatch } from '../src/engine/match';
import type { MatchResult } from '../src/engine/types';
import {
  budgetIncreaseRoom, chooseSponsorOffer, debtOf, expectedGate, gateFor, listPrice, loanDecision, netResult, payrollOf, renewalFactor,
  repayLoan, requestBudgetIncrease, requestLoan, seasonEndMoney, setWageBudget, sponsorIncome, totalIncome, yearToDate,
} from '../src/game/finance';
import { FINANCE, SEAT_KINDS } from '../src/game/financeBalance';
import { advanceDay, todaysFixture } from '../src/game/progress';
import { parseSaveFile, toSaveFile } from '../src/game/save';
import { applyMatchday, prepareMatchday } from '../src/game/season';
import type { GameState } from '../src/game/types';
import { createWorld, startNewGame } from '../src/game/world';

function newGame(seed = 21): GameState {
  const world = createWorld(seed);
  return startNewGame(world, 'テスト監督', Object.keys(world.clubs)[0]!);
}

function playToday(state: GameState): void {
  const results: Record<string, MatchResult> = {};
  for (const m of prepareMatchday(state)) {
    results[m.fixture.id] = simulateMatch(m.home, m.away, { seed: m.seed, detailedCommentary: false, important: m.important });
  }
  applyMatchday(state, results);
}

describe('新しいゲームのお金', () => {
  it('どのクラブもお金と予算を持ち、1月の分は締めてある', () => {
    const state = newGame();
    for (const club of Object.values(state.clubs)) {
      const fin = club.finance;
      expect(fin.balance).toBeGreaterThan(0);
      expect(fin.sponsors.map((d) => d.slot)).toEqual(['shirt', 'back', 'sleeve', 'shorts', 'stadium', 'partners']);
      expect(new Set(fin.sponsors.map((d) => d.company)).size).toBe(6);
      expect(fin.broadcast).toBeGreaterThanOrEqual(FINANCE.broadcastBase);
      expect(fin.months.map((m) => m.month)).toEqual(['2027-01']);
      expect(fin.budget.year).toBe(2027);
      expect(fin.budget.wages + fin.budget.transfers).toBe(fin.budget.total);
      // 1月の年俸は、1年分の12分の1
      expect(fin.months[0]!.ledger.expense.wages).toBeCloseTo(payrollOf(state, club.id) / 12, -1);
    }
    // 規模が大きいほど、スポンサーと観客が多い
    const bySize = (size: string) => Object.values(state.clubs).filter((c) => c.size === size);
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean(bySize('large').map((c) => sponsorIncome(c.finance)))).toBeGreaterThan(mean(bySize('small').map((c) => sponsorIncome(c.finance))) * 2);
    expect(mean(bySize('large').map((c) => expectedGate(c).total))).toBeGreaterThan(mean(bySize('small').map((c) => expectedGate(c).total)) * 1.8);
    // オーナーからの予算の知らせが届いている
    expect(state.inbox.some((m) => m.topic === 'budget' && m.subject.includes('予算'))).toBe(true);
  });
});

describe('チケットと観客', () => {
  it('値上げすると観客が減り、値下げすると増える。収容人数は超えない', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    const list = club.finance.ticketPrices;
    const scaled = (f: number) => Object.fromEntries(SEAT_KINDS.map((s) => [s, list[s] * f])) as typeof list;
    const normal = expectedGate(club, list);
    expect(expectedGate(club, scaled(1.5)).total).toBeLessThan(normal.total);
    expect(expectedGate(club, scaled(0.7)).total).toBeGreaterThanOrEqual(normal.total);
    const crowd = gateFor(club, list, club.stadium.capacity * 5);
    expect(crowd.total).toBeLessThanOrEqual(club.stadium.capacity);
    expect(crowd.fill).toBeGreaterThan(0.99);
    expect(listPrice(club, 'vip')).toBeGreaterThan(listPrice(club, 'goal'));
  });

  it('ホームゲームの日に、入場料とグッズの収入と、試合の運営費が入る', () => {
    const state = newGame();
    while (!todaysFixture(state)) advanceDay(state);
    const before = Object.fromEntries(Object.values(state.clubs).map((c) => [c.id, structuredClone(c.finance.current)]));
    playToday(state);
    const played = state.fixtures.filter((f) => f.round === 1);
    for (const f of played) {
      const home = state.clubs[f.homeId]!;
      const away = state.clubs[f.awayId]!;
      expect(f.result?.attendance).toBeGreaterThan(0);
      expect(f.result!.attendance!).toBeLessThanOrEqual(home.stadium.capacity);
      expect(home.finance.current.income.tickets).toBeGreaterThan(before[home.id]!.income.tickets);
      expect(home.finance.current.expense.matchday).toBeGreaterThan(before[home.id]!.expense.matchday);
      // アウェイのクラブには入場料は入らない
      expect(away.finance.current.income.tickets).toBe(before[away.id]!.income.tickets);
    }
  });
});

describe('月と年度の締め', () => {
  it('月が変わると前の月が締められ、毎月の知らせが届く', () => {
    const state = newGame();
    while (state.date < '2027-03-01') {
      if (todaysFixture(state)) playToday(state);
      else advanceDay(state);
    }
    const fin = state.clubs[state.manager.clubId]!.finance;
    expect(fin.months.map((m) => m.month)).toEqual(['2027-01', '2027-02']);
    const feb = fin.months[1]!.ledger;
    expect(feb.income.sponsor).toBeCloseTo(sponsorIncome(fin) / 12, -1);
    expect(feb.expense.operations).toBeCloseTo(fin.operations / 12, -1);
    expect(state.inbox.some((m) => m.subject.startsWith('2月の収支'))).toBe(true);
    expect(totalIncome(yearToDate(fin))).toBeGreaterThan(totalIncome(feb));
  });

  it('1月1日に年度が締められ、新しい年の予算とリーグからの配分が決まる', () => {
    const state = newGame();
    state.date = '2027-12-31';
    advanceDay(state);
    for (const club of Object.values(state.clubs)) {
      const fin = club.finance;
      expect(fin.history.map((h) => h.year)).toEqual([2027]);
      expect(fin.months).toEqual([]);
      expect(fin.budget.year).toBe(2028);
      expect(club.revenue).toBe(totalIncome(fin.history[0]!.ledger));
    }
    expect(state.inbox.some((m) => m.subject === '2028年の目標と予算')).toBe(true);
  });
});

describe('予算', () => {
  it('年俸予算と移籍予算の配分を変えても、総予算は変わらない', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    const total = club.finance.budget.total;
    setWageBudget(club, total * 0.6);
    expect(club.finance.budget.wages + club.finance.budget.transfers).toBe(total);
    setWageBudget(club, total * 2);
    expect(club.finance.budget.wages).toBe(total);
    expect(club.finance.budget.transfers).toBe(0);
  });

  it('年俸予算が足りないと、契約の更新で年俸を下げる（予算に余裕があっても相場より上げない）', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    club.finance.budget.wages = 10e8;
    expect(renewalFactor(club, 9e8, 2e8)).toBeCloseTo(FINANCE.renewalFactorRange[0]);
    expect(renewalFactor(club, 8.5e8, 1.5e8)).toBeCloseTo(1);
    expect(renewalFactor(club, 2e8, 1e8)).toBe(1);
  });
});

describe('スポンサー', () => {
  it('12月1日に、今年で切れる枠へ提案が届く。選んだ契約は1月から始まり、選ばなかった枠は標準の契約になる', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    const fin = club.finance;
    // 胸と背中を今年で切れるようにする
    for (const d of fin.sponsors) d.endYear = d.slot === 'shirt' || d.slot === 'back' ? 2027 : 2029;
    state.date = '2027-11-30';
    advanceDay(state);
    expect(new Set(fin.sponsorOffers.map((o) => o.slot))).toEqual(new Set(['shirt', 'back']));
    expect(fin.sponsorOffers.filter((o) => o.slot === 'shirt')).toHaveLength(3);
    const message = state.inbox.find((m) => m.topic === 'sponsorOffer');
    expect(message?.important).toBe(true);
    const pick = fin.sponsorOffers.find((o) => o.slot === 'shirt')!;
    const signed = chooseSponsorOffer(state, pick.id)!;
    expect(signed.company).toBe(pick.company);
    expect(signed.endYear).toBe(2027 + pick.years);
    expect(fin.sponsorOffers.every((o) => o.slot === 'back')).toBe(true);
    state.date = '2027-12-31';
    advanceDay(state);
    const shirt = fin.sponsors.find((d) => d.slot === 'shirt')!;
    const back = fin.sponsors.find((d) => d.slot === 'back')!;
    expect(shirt.company).toBe(pick.company);
    expect(back.kind).toBe('standard');
    expect(back.endYear).toBe(2029);
    expect(fin.sponsorOffers).toEqual([]);
    expect(message?.resolved).toBe(true);
  });

  it('成績連動の契約は、3位以内に入った年に上乗せがある', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    const deal = club.finance.sponsors[0]!;
    deal.kind = 'performance';
    deal.bonus = 2e8;
    const before = club.finance.current.income.sponsor;
    seasonEndMoney(state, [{ clubId: club.id, position: 2 }]);
    expect(club.finance.current.income.sponsor).toBe(before + 2e8);
  });
});

describe('予算の増額', () => {
  it('手元のお金に余裕があれば、オーナーが年俸予算や移籍予算を増やしてくれる。余裕を超える額は断られる', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    club.finance.balance = 50e8;
    const room = budgetIncreaseRoom(state, club);
    expect(room).toBeGreaterThan(0);
    expect(requestBudgetIncrease(state, club.id, room + 1e8, 'wages').approved).toBe(false);
    const wages = club.finance.budget.wages;
    const total = club.finance.budget.total;
    expect(requestBudgetIncrease(state, club.id, 2e8, 'wages').approved).toBe(true);
    expect(club.finance.budget.wages).toBe(wages + 2e8);
    expect(club.finance.budget.total).toBe(total + 2e8);
    expect(budgetIncreaseRoom(state, club)).toBe(room - 2e8);
    club.finance.balance = 0;
    expect(requestBudgetIncrease(state, club.id, 1e8, 'transfers').approved).toBe(false);
  });
});

describe('借り入れ', () => {
  it('上限までなら認められ、毎月返していく。残りは一度に返せる', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    const limit = FINANCE.loanLimit[club.size];
    expect(loanDecision(club, limit + 1e8).approved).toBe(false);
    const balance = club.finance.balance;
    expect(requestLoan(state, club.id, 2e8, 12).approved).toBe(true);
    expect(club.finance.balance).toBe(balance + 2e8);
    expect(debtOf(club.finance)).toBe(2e8);
    while (state.date < '2027-04-01') {
      if (todaysFixture(state)) playToday(state);
      else advanceDay(state);
    }
    const loan = club.finance.loans[0]!;
    expect(loan.remaining).toBeLessThan(2e8);
    expect(club.finance.months.some((m) => m.ledger.expense.interest > 0)).toBe(true);
    expect(repayLoan(state, club.id, loan.id)).toBe(true);
    expect(debtOf(club.finance)).toBe(0);
  });

  it('手元のお金がマイナスになったら、緊急の借り入れとオーナーのお金で埋める（破産はしない）', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    club.finance.balance = -FINANCE.loanLimit[club.size] * 1.5;
    state.date = '2027-02-28';
    advanceDay(state);
    const march = club.finance.months.at(-1)!;
    expect(march.month).toBe('2027-02');
    expect(club.finance.balance).toBeGreaterThanOrEqual(0);
    expect(club.finance.loans.some((l) => l.emergency)).toBe(true);
    expect(march.ledger.financing.owner).toBeGreaterThan(0);
    expect(state.inbox.some((m) => m.subject === '手元のお金が足りなくなりました')).toBe(true);
  });
});

describe('古いセーブデータ（版2）', () => {
  it('フェーズ2のセーブデータを読み込むと、お金が足され、年俸が計算し直される', () => {
    const state = newGame();
    const v2 = structuredClone(state) as unknown as Record<string, unknown>;
    for (const c of Object.values(v2.clubs as Record<string, Record<string, unknown>>)) delete c.finance;
    v2.version = 2;
    const loaded = parseSaveFile(JSON.stringify({ ...toSaveFile(state), version: 2, state: v2 }));
    expect(loaded.version).toBe(7);
    for (const club of Object.values(loaded.clubs)) {
      expect(club.finance.budget.total).toBeGreaterThan(0);
      expect(club.finance.months).toEqual([]);
    }
    expect(loaded.inbox.map((m) => m.category)).toEqual(expect.arrayContaining(['finance']));
    // 変換したデータでそのまま遊べ、ホームゲームでお金が入る
    while (!todaysFixture(loaded)) advanceDay(loaded);
    playToday(loaded);
    expect(Object.values(loaded.clubs).some((c) => c.finance.current.income.tickets > 0)).toBe(true);
    expect(netResult(loaded.clubs[loaded.manager.clubId]!.finance.current)).not.toBeNaN();
  });
});
