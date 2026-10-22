// フェーズ4-B の移籍のテスト（移籍期間、売る側の希望の額、申し込みと返事、違約金、他クラブからの申し込み、海外への移籍、レンタル、
// AIクラブ同士の移籍、古いセーブ）

import { describe, expect, it } from 'vitest';
import { simulateMatch } from '../src/engine/match';
import { overallRating } from '../src/engine/ratings';
import { createRng } from '../src/engine/rng';
import type { MatchResult } from '../src/engine/types';
import { CONTRACT } from '../src/game/contractBalance';
import { deservedRole, marketValue, maxYears, neededSalary, offerContract, type ContractOffer } from '../src/game/contracts';
import { payrollOf } from '../src/game/finance';
import { advanceDay, todaysFixture } from '../src/game/progress';
import { parseSaveFile, toSaveFile } from '../src/game/save';
import { applyMatchday, prepareMatchday } from '../src/game/season';
import { TRANSFER } from '../src/game/transferBalance';
import {
  acceptIncoming, askingFee, bidProblem, loanable, nextWindowStart, OVERSEAS, placeBid, rejectIncoming, startLoan, transferBudgetLeft, windowOpen,
} from '../src/game/transfers';
import type { GameState, PlayerRecord, TransferBid } from '../src/game/types';
import { createWorld, startNewGame } from '../src/game/world';

function newGame(seed = 51, index = 4): GameState {
  const world = createWorld(seed);
  return startNewGame(world, 'テスト監督', Object.keys(world.clubs)[index]!);
}

function playUntil(state: GameState, date: string): void {
  while (state.date < date) {
    if (todaysFixture(state)) {
      const results: Record<string, MatchResult> = {};
      for (const m of prepareMatchday(state)) results[m.fixture.id] = simulateMatch(m.home, m.away, { seed: m.seed, detailedCommentary: false });
      applyMatchday(state, results);
    } else {
      advanceDay(state);
    }
  }
}

const clubPlayers = (state: GameState, clubId: string): PlayerRecord[] =>
  state.clubs[clubId]!.playerIds.map((id) => state.players[id]!).sort((a, b) => overallRating(b) - overallRating(a));

function fairOffer(state: GameState, player: PlayerRecord, clubId: string): ContractOffer {
  const offer: ContractOffer = {
    salary: 0, role: deservedRole(state, player, clubId), years: Math.min(maxYears(player), CONTRACT.preferredYears(player.age)),
    clauseMultiple: CONTRACT.defaultClause, bonus: { appearance: 0, goal: 0 },
  };
  return { ...offer, salary: neededSalary(state, player, clubId, 'signing', offer).salary };
}

/** 自分のクラブの予算を、移籍に十分な額にする */
function richBudget(state: GameState): void {
  const budget = state.clubs[state.manager.clubId]!.finance.budget;
  budget.transfers = 30e8;
  budget.wages += 10e8;
}

/** 移籍リストに載っていない、売る側が売ってもよい他クラブの選手 */
function sellable(state: GameState): PlayerRecord {
  const myId = state.manager.clubId;
  return Object.values(state.players).find((p) => p.clubId && p.clubId !== myId && p.contract && !p.loan && p.age <= 28
    && askingFee(state, p, p.clubId).fee !== null && overallRating(p) >= 12)!;
}

describe('移籍期間', () => {
  it('冬は1月5日〜3月27日、夏は7月15日〜8月15日。期間の外なら次の初日', () => {
    expect(windowOpen('2027-01-05')).toBe(true);
    expect(windowOpen('2027-03-28')).toBe(false);
    expect(windowOpen('2027-08-15')).toBe(true);
    expect(nextWindowStart('2027-04-10')).toBe('2027-07-15');
    expect(nextWindowStart('2027-09-01')).toBe('2028-01-05');
    expect(nextWindowStart('2027-02-01')).toBe('2027-02-01');
  });
});

describe('売る側の希望の額', () => {
  it('主力は市場価値より高く、移籍リストの選手は安い。そのポジションの選手が足りなければ売らない', () => {
    const state = newGame();
    const other = Object.keys(state.clubs).find((id) => id !== state.manager.clubId)!;
    const players = clubPlayers(state, other);
    const key = players.find((p) => p.contract!.role === 'key' && askingFee(state, p, other).fee !== null)!;
    const value = marketValue(key, state.season.year);
    expect(askingFee(state, key, other).fee!).toBeGreaterThan(value);
    key.listed = 'sale';
    expect(askingFee(state, key, other).fee!).toBeLessThan(value);
    key.listed = null;
    // GKを1人だけにすると、そのGKは売らない
    const keepers = players.filter((p) => p.position === 'GK');
    for (const k of keepers.slice(1)) k.position = 'CB';
    expect(askingFee(state, keepers[0]!, other).fee).toBeNull();
  });
});

describe('移籍金の申し込み', () => {
  it('移籍予算を超える額は出せない。希望の額以上なら受けてもらえ、選手と契約すると移籍期間に加入して、移籍金が動く', () => {
    const state = newGame();
    const myId = state.manager.clubId;
    const target = sellable(state);
    const sellerId = target.clubId!;
    const ask = askingFee(state, target, sellerId).fee!;
    expect(bidProblem(state, target.id, { kind: 'transfer', fee: transferBudgetLeft(state.clubs[myId]!) + 1e8, wageShare: 1 })).toContain('移籍予算');
    richBudget(state);
    const placed = placeBid(state, target.id, { kind: 'transfer', fee: ask, wageShare: 1 });
    expect(placed.ok).toBe(true);
    // 返事が来るまで進める（開幕前なので、移籍期間の中）
    playUntil(state, placed.bid!.due);
    expect(state.bids.find((b) => b.id === placed.bid!.id)!.status).toBe('accepted');
    const sellerBefore = state.clubs[sellerId]!.finance.current.income.transfers;
    const answer = offerContract(state, target.id, fairOffer(state, target, myId));
    expect(answer.verdict).toBe('accept');
    expect(windowOpen(state.date)).toBe(true);
    expect(target.clubId).toBe(myId);
    expect(state.clubs[myId]!.finance.current.expense.transfers).toBe(ask);
    expect(state.clubs[sellerId]!.finance.current.income.transfers - sellerBefore).toBe(ask);
    expect(state.transferHistory[0]).toMatchObject({ playerId: target.id, fromClubId: sellerId, toClubId: myId, fee: ask, kind: 'transfer' });
  });

  it('希望より少し低いと額を返してくる。期間の外で合意すると、次の移籍期間の初日に加入する', () => {
    const state = newGame();
    const myId = state.manager.clubId;
    richBudget(state);
    playUntil(state, `${state.season.year}-04-01`);
    const target = sellable(state);
    const ask = askingFee(state, target, target.clubId!).fee!;
    const placed = placeBid(state, target.id, { kind: 'transfer', fee: Math.round(ask * 0.85), wageShare: 1 });
    playUntil(state, placed.bid!.due);
    const bid = state.bids.find((b) => b.id === placed.bid!.id)!;
    expect(bid.status).toBe('countered');
    expect(bid.counter).toBe(ask);
    bid.status = 'accepted';
    bid.fee = ask;
    bid.due = `${state.season.year}-12-31`;
    expect(offerContract(state, target.id, fairOffer(state, target, myId)).verdict).toBe('accept');
    expect(bid.status).toBe('agreed');
    expect(target.clubId).not.toBe(myId);
    playUntil(state, `${state.season.year}-07-16`);
    expect(target.clubId).toBe(myId);
  }, 60000);

  it('違約金を払うと、クラブは断れず、すぐに選手と話せる', () => {
    const state = newGame();
    richBudget(state);
    const target = Object.values(state.players).find((p) => p.clubId && p.clubId !== state.manager.clubId && p.contract?.releaseClause)!;
    const placed = placeBid(state, target.id, { kind: 'clause', fee: 0, wageShare: 1 });
    expect(placed.bid!.status).toBe('accepted');
    expect(placed.bid!.fee).toBe(target.contract!.releaseClause);
  });
});

describe('他クラブと海外からの申し込み', () => {
  function incoming(state: GameState, player: PlayerRecord, buyerId: string, fee: number): TransferBid {
    const bid: TransferBid = {
      id: `b${state.nextBidNumber++}`, kind: buyerId === OVERSEAS ? 'overseas' : 'transfer', playerId: player.id, sellerId: state.manager.clubId,
      buyerId, fee, wageShare: 1, status: 'waiting', date: state.date, due: state.date, counter: null, contract: null, rounds: 0, note: '',
    };
    state.bids.push(bid);
    return bid;
  }

  it('海外への移籍を受けると、移籍期間に選手が去って移籍金が入る。断るとモラルが下がる', () => {
    const state = newGame();
    const [a, b] = clubPlayers(state, state.manager.clubId);
    const accepted = incoming(state, a!, OVERSEAS, 3e8);
    acceptIncoming(state, accepted.id, createRng(1));
    expect(windowOpen(state.date)).toBe(true);
    expect(state.players[a!.id]).toBeUndefined();
    expect(state.clubs[state.manager.clubId]!.finance.current.income.transfers).toBe(3e8);
    const morale = b!.status.morale;
    const refused = incoming(state, b!, OVERSEAS, 3e8);
    rejectIncoming(state, refused.id);
    expect(b!.status.morale).toBe(Math.max(0, morale - TRANSFER.overseasRefuseMorale));
    expect(b!.overseasRefused).toBe(1);
  });
});

describe('レンタル', () => {
  it('借りたクラブで出場し、年俸は割合で分け、12月1日に元のクラブへ戻る', () => {
    const state = newGame();
    const myId = state.manager.clubId;
    const young = clubPlayers(state, myId).reverse().find((p) => p.age <= 23)!;
    const borrower = Object.keys(state.clubs).find((id) => id !== myId)!;
    const before = payrollOf(state, myId);
    startLoan(state, young, borrower, 0.5);
    expect(young.clubId).toBe(borrower);
    expect(state.clubs[borrower]!.playerIds).toContain(young.id);
    expect(payrollOf(state, myId)).toBeCloseTo(before - young.contract!.salary / 2, 0);
    playUntil(state, `${state.season.year}-12-02`);
    expect(young.loan).toBeNull();
    expect(young.clubId).toBe(myId);
  }, 120000);

  it('契約がその年で切れる選手は、レンタルに出してもらえない', () => {
    const state = newGame();
    const young = Object.values(state.players).find((p) => p.clubId && p.clubId !== state.manager.clubId && p.age <= 23 && p.contract?.role === 'youth')!;
    young.contract!.endYear = state.season.year + 1;
    expect(loanable(state, young)).toBe(true);
    young.contract!.endYear = state.season.year;
    expect(loanable(state, young)).toBe(false);
    expect(bidProblem(state, young.id, { kind: 'loan', fee: 0, wageShare: 1 })).toContain('レンタル');
  });
});

describe('AIクラブ同士の移籍', () => {
  it('1シーズンで、移籍金での移籍、海外への移籍、レンタルが起き、どの選手もちょうど1つのクラブにいる', () => {
    const state = newGame(53, 2);
    playUntil(state, `${state.season.year + 1}-02-01`);
    const kinds = new Set(state.transferHistory.map((r) => r.kind));
    expect(kinds.has('transfer')).toBe(true);
    expect(kinds.has('loan')).toBe(true);
    expect(kinds.has('abroad')).toBe(true);
    const seen = new Map<string, string>();
    for (const club of Object.values(state.clubs)) {
      expect(club.playerIds.length).toBeLessThanOrEqual(30);
      for (const id of club.playerIds) {
        expect(seen.has(id)).toBe(false);
        seen.set(id, club.id);
        expect(state.players[id]!.clubId).toBe(club.id);
      }
    }
    for (const p of Object.values(state.players)) if (p.clubId) expect(seen.get(p.id)).toBe(p.clubId);
  }, 120000);
});

describe('古いセーブデータ（版7）', () => {
  it('フェーズ4-Aのセーブデータを読み込むと、移籍の交渉と記録が足される', () => {
    const state = newGame();
    const v7 = structuredClone(state) as unknown as Record<string, unknown>;
    delete v7.bids;
    delete v7.nextBidNumber;
    delete v7.transferHistory;
    v7.version = 7;
    const loaded = parseSaveFile(JSON.stringify({ ...toSaveFile(state), version: 7, state: v7 }));
    expect(loaded.version).toBe(9);
    expect(loaded.bids).toEqual([]);
    expect(loaded.transferHistory).toEqual([]);
    advanceDay(loaded);
  });
});
