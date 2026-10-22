// フェーズ3-C の監督のキャリアのテスト（経歴と難易度、評判、解任のあとの無職と再就職、在任中のオファー、AIの監督の交代、古いセーブ）

import { describe, expect, it } from 'vitest';
import { simulateMatch } from '../src/engine/match';
import type { MatchResult } from '../src/engine/types';
import { acceptOffer, applyFor, canApply, isUnemployed, resign, startTrustFor, vacancies } from '../src/game/career';
import { BACKGROUNDS, CAREER } from '../src/game/careerBalance';
import { isDismissed, positionGoalFor } from '../src/game/owner';
import { OWNER } from '../src/game/ownerBalance';
import { advanceDay, advanceToNextEvent, todaysFixture } from '../src/game/progress';
import { parseSaveFile, toSaveFile } from '../src/game/save';
import { applyMatchday, prepareMatchday } from '../src/game/season';
import { teamMeeting } from '../src/game/talks';
import type { GameState } from '../src/game/types';
import { createWorld, startNewGame, type NewGameOptions } from '../src/game/world';

function newGame(seed = 33, index = 0, options: NewGameOptions = {}): GameState {
  const world = createWorld(seed);
  return startNewGame(world, 'テスト監督', Object.keys(world.clubs)[index]!, options);
}

/** 自分のクラブの試合を、決まったスコアにして進める */
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

function playUntil(state: GameState, date: string, myScore?: [number, number], stop?: (s: GameState) => boolean): void {
  while (state.date < date && !stop?.(state)) {
    if (todaysFixture(state)) playToday(state, myScore);
    else advanceDay(state);
  }
}

describe('経歴と難易度', () => {
  it('経歴で最初の評判が決まり、評判より格上のクラブではオーナーの最初の信頼度が低い', () => {
    const world = createWorld(33);
    const top = Object.values(world.clubs).sort((a, b) => b.reputation - a.reputation)[0]!;
    const rookie = startNewGame(createWorld(33), '新人', top.id, { background: 'none' });
    expect(rookie.manager.reputation).toBe(BACKGROUNDS.none.reputation);
    expect(rookie.owner.trust).toBe(startTrustFor(top.reputation, BACKGROUNDS.none.reputation));
    expect(rookie.owner.trust).toBeLessThan(OWNER.startTrust);
    expect(rookie.owner.trust).toBeGreaterThanOrEqual(CAREER.minStartTrust);
    const star = startNewGame(createWorld(33), '元代表', top.id, { background: 'national' });
    expect(star.owner.trust).toBeGreaterThan(rookie.owner.trust);
    const small = Object.values(world.clubs).sort((a, b) => a.reputation - b.reputation)[0]!;
    expect(startNewGame(createWorld(33), '新人', small.id, { background: 'none' }).owner.trust).toBe(OWNER.startTrust);
    expect(star.manager.career).toHaveLength(1);
  });

  it('難易度でオーナーの厳しさと、最初の年の予算が変わる', () => {
    const easy = newGame(33, 2, { difficulty: 'easy' });
    const hard = newGame(33, 2, { difficulty: 'hard' });
    expect(easy.owner.strictness).toBe('lenient');
    expect(hard.owner.strictness).toBe('strict');
    const budget = (s: GameState) => s.clubs[s.manager.clubId]!.finance.budget.total;
    expect(budget(easy)).toBeGreaterThan(budget(hard));
  });

  it('経歴の得意：元日本代表はチームミーティングでモラルが大きく上がる', () => {
    const a = newGame(33, 0, { background: 'national' });
    const b = newGame(33, 0, { background: 'none' });
    const ids = a.clubs[a.manager.clubId]!.playerIds;
    const total = (s: GameState) => ids.reduce((n, id) => n + s.players[id]!.status.morale, 0);
    const before = total(a);
    teamMeeting(a, 'goals');
    teamMeeting(b, 'goals');
    expect(total(a) - before).toBeGreaterThan(total(b) - before);
  });
});

describe('解任のあと', () => {
  it('解任されると無職になり、日を進めると、どこかのクラブの監督に戻れる', () => {
    const world = createWorld(33);
    const clubId = Object.keys(world.clubs).find((id) => positionGoalFor(world, id) <= 10)!;
    const state = startNewGame(world, 'テスト監督', clubId);
    playUntil(state, '2027-12-01', [0, 3], (s) => isUnemployed(s));
    expect(isDismissed(state)).toBe(true);
    expect(isUnemployed(state)).toBe(true);
    expect(state.manager.career[0]!.end).toBe('dismissed');
    expect(state.manager.reputation).toBeLessThan(BACKGROUNDS.coach.reputation);
    expect(state.clubs[clubId]!.vacancy).not.toBeNull();
    // 無職でも日は進められる。前のクラブには応募できない
    expect(canApply(state, clubId).ok).toBe(false);
    expect(todaysFixture(state)).toBeUndefined();
    // 無職の間も、リーグの試合は進む
    const round = state.season.round;
    for (let i = 0; i < 20; i++) advanceDay(state);
    expect(state.season.round).toBeGreaterThan(round);
    let hired = false;
    for (let i = 0; i < 10 && !hired; i++) {
      advanceToNextEvent(state, 60);
      const offer = state.manager.offers[0];
      if (offer) hired = acceptOffer(state, offer.id);
    }
    expect(hired).toBe(true);
    expect(isUnemployed(state)).toBe(false);
    expect(state.manager.clubId).not.toBe(clubId);
    expect(isDismissed(state)).toBe(false);
    expect(state.manager.career.at(-1)!.clubId).toBe(state.manager.clubId);
    expect(state.inbox.some((m) => m.topic === 'budget' && m.date === state.date)).toBe(true);
  });

  it('辞任すると無職になり、空いているクラブに応募できる', () => {
    const state = newGame(33, 5);
    const before = state.manager.reputation;
    expect(resign(state)).toBe(true);
    expect(isUnemployed(state)).toBe(true);
    expect(state.manager.reputation).toBeLessThan(before);
    const open = vacancies(state).find((c) => canApply(state, c.id).ok);
    if (open) {
      expect(applyFor(state, open.id)).toBe(true);
      expect(canApply(state, open.id).ok).toBe(false);
    }
  });
});

describe('評判と在任中のオファー', () => {
  it('勝ち続けると評判が上がり、AIクラブの監督が解任され、格上のクラブから12月にオファーが届くと1月1日に移る', () => {
    const world = createWorld(33);
    const small = Object.values(world.clubs).sort((a, b) => a.reputation - b.reputation)[0]!;
    const state = startNewGame(world, 'テスト監督', small.id, { background: 'national' });
    const before = state.manager.reputation;
    playUntil(state, '2027-12-31', [3, 0]);
    // シーズンの終わりまでに、どこかのAIクラブの監督が代わっている
    const changed = state.inbox.filter((m) => m.category === 'league' && m.subject.includes('解任'));
    expect(changed.length).toBeGreaterThan(0);
    const offer = state.manager.offers.find((o) => o.start === 'nextSeason');
    if (offer) {
      expect(state.clubs[offer.clubId]!.reputation).toBeGreaterThanOrEqual(small.reputation + CAREER.stepUp);
      expect(acceptOffer(state, offer.id)).toBe(true);
      expect(state.manager.clubId).toBe(small.id);
      playUntil(state, '2028-01-02');
      expect(state.manager.clubId).toBe(offer.clubId);
      expect(state.manager.career[0]!.end).toBe('moved');
    } else {
      playUntil(state, '2028-01-02');
    }
    expect(state.manager.reputation).toBeGreaterThan(before);
    expect(state.manager.career[0]!.seasons[0]?.position).toBe(1);
  });
});

describe('古いセーブデータ（版5）', () => {
  it('フェーズ3.5のセーブデータを読み込むと、監督の評判とキャリアが足される', () => {
    const state = newGame();
    const v5 = structuredClone(state) as unknown as Record<string, unknown>;
    v5.manager = { name: state.manager.name, clubId: state.manager.clubId };
    for (const club of Object.values(v5.clubs as Record<string, Record<string, unknown>>)) {
      delete club.managerReputation;
      delete club.managerSince;
      delete club.vacancy;
    }
    v5.version = 5;
    const loaded = parseSaveFile(JSON.stringify({ ...toSaveFile(state), version: 5, state: v5 }));
    expect(loaded.version).toBe(9);
    expect(loaded.manager.reputation).toBeGreaterThan(0);
    expect(loaded.manager.career).toHaveLength(1);
    expect(loaded.clubs[loaded.manager.clubId]!.vacancy).toBeNull();
    advanceDay(loaded);
  });
});
