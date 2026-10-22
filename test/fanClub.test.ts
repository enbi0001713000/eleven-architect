// フェーズ3.5 のファンクラブのテスト（会員の数、会費の入り方、会費の高さ、イベント、古いセーブの変換）

import { describe, expect, it } from 'vitest';
import { yearToDate } from '../src/game/finance';
import {
  canHoldEvent, decideThanksDay, eventCandidates, feeRevenue, holdEvent, setFee, targetMembers, totalMembers,
} from '../src/game/fanClub';
import { FAN_CLUB } from '../src/game/fanClubBalance';
import { advanceDay, todaysFixture } from '../src/game/progress';
import { parseSaveFile, toSaveFile } from '../src/game/save';
import { applyMatchday, prepareMatchday } from '../src/game/season';
import { simulateMatch } from '../src/engine/match';
import type { GameState } from '../src/game/types';
import { createWorld, startNewGame } from '../src/game/world';

function newGame(seed = 21): GameState {
  const world = createWorld(seed);
  return startNewGame(world, 'テスト監督', Object.keys(world.clubs)[0]!);
}

function playDay(state: GameState): void {
  if (!todaysFixture(state)) {
    advanceDay(state);
    return;
  }
  const results: Record<string, ReturnType<typeof simulateMatch>> = {};
  for (const m of prepareMatchday(state)) results[m.fixture.id] = simulateMatch(m.home, m.away, { seed: m.seed, detailedCommentary: false });
  applyMatchday(state, results);
}

const playUntil = (state: GameState, date: string): void => {
  while (state.date < date) playDay(state);
};

describe('会員と会費', () => {
  it('どのクラブにもファンクラブがあり、会員はファンの数の7%前後。最初の年の会費（1月と2月の分）はもう入っている', () => {
    const state = newGame();
    for (const club of Object.values(state.clubs)) {
      const ratio = totalMembers(club.fanClub.members) / club.fans;
      expect(ratio).toBeGreaterThan(0.06);
      expect(ratio).toBeLessThan(0.08);
      expect(club.fanClub.members.regular).toBeGreaterThan(club.fanClub.members.gold);
      expect(club.fanClub.members.gold).toBeGreaterThan(club.fanClub.members.platinum);
    }
    const club = state.clubs[state.manager.clubId]!;
    expect(yearToDate(club.finance).income.fanClub).toBeGreaterThan(0);
  });

  it('会費を上げると入りたい人が減り、下げると増える。決められる範囲に収まる', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    const base = targetMembers(club, FAN_CLUB.defaultFee);
    const higher = targetMembers(club, { ...FAN_CLUB.defaultFee, regular: 6000 });
    const lower = targetMembers(club, { ...FAN_CLUB.defaultFee, regular: 1500 });
    expect(higher.regular).toBeLessThan(base.regular);
    expect(lower.regular).toBeGreaterThan(base.regular);
    setFee(state, 'gold', 999999);
    expect(club.fanClub.fees.gold).toBe(FAN_CLUB.feeRange.gold[1]);
    setFee(state, 'regular', 3333);
    expect(club.fanClub.fees.regular % FAN_CLUB.feeStep.regular).toBe(0);
  });

  it('11月にファン感謝デーの提案が届き、12月1日に受付が始まり、会費が12月・1月・2月に分けて入る。1月1日に新しい会員になる', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    playUntil(state, '2027-11-01');
    expect(state.inbox.some((m) => m.topic === 'fanThanksDay')).toBe(true);
    decideThanksDay(state, 'large');
    playUntil(state, '2027-12-01');
    const renewal = club.fanClub.renewal!;
    expect(renewal.year).toBe(2028);
    expect(renewal.paid).toBeCloseTo(0.3);
    expect(club.fanClub.events.some((e) => e.kind === 'thanksDay')).toBe(true);
    const planned = totalMembers(renewal.members);
    const revenue = feeRevenue(renewal.members, renewal.fees);
    expect(yearToDate(club.finance).income.fanClub).toBeGreaterThanOrEqual(Math.round(revenue * 0.3) - 10);
    playUntil(state, '2028-01-01');
    expect(totalMembers(club.fanClub.members)).toBe(planned);
    expect(club.fanClub.renewal?.paid).toBeCloseTo(0.7);
    playUntil(state, '2028-02-02');
    expect(club.fanClub.renewal).toBeNull();
    // 1月と2月の分は、2028年の収入
    expect(yearToDate(club.finance).income.fanClub).toBeGreaterThanOrEqual(Math.round(revenue * 0.7) - 10);
  });
});

describe('イベント', () => {
  it('サイン会は選手を呼んで開き、入会が増え、出た選手が少し疲れる。月に1回まで', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    // シーズン中で、今日と明日に試合のない日まで進める
    for (let i = 0; i < 60 && !canHoldEvent(state, 'signing').ok; i++) playDay(state);
    expect(canHoldEvent(state, 'signing').ok).toBe(true);
    const star = eventCandidates(state)[0]!;
    const before = totalMembers(club.fanClub.members);
    const condition = star.status.condition;
    const record = holdEvent(state, 'signing', [star.id]);
    expect(record).not.toBeNull();
    expect(totalMembers(club.fanClub.members)).toBeGreaterThan(before);
    expect(star.status.condition).toBeLessThan(condition);
    const again = canHoldEvent(state, 'signing');
    expect(again.ok).toBe(false);
    expect(again.reason).toContain('月に1回');
  });

  it('試合の日には地域の活動を開けない。開けたらファンの数が増える', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    while (!todaysFixture(state)) advanceDay(state);
    const check = canHoldEvent(state, 'community');
    expect(check.ok).toBe(false);
    expect(check.nextDate).toBeDefined();
    playDay(state);
    for (let i = 0; i < 30 && !canHoldEvent(state, 'community').ok; i++) playDay(state);
    const fans = club.fans;
    expect(holdEvent(state, 'community', [eventCandidates(state)[0]!.id])).not.toBeNull();
    expect(club.fans).toBeGreaterThan(fans);
  });

  it('公開練習は明日の練習。その日の戦術の慣れ方が少し下がる', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    for (let i = 0; i < 60 && !canHoldEvent(state, 'openTraining').ok; i++) playDay(state);
    expect(holdEvent(state, 'openTraining')).not.toBeNull();
    expect(club.fanClub.openTrainingDate).not.toBeNull();
    expect(canHoldEvent(state, 'openTraining').ok).toBe(false);
    const day = club.fanClub.openTrainingDate!;
    while (state.date <= day) playDay(state);
    expect(club.fanClub.openTrainingDate).toBeNull();
  });
});

describe('古いセーブデータ（版4）', () => {
  it('フェーズ3-Bのセーブデータを読み込むと、ファンクラブが足される', () => {
    const state = newGame();
    const v4 = structuredClone(state) as unknown as { clubs: Record<string, Record<string, unknown>>; version: number };
    for (const club of Object.values(v4.clubs)) delete club.fanClub;
    v4.version = 4;
    const loaded = parseSaveFile(JSON.stringify({ ...toSaveFile(state), version: 4, state: v4 }));
    expect(loaded.version).toBe(6);
    const club = loaded.clubs[loaded.manager.clubId]!;
    expect(totalMembers(club.fanClub.members)).toBeGreaterThan(0);
    expect(loaded.inbox.some((m) => m.subject.includes('ファンクラブの機能'))).toBe(true);
    advanceDay(loaded);
  });
});
