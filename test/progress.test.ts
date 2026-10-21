// フェーズ2の進行のテスト（1日ずつの進行、ケガ、練習、熟成度、成長、モラル、面談、シーズンの切り替え、古いセーブの変換）

import { describe, expect, it } from 'vitest';
import { simulateMatch } from '../src/engine/match';
import { createRng } from '../src/engine/rng';
import { overallRating } from '../src/engine/ratings';
import type { MatchResult } from '../src/engine/types';
import { BALANCE } from '../src/game/balance';
import { applyInjury, canPlay, createInjury, injuryName, teamFamiliarity } from '../src/game/condition';
import { developWeek } from '../src/game/development';
import { checkPromises } from '../src/game/morale';
import { advanceDay, advanceToNextEvent, instructionFamiliarity, todaysFixture } from '../src/game/progress';
import { parseSaveFile, toSaveFile } from '../src/game/save';
import { applyMatchday, isSeasonOver, prepareMatchday } from '../src/game/season';
import { autoSelect, clubPlayers, repairSelection, validateSelection } from '../src/game/selection';
import {
  answerPress, answerRequest, managerTalk, pressQuestions, teamMeeting, teamTalk,
} from '../src/game/talks';
import type { GameState, PlayerRecord } from '../src/game/types';
import { createWorld, startNewGame } from '../src/game/world';

function newGame(seed = 5): GameState {
  const world = createWorld(seed);
  return startNewGame(world, 'テスト監督', Object.keys(world.clubs)[0]!);
}

function myPlayers(state: GameState): PlayerRecord[] {
  return clubPlayers(state, state.manager.clubId);
}

function playToday(state: GameState): void {
  const results: Record<string, MatchResult> = {};
  for (const m of prepareMatchday(state)) {
    results[m.fixture.id] = simulateMatch(m.home, m.away, { seed: m.seed, detailedCommentary: false, important: m.important });
  }
  applyMatchday(state, results);
}

/** シーズンの最後まで進める */
function playSeason(state: GameState): void {
  while (!isSeasonOver(state)) {
    while (!todaysFixture(state)) advanceDay(state);
    const club = state.clubs[state.manager.clubId]!;
    club.selection = autoSelect(state, club.id, club.tactics.formation);
    playToday(state);
  }
}

describe('時間の進め方', () => {
  it('「次の出来事まで進める」は試合の日に止まり、試合をするまでは先に進めない', () => {
    const state = newGame();
    let result = advanceToNextEvent(state);
    while (result.reason !== 'match') result = advanceToNextEvent(state);
    expect(todaysFixture(state)).toBeDefined();
    expect(() => advanceDay(state)).toThrow('試合');
    // 試合の日には記者会見の知らせが届く
    expect(state.inbox.some((m) => m.action?.kind === 'press' && !m.resolved)).toBe(true);
    playToday(state);
    expect(todaysFixture(state)).toBeUndefined();
    expect(state.inbox.every((m) => m.action?.kind !== 'press' || m.resolved)).toBe(true);
    advanceDay(state);
  });

  it('試合でコンディションが下がって疲労がたまり、数日休むと戻る', () => {
    const state = newGame();
    while (!todaysFixture(state)) advanceDay(state);
    const starters = state.clubs[state.manager.clubId]!.selection!.lineup;
    playToday(state);
    const played = starters.map((id) => state.players[id]!).filter((p) => p.season.minutes >= 90);
    expect(played.length).toBeGreaterThan(5);
    const avg = (f: (p: PlayerRecord) => number) => played.reduce((n, p) => n + f(p), 0) / played.length;
    const conditionAfter = avg((p) => p.status.condition);
    const fatigueAfter = avg((p) => p.status.fatigue);
    expect(conditionAfter).toBeLessThan(85);
    for (let i = 0; i < 5; i++) advanceDay(state);
    expect(avg((p) => p.status.condition)).toBeGreaterThan(conditionAfter + 8);
    expect(avg((p) => p.status.fatigue)).toBeLessThan(fatigueAfter);
  });

  it('練習の強度がハードだと、軽めより疲れがたまる', () => {
    const fatigueWith = (intensity: 'light' | 'hard') => {
      const state = newGame();
      state.clubs[state.manager.clubId]!.training.intensity = intensity;
      for (let i = 0; i < 6; i++) advanceDay(state);
      const players = myPlayers(state).filter((p) => !p.status.injury);
      return players.reduce((n, p) => n + p.status.fatigue, 0) / players.length;
    };
    expect(fatigueWith('hard')).toBeGreaterThan(fatigueWith('light') + 3);
  });
});

describe('ケガ', () => {
  it('ケガは日がたつと治り、治ったあとはしばらく再発しやすい', () => {
    const state = newGame();
    const player = myPlayers(state)[0]!;
    const injury = createInjury(createRng(1), player, state.date, 'training');
    injury.daysLeft = 5;
    applyInjury(player, injury);
    expect(canPlay(player)).toBe(false);
    for (let i = 0; i < 2; i++) advanceDay(state);
    expect(player.status.injury?.daysLeft).toBe(3);
    // 残り3日以内なら、完治前でも出せる
    expect(canPlay(player)).toBe(true);
    for (let i = 0; i < 3; i++) advanceDay(state);
    expect(player.status.injury).toBeNull();
    expect(player.status.recurrence?.part).toBe(injury.part);
    expect(player.injuryHistory[0]?.kind).toBe(injury.kind);
  });

  it('ケガの選手は自動のメンバーに入らず、入れるとルール違反になる。入れ替えは出られない選手だけ', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    const selection = club.selection!;
    const victim = state.players[selection.lineup[3]!]!;
    applyInjury(victim, { kind: 'strain', part: '太もも裏', date: state.date, days: 20, daysLeft: 20 });
    expect(validateSelection(state, club.id, club.tactics.formation, selection).join()).toContain('ケガ');
    expect(autoSelect(state, club.id, club.tactics.formation).lineup).not.toContain(victim.id);
    const repaired = repairSelection(state, club.id, club.tactics.formation, selection);
    expect(repaired.lineup).not.toContain(victim.id);
    expect(repaired.lineup.filter((id, i) => id === selection.lineup[i])).toHaveLength(10);
    expect(validateSelection(state, club.id, club.tactics.formation, repaired)).toEqual([]);
  });

  it('試合の日にメンバーに出られない選手がいたら、アシスタントが入れ替えて知らせる', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    const victim = state.players[club.selection!.lineup[5]!]!;
    applyInjury(victim, { kind: 'fracture', part: 'すね', date: state.date, days: 60, daysLeft: 60 });
    while (!todaysFixture(state)) advanceDay(state);
    expect(club.selection!.lineup).not.toContain(victim.id);
    expect(validateSelection(state, club.id, club.tactics.formation, club.selection!)).toEqual([]);
    expect(state.inbox.some((m) => m.subject.includes('入れ替えました') && m.body.includes(victim.name))).toBe(true);
  });

  it('ケガの名前は部位と種類を重ねない', () => {
    expect(injuryName({ kind: 'backPain', part: '腰' })).toBe('腰痛');
    expect(injuryName({ kind: 'strain', part: '太もも裏' })).toBe('太もも裏の肉離れ');
  });

  it('1シーズンで、1クラブあたり10〜30件くらいのケガが起きる', () => {
    const state = newGame(8);
    const before = new Map(Object.values(state.players).map((p) => [p.id, p.injuryHistory.length]));
    playSeason(state);
    const injuries = Object.values(state.players).filter((p) => p.clubId)
      .reduce((n, p) => n + p.injuryHistory.length - (before.get(p.id) ?? 0), 0);
    expect(injuries / 18).toBeGreaterThan(10);
    expect(injuries / 18).toBeLessThan(30);
  });
});

describe('戦術の熟成度', () => {
  it('フォーメーションを変えると下がり、練習で上がっていく', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    const before = teamFamiliarity(club);
    club.tactics.formation = club.tactics.formation === '4-3-3' ? '4-4-2' : '4-3-3';
    const changed = teamFamiliarity(club);
    expect(changed).toBeLessThan(before - 15);
    club.training.focus = 'tactical';
    for (let i = 0; i < 6; i++) advanceDay(state);
    expect(teamFamiliarity(club)).toBeGreaterThan(changed + 3);
  });

  it('チーム指示を大きく変えると、指示の熟成度が下がる', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    const before = instructionFamiliarity(club);
    club.tactics.instructions = { ...club.tactics.instructions, mentality: 2, pressing: 2, tempo: -2 };
    expect(instructionFamiliarity(club)).toBeLessThan(before - 20);
  });
});

describe('成長と衰え', () => {
  it('伸びしろのある若手は試合に出ると伸び、30代半ばはフィジカルが衰える', () => {
    const state = newGame();
    const club = state.clubs[state.manager.clubId]!;
    const rng = createRng(3);
    const young = structuredClone(myPlayers(state)[5]!);
    young.age = 19;
    young.hidden.potential = overallRating(young) + 4;
    young.hidden.professionalism = 15;
    young.status.recentMinutes = 360;
    const old = structuredClone(myPlayers(state)[6]!);
    old.age = 34;
    const youngBefore = overallRating(young);
    const paceBefore = old.attributes.pace;
    for (let week = 0; week < 46; week++) {
      developWeek(rng, young, club, 360);
      developWeek(rng, old, club, 360);
    }
    expect(overallRating(young)).toBeGreaterThan(youngBefore + 0.5);
    expect(overallRating(young)).toBeLessThan(youngBefore + 3);
    expect(old.attributes.pace).toBeLessThan(paceBefore - 1);
  });

  it('潜在能力は総合力と同じ目盛りで、若いほど伸びしろが大きい', () => {
    const state = newGame();
    const players = Object.values(state.players).filter((p) => p.clubId);
    expect(players.every((p) => p.hidden.potential >= overallRating(p) - 0.05)).toBe(true);
    const gap = (list: PlayerRecord[]) => list.reduce((n, p) => n + p.hidden.potential - overallRating(p), 0) / list.length;
    expect(gap(players.filter((p) => p.age <= 21))).toBeGreaterThan(gap(players.filter((p) => p.age >= 28)) + 1);
  });

  it('潜在能力に届いた選手は伸びない', () => {
    const state = newGame();
    const player = structuredClone(myPlayers(state)[4]!);
    player.age = 20;
    player.hidden.potential = overallRating(player) - 0.5;
    const before = overallRating(player);
    const rng = createRng(4);
    for (let week = 0; week < 20; week++) developWeek(rng, player, state.clubs[state.manager.clubId]!, 360);
    expect(overallRating(player)).toBeLessThanOrEqual(before + 0.05);
  });
});

describe('面談と声かけ', () => {
  it('出場機会の約束：守るとモラルが上がり、守らないと大きく下がる', () => {
    const state = newGame();
    const [kept, broken] = myPlayers(state).filter((p) => p.contract?.role === 'backup');
    state.season.round = 10;
    state.requests.push({ id: 'r1', playerId: kept!.id, kind: 'playingTime', date: state.date });
    state.requests.push({ id: 'r2', playerId: broken!.id, kind: 'playingTime', date: state.date });
    answerRequest(state, 'r1', 'promise');
    answerRequest(state, 'r2', 'promise');
    expect(state.promises).toHaveLength(2);
    expect(state.requests).toHaveLength(0);
    kept!.season.starts += 3;
    const keptBefore = kept!.status.morale;
    const brokenBefore = broken!.status.morale;
    // 期限の節の試合が終わったところ
    state.season.round = state.promises[0]!.untilRound;
    checkPromises(state, false);
    expect(state.promises).toHaveLength(0);
    expect(kept!.status.morale).toBeGreaterThan(keptBefore);
    expect(broken!.status.morale).toBeLessThan(brokenBefore - 15);
    expect(state.inbox.some((m) => m.subject.includes('約束が守られなかった'))).toBe(true);
  });

  it('個人面談：叱ると、気の強い選手は奮起し、気の弱い選手は落ち込む', () => {
    const state = newGame();
    const [a, b] = myPlayers(state);
    a!.hidden.temperament = 17;
    b!.hidden.temperament = 5;
    a!.status.recentRatings = [6.0, 6.1, 6.2];
    b!.status.recentRatings = [6.0, 6.1, 6.2];
    expect(managerTalk(state, a!.id, 'criticize').morale).toBeGreaterThan(0);
    expect(managerTalk(state, b!.id, 'criticize').morale).toBeLessThan(0);
    expect(() => managerTalk(state, a!.id, 'praise')).toThrow('最近話をした');
  });

  it('チームミーティング：連敗中の立て直しは効き、続けてはできない', () => {
    const state = newGame();
    while (!todaysFixture(state)) advanceDay(state);
    state.season.round = 10;
    // 直近3試合を負けにする
    const mine = state.fixtures.filter((f) => f.homeId === state.manager.clubId || f.awayId === state.manager.clubId).slice(0, 3);
    for (const f of mine) {
      const myHome = f.homeId === state.manager.clubId;
      f.result = { homeGoals: myHome ? 0 : 2, awayGoals: myHome ? 2 : 0, events: [], stats: [] as never, ratings: {}, lineups: [[], []] };
    }
    const before = myPlayers(state).reduce((n, p) => n + p.status.morale, 0);
    const outcome = teamMeeting(state, 'rally');
    expect(outcome.reactions.length).toBeGreaterThan(20);
    expect(myPlayers(state).reduce((n, p) => n + p.status.morale, 0)).toBeGreaterThan(before);
    expect(() => teamMeeting(state, 'goals')).toThrow('最近ミーティング');
  });

  it('記者会見の答え方で、ファンの雰囲気と相手監督との関係が変わる', () => {
    const state = newGame();
    while (!todaysFixture(state)) advanceDay(state);
    const fixture = todaysFixture(state)!;
    const questions = pressQuestions(state, fixture.id);
    expect(questions.length).toBeGreaterThanOrEqual(2);
    const opponentId = fixture.homeId === state.manager.clubId ? fixture.awayId : fixture.homeId;
    const fans = state.fanMood;
    answerPress(state, fixture.id, { preview: 'confident', rival: 'fire' });
    expect(state.fanMood).toBeGreaterThan(fans);
    expect(state.managerRelations[opponentId]).toBeLessThan(0);
    expect(state.inbox.find((m) => m.action?.kind === 'press')?.resolved).toBe(true);
  });

  it('声かけ：負けているハーフタイムに叱ると、気の強い選手と弱い選手で反応が分かれる', () => {
    const state = newGame();
    const [a, b] = myPlayers(state);
    a!.hidden.temperament = 18;
    b!.hidden.temperament = 4;
    const reactions = teamTalk(createRng(1), [a!, b!], { moment: 'half', goalDiff: -1, favorite: 0 }, 'criticize');
    expect(reactions[0]!.form).toBeGreaterThan(0);
    expect(reactions[1]!.form).toBeLessThan(0);
    const post = teamTalk(createRng(1), [a!], { moment: 'post', goalDiff: 2, favorite: 0 }, 'praise');
    expect(post[0]!.form).toBe(0);
    expect(post[0]!.morale).toBeGreaterThan(0);
  });
});

describe('シーズンの切り替え', () => {
  it('シーズンが終わると、総括、引退、新しい日程、新人の加入が順に起き、次のシーズンが始められる', () => {
    const state = newGame(12);
    playSeason(state);
    const year = state.season.year;
    const ages = new Map(Object.values(state.players).map((p) => [p.id, p.age]));
    const stops: string[] = [];
    while (state.season.year === year || state.date < `${year + 1}-02-01`) {
      const result = advanceToNextEvent(state);
      if (result.reason === 'message') stops.push(state.date.slice(5));
      for (const r of [...state.requests]) answerRequest(state, r.id, 'compete');
    }
    expect(stops).toEqual(expect.arrayContaining(['12-10', '12-20', '01-01', '01-10']));
    expect(state.history).toHaveLength(1);
    expect(state.history[0]!.table).toHaveLength(18);
    expect(state.season).toEqual({ year: year + 1, round: 1 });
    expect(state.fixtures.every((f) => f.result === null && f.id.startsWith(`${year + 1}-`))).toBe(true);
    // 残っている選手は1つ年を取り、記録は経歴に移る
    const stayed = Object.values(state.players).filter((p) => ages.has(p.id));
    expect(stayed.every((p) => p.age === ages.get(p.id)! + 1)).toBe(true);
    expect(stayed.every((p) => p.season.appearances === 0)).toBe(true);
    expect(stayed.some((p) => p.career.some((c) => c.year === year && c.appearances > 0))).toBe(true);
    // 引退した選手はいなくなり、新人が入っている
    expect(Object.values(state.players).some((p) => p.retiring || p.leaving)).toBe(false);
    for (const club of Object.values(state.clubs)) {
      expect(club.playerIds.length).toBeGreaterThanOrEqual(24);
      expect(club.playerIds.length).toBeLessThanOrEqual(30);
      expect(club.playerIds.every((id) => state.players[id]?.clubId === club.id)).toBe(true);
    }
    const rookies = Object.values(state.players).filter((p) => !ages.has(p.id) && p.clubId);
    expect(rookies.length).toBeGreaterThanOrEqual(36);
    expect(rookies.every((p) => p.status.integration === BALANCE.newcomerIntegration || p.status.integration > BALANCE.newcomerIntegration)).toBe(true);
    // 2年目も試合ができる
    while (!todaysFixture(state)) advanceDay(state);
    playToday(state);
    expect(state.season.round).toBe(2);
  });
});

describe('古いセーブデータ', () => {
  it('フェーズ1（版1）のセーブデータを読み込むと、フェーズ2の項目が足される', () => {
    const state = newGame();
    const v1 = structuredClone(state) as unknown as Record<string, unknown>;
    for (const key of ['inbox', 'nextMessageNumber', 'requests', 'promises', 'history', 'fanMood', 'managerRelations', 'lastTeamMeeting']) delete v1[key];
    for (const p of Object.values(v1.players as Record<string, Record<string, unknown>>)) {
      for (const key of ['status', 'trainingFocus', 'injuryHistory', 'career', 'lastTalk']) delete p[key];
      if (p.contract) delete (p.contract as Record<string, unknown>).role;
    }
    for (const c of Object.values(v1.clubs as Record<string, Record<string, unknown>>)) {
      delete c.training;
      delete c.familiarity;
      delete c.finance;
    }
    v1.version = 1;
    const file = { ...toSaveFile(state), version: 1, state: v1 };
    const loaded = parseSaveFile(JSON.stringify(file));
    expect(loaded.version).toBe(3);
    const player = Object.values(loaded.players).find((p) => p.clubId)!;
    expect(player.status.condition).toBe(100);
    expect(player.contract?.role).toBeDefined();
    expect(loaded.clubs[loaded.manager.clubId]!.training.focus).toBe('balanced');
    // フェーズ2の知らせと、フェーズ3-Aの知らせ
    expect(loaded.inbox.map((m) => m.category)).toEqual(['finance', 'club']);
    expect(loaded.clubs[loaded.manager.clubId]!.finance.budget.total).toBeGreaterThan(0);
    // 変換したデータでそのまま遊べる
    while (!todaysFixture(loaded)) advanceDay(loaded);
    playToday(loaded);
    expect(loaded.season.round).toBe(2);
  });
});
