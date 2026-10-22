// フェーズ4-C のスカウトと新人のテスト（知識度、スカウトの派遣、条件を付けて探す、海外の選手の獲得、対戦で分かる分、
// 新人の候補と内定、1月10日の加入、古いセーブ）

import { describe, expect, it } from 'vitest';
import { simulateMatch } from '../src/engine/match';
import { overallRating } from '../src/engine/ratings';
import type { MatchResult } from '../src/engine/types';
import { CONTRACT } from '../src/game/contractBalance';
import { deservedRole, maxYears, neededSalary, offerContract, type ContractOffer } from '../src/game/contracts';
import { knowledgeOf } from '../src/game/knowledge';
import { advanceDay, todaysFixture } from '../src/game/progress';
import { makeOffer, offerProblem, prospectPlayers, standardSalary } from '../src/game/prospects';
import { parseSaveFile, toSaveFile } from '../src/game/save';
import { inOverseasPool, scoutCount, scoutPlayer, scoutProblem, scoutReport, startSearch } from '../src/game/scouting';
import { PROSPECTS, SCOUTING } from '../src/game/scoutingBalance';
import { applyMatchday, prepareMatchday } from '../src/game/season';
import { askingFee, bidProblem, OVERSEAS, placeBid } from '../src/game/transfers';
import type { GameState, PlayerRecord } from '../src/game/types';
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

const otherPlayer = (state: GameState): PlayerRecord =>
  Object.values(state.players).find((p) => p.clubId && p.clubId !== state.manager.clubId && !p.retiring)!;

describe('知識度とスカウト', () => {
  it('自分の選手は100%、同じリーグは50%、海外は20%。調べると上がり、下がらない。スカウトは規模で決まる人数だけ送れる', () => {
    const state = newGame();
    const myId = state.manager.clubId;
    const mine = state.players[state.clubs[myId]!.playerIds[0]!]!;
    const other = otherPlayer(state);
    const abroad = state.players[state.overseasPool[0]!]!;
    expect(knowledgeOf(state, mine)).toBe(100);
    expect(knowledgeOf(state, other)).toBe(SCOUTING.base.league);
    expect(knowledgeOf(state, abroad)).toBe(SCOUTING.base.overseas);
    expect(scoutCount(state)).toBe(SCOUTING.scouts[state.clubs[myId]!.size]);
    // 見つけていない海外の選手は、指名できない
    expect(scoutProblem(state, abroad.id)).toContain('見つけていない');
    expect(scoutPlayer(state, other.id)).toContain('調べに行きました');
    expect(scoutProblem(state, other.id)).toContain('いまスカウトが調べています');
    playUntil(state, state.scouting.assignments[0]!.due);
    expect(knowledgeOf(state, other)).toBe(SCOUTING.base.league + SCOUTING.playerGain);
    expect(state.scouting.reports[0]!.playerId).toBe(other.id);
    expect(state.inbox.some((m) => m.category === 'scout' && m.subject.includes(other.name))).toBe(true);
    const report = scoutReport(state, other);
    expect(report.overall.high - report.overall.low).toBeLessThanOrEqual(2);
    expect(report.strengths.length).toBeGreaterThan(0);
    expect(['A', 'B', 'C', 'D']).toContain(report.grade);
    // 時間がたっても下がらない
    const before = knowledgeOf(state, other);
    playUntil(state, `${state.season.year}-02-20`);
    expect(knowledgeOf(state, other)).toBeGreaterThanOrEqual(before);
  }, 60000);

  it('海外を探すと、その地域の選手が見つかり、移籍金で申し込んで獲れる（移籍期間の中なら、選手と契約するとすぐに加入）', () => {
    const state = newGame();
    const myId = state.manager.clubId;
    const budget = state.clubs[myId]!.finance.budget;
    budget.transfers = 30e8;
    budget.wages += 10e8;
    expect(startSearch(state, { region: 'southAmerica', position: null, maxAge: null })).toContain('探しに行きました');
    playUntil(state, state.scouting.assignments[0]!.due);
    const found = state.scouting.found.map((id) => state.players[id]!);
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThanOrEqual(SCOUTING.searchFinds);
    for (const p of found) {
      expect(p.nationality).toBe('ブラジル');
      expect(knowledgeOf(state, p)).toBe(SCOUTING.base.overseas + SCOUTING.searchGain);
    }
    // 見つけていない海外の選手には申し込めない
    const hidden = state.overseasPool.map((id) => state.players[id]!).find((p) => !state.scouting.found.includes(p.id))!;
    expect(bidProblem(state, hidden.id, { kind: 'transfer', fee: 1e8, wageShare: 1 })).toContain('見つけていない');
    const target = found[0]!;
    const ask = askingFee(state, target, OVERSEAS).fee!;
    expect(bidProblem(state, target.id, { kind: 'loan', fee: 0, wageShare: 1 })).toContain('移籍金');
    const placed = placeBid(state, target.id, { kind: 'transfer', fee: ask, wageShare: 1 });
    expect(placed.ok).toBe(true);
    expect(placed.bid!.sellerId).toBe(OVERSEAS);
    playUntil(state, placed.bid!.due);
    expect(state.bids.find((b) => b.id === placed.bid!.id)!.status).toBe('accepted');
    const base: ContractOffer = {
      salary: 0, role: deservedRole(state, target, myId), years: Math.min(maxYears(target), CONTRACT.preferredYears(target.age)),
      clauseMultiple: CONTRACT.defaultClause, bonus: { appearance: 0, goal: 0 },
    };
    const answer = offerContract(state, target.id, { ...base, salary: neededSalary(state, target, myId, 'signing', base).salary });
    expect(answer.verdict).toBe('accept');
    expect(target.clubId).toBe(myId);
    expect(inOverseasPool(state, target)).toBe(false);
    expect(state.transferHistory[0]).toMatchObject({ playerId: target.id, fromClubId: null, toClubId: myId, kind: 'fromAbroad', fee: ask });
    expect(knowledgeOf(state, target)).toBe(100);
  }, 60000);

  it('対戦すると、相手の出場した選手が少し分かる（70%まで）', () => {
    const state = newGame();
    const myId = state.manager.clubId;
    const first = state.fixtures.find((f) => f.homeId === myId || f.awayId === myId)!;
    playUntil(state, first.date);
    const results: Record<string, MatchResult> = {};
    for (const m of prepareMatchday(state)) results[m.fixture.id] = simulateMatch(m.home, m.away, { seed: m.seed, detailedCommentary: false });
    applyMatchday(state, results);
    const opponentId = first.homeId === myId ? first.awayId : first.homeId;
    const played = results[first.id]!.players.map((l) => state.players[l.player.id]!).filter((p) => p.clubId === opponentId);
    expect(played.length).toBeGreaterThanOrEqual(11);
    for (const p of played) expect(knowledgeOf(state, p)).toBe(SCOUTING.base.league + SCOUTING.matchGain);
  }, 60000);
});

describe('新人の候補と内定', () => {
  it('6月1日に候補が発表され、内定を受けた候補は翌年1月10日に加入する。決まらなかった候補は去る', () => {
    const state = newGame();
    const myId = state.manager.clubId;
    const year = state.season.year;
    playUntil(state, `${year}-06-02`);
    const prospects = prospectPlayers(state);
    expect(prospects.length).toBe(PROSPECTS.count.high + PROSPECTS.count.university);
    expect(prospects.every((p) => p.clubId === null && knowledgeOf(state, p) === SCOUTING.base.prospect)).toBe(true);
    expect(prospects.filter((p) => p.age === PROSPECTS.age.high).length).toBe(PROSPECTS.count.high);
    const best = [...prospects].sort((a, b) => b.hidden.potential - a.hidden.potential)[0]!;
    const school = best.prospect!.school;
    const salary = standardSalary(state, best, myId, 'rotation') * 1.5;
    expect(offerProblem(state, best.id, 'rotation', 1)).toContain('安すぎ');
    expect(makeOffer(state, best.id, 'rotation', salary)).toContain('内定を出しました');
    expect(offerProblem(state, best.id, 'rotation', salary)).toContain('すでに');
    playUntil(state, best.prospect!.decideBy!);
    expect(best.prospect!.signed?.clubId).toBe(myId);
    expect(state.inbox.some((m) => m.subject === `${best.name}が内定を受けました`)).toBe(true);
    playUntil(state, `${year}-11-20`);
    // AIクラブも内定を出している
    const signedByAi = prospectPlayers(state).filter((p) => p.prospect!.signed && p.prospect!.signed.clubId !== myId)
      .map((p) => ({ p, clubId: p.prospect!.signed!.clubId }));
    expect(signedByAi.length).toBeGreaterThan(10);
    const unsigned = prospectPlayers(state).filter((p) => !p.prospect!.signed).map((p) => p.id);
    playUntil(state, `${year + 1}-01-11`);
    expect(best.clubId).toBe(myId);
    expect(best.prospect).toBeNull();
    expect(best.age).toBe(PROSPECTS.age[school] + 1);
    expect(best.contract).toMatchObject({ role: 'rotation', endYear: year + 1 + PROSPECTS.years - 1 });
    expect(state.prospects).toEqual([]);
    for (const id of unsigned) expect(state.players[id]).toBeUndefined();
    for (const { p, clubId } of signedByAi) expect(state.players[p.id] === undefined || p.clubId === clubId).toBe(true);
    for (const club of Object.values(state.clubs)) expect(club.playerIds.length).toBeLessThanOrEqual(30);
    expect(state.inbox.some((m) => m.subject === '新人選手が加入しました' && m.body.includes(best.name))).toBe(true);
    expect(overallRating(best)).toBeGreaterThan(0);
  }, 180000);
});

describe('古いセーブデータ（版8）', () => {
  it('フェーズ4-Bのセーブデータを読み込むと、スカウトと新人の候補が足される', () => {
    const state = newGame();
    const v8 = structuredClone(state) as unknown as Record<string, unknown>;
    delete v8.scouting;
    delete v8.prospects;
    v8.version = 8;
    const loaded = parseSaveFile(JSON.stringify({ ...toSaveFile(state), version: 8, state: v8 }));
    expect(loaded.version).toBe(9);
    expect(loaded.scouting.knowledge).toEqual({});
    expect(loaded.prospects).toEqual([]);
    advanceDay(loaded);
  });
});
