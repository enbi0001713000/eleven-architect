// フェーズ3-B のオーナーの評価のテスト（目標、信頼度、警告、解任、目標の話し合い、古いセーブの変換）

import { describe, expect, it } from 'vitest';
import { simulateMatch } from '../src/engine/match';
import type { MatchResult } from '../src/engine/types';
import { budgetIncreaseRoom, loanDecision, reputationRanks } from '../src/game/finance';
import { canNegotiate, isDismissed, negotiateGoal, positionGoalFor } from '../src/game/owner';
import { OWNER } from '../src/game/ownerBalance';
import { advanceDay, advanceToNextEvent, todaysFixture } from '../src/game/progress';
import { parseSaveFile, toSaveFile } from '../src/game/save';
import { applyMatchday, prepareMatchday } from '../src/game/season';
import type { GameState } from '../src/game/types';
import { createWorld, startNewGame } from '../src/game/world';

function newGame(seed = 33, index = 0): GameState {
  const world = createWorld(seed);
  return startNewGame(world, 'テスト監督', Object.keys(world.clubs)[index]!);
}

/** 自分のクラブの試合を、決まったスコアにして進める（ほかの試合はふつうに計算する） */
function playToday(state: GameState, myScore?: [number, number]): void {
  const myId = state.manager.clubId;
  const results: Record<string, MatchResult> = {};
  for (const m of prepareMatchday(state)) {
    const result = simulateMatch(m.home, m.away, { seed: m.seed, detailedCommentary: false, important: m.important });
    if (myScore && (m.fixture.homeId === myId || m.fixture.awayId === myId)) {
      result.score = m.fixture.homeId === myId ? [myScore[0], myScore[1]] : [myScore[1], myScore[0]];
    }
    results[m.fixture.id] = result;
  }
  applyMatchday(state, results);
}

/** 指定の日まで、自分の試合は決まったスコアで進める */
function playUntil(state: GameState, date: string, myScore?: [number, number]): void {
  while (state.date < date && !isDismissed(state)) {
    if (todaysFixture(state)) playToday(state, myScore);
    else advanceDay(state);
  }
}

describe('オーナーの目標', () => {
  it('評判と戦力が高いクラブほど、高い順位を求められる。最初の話（目標と予算）が届いている', () => {
    const state = newGame();
    const ranks = reputationRanks(state);
    const top = [...ranks].find(([, r]) => r === 1)![0];
    const bottom = [...ranks].find(([, r]) => r === 18)![0];
    expect(positionGoalFor(state, top)).toBeLessThanOrEqual(3);
    expect(positionGoalFor(state, bottom)).toBeGreaterThanOrEqual(15);
    expect(state.owner.trust).toBe(OWNER.startTrust);
    expect(state.owner.goals.year).toBe(state.season.year);
    const talk = state.inbox.find((m) => m.topic === 'budget');
    expect(talk?.subject).toContain('目標と予算');
    expect(talk?.lines?.some((l) => l.includes('今シーズンの目標'))).toBe(true);
  });

  it('目標は開幕までに1回だけ話し合える。下げると予算が減り、上げると増える', () => {
    const state = newGame(33, 5);
    const budget = state.clubs[state.manager.clubId]!.finance.budget;
    const total = budget.total;
    const goal = state.owner.goals.position;
    expect(canNegotiate(state)).toBe(true);
    const answer = negotiateGoal(state, 'lower');
    expect(answer.ok).toBe(true);
    expect(state.owner.goals.position).toBeGreaterThan(goal);
    expect(budget.total).toBeLessThan(total);
    expect(state.owner.trust).toBeLessThan(OWNER.startTrust);
    expect(canNegotiate(state)).toBe(false);
    expect(negotiateGoal(state, 'higher').ok).toBe(false);

    const other = newGame(33, 6);
    const before = other.clubs[other.manager.clubId]!.finance.budget.total;
    if (other.owner.goals.position > 1) {
      expect(negotiateGoal(other, 'higher').ok).toBe(true);
      expect(other.clubs[other.manager.clubId]!.finance.budget.total).toBeGreaterThan(before);
    }
  });

  it('開幕したあとは、目標を話し合えない', () => {
    const state = newGame();
    while (!todaysFixture(state)) advanceDay(state);
    playToday(state);
    expect(canNegotiate(state)).toBe(false);
  });
});

describe('信頼度と解任', () => {
  it('負け続けると信頼度が下がって警告が届き、とても低くなるとシーズン中に解任される', () => {
    // 目標が10位以内より上のクラブで試す
    const world = createWorld(33);
    const clubId = Object.keys(world.clubs).find((id) => positionGoalFor(world, id) <= 10)!;
    const state = startNewGame(world, 'テスト監督', clubId);
    playUntil(state, '2027-12-01', [0, 3]);
    expect(state.inbox.some((m) => m.topic === 'ownerWarning')).toBe(true);
    expect(isDismissed(state)).toBe(true);
    expect(state.inbox.some((m) => m.topic === 'dismissal')).toBe(true);
    expect(state.season.round).toBeGreaterThan(OWNER.dismissFromRound);
    // 解任されたら、「次の出来事まで進める」は止まる
    expect(advanceToNextEvent(state).reason).toBe('dismissed');
  });

  it('勝ち続けると信頼度が上がり、シーズンの評価で目標の達成をほめられる', () => {
    const state = newGame();
    playUntil(state, '2028-01-02', [3, 0]);
    expect(isDismissed(state)).toBe(false);
    const evaluation = state.owner.evaluations.find((e) => e.year === 2027)!;
    expect(evaluation.position).toBe(1);
    expect(['met', 'exceeded']).toContain(evaluation.verdict);
    expect(state.owner.trust).toBeGreaterThan(OWNER.startTrust);
    expect(state.owner.goals.year).toBe(2028);
    const talk = state.inbox.find((m) => m.subject === '2028年の目標と予算');
    expect(talk?.lines?.some((l) => l.includes('昨シーズンの評価'))).toBe(true);
  });

  it('信頼度が低いと、予算の増額も借り入れも認められない', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    club.finance.balance = 80e8;
    expect(budgetIncreaseRoom(state, club)).toBeGreaterThan(0);
    state.owner.trust = 20;
    expect(budgetIncreaseRoom(state, club)).toBe(0);
    expect(loanDecision(club, 1e8, state.owner.trust).approved).toBe(false);
    expect(loanDecision(club, 1e8, 70).approved).toBe(true);
  });
});

describe('古いセーブデータ（版3）', () => {
  it('フェーズ3-Aのセーブデータを読み込むと、オーナーの目標と信頼度が足される', () => {
    const state = newGame();
    const v3 = structuredClone(state) as unknown as Record<string, unknown>;
    delete v3.owner;
    v3.version = 3;
    const loaded = parseSaveFile(JSON.stringify({ ...toSaveFile(state), version: 3, state: v3 }));
    expect(loaded.version).toBe(5);
    expect(loaded.owner.trust).toBe(OWNER.startTrust);
    expect(loaded.owner.goals.year).toBe(loaded.season.year);
    while (!todaysFixture(loaded)) advanceDay(loaded);
    playToday(loaded);
    expect(loaded.season.round).toBe(2);
  });
});
