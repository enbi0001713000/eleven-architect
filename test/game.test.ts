// リーグとシーズンの仕組みのテスト（世界の生成、日程、順位表、メンバー選び、1シーズン）

import { describe, expect, it } from 'vitest';
import { simulateMatch } from '../src/engine/match';
import type { MatchResult } from '../src/engine/types';
import { LEAGUE_RULES } from '../src/game/rules';
import { applyMatchday, isSeasonOver, prepareMatchday } from '../src/game/season';
import { autoSelect, clubPlayers, isForeign, validateSelection } from '../src/game/selection';
import { computeStandings, standingsOf } from '../src/game/standings';
import type { Fixture, GameState } from '../src/game/types';
import { createWorld, startNewGame } from '../src/game/world';
import { parseSaveFile, toSaveFile } from '../src/game/save';

describe('世界の生成', () => {
  it('18クラブ、各28人、規模は大4・中10・小4、海外の選手プールもある', () => {
    const world = createWorld(1);
    const clubs = Object.values(world.clubs);
    expect(clubs).toHaveLength(18);
    for (const club of clubs) expect(club.playerIds).toHaveLength(28);
    const count = (size: string) => clubs.filter((c) => c.size === size).length;
    expect([count('large'), count('medium'), count('small')]).toEqual([4, 10, 4]);
    expect(world.overseasPool).toHaveLength(120);
    expect(clubs.every((c) => c.rivalId && world.clubs[c.rivalId]?.rivalId === c.id)).toBe(true);
  });

  it('同じシードなら同じ世界になる', () => {
    const a = createWorld(42);
    const b = createWorld(42);
    expect(Object.values(a.players).map((p) => p.name)).toEqual(Object.values(b.players).map((p) => p.name));
    expect(a.fixtures.map((f) => `${f.homeId}-${f.awayId}`)).toEqual(b.fixtures.map((f) => `${f.homeId}-${f.awayId}`));
  });
});

describe('日程', () => {
  const world = createWorld(3);
  const ids = Object.keys(world.clubs);

  it('34節、全チームとホームとアウェイで1回ずつ当たる', () => {
    expect(world.fixtures).toHaveLength(18 * 17);
    for (const id of ids) {
      const games = world.fixtures.filter((f) => f.homeId === id || f.awayId === id);
      expect(games).toHaveLength(34);
      expect(games.filter((f) => f.homeId === id)).toHaveLength(17);
      for (const other of ids.filter((o) => o !== id)) {
        expect(world.fixtures.filter((f) => f.homeId === id && f.awayId === other)).toHaveLength(1);
      }
    }
  });

  it('毎節、全チームが1試合ずつ戦う', () => {
    for (let round = 1; round <= 34; round++) {
      const teams = world.fixtures.filter((f) => f.round === round).flatMap((f) => [f.homeId, f.awayId]);
      expect(new Set(teams).size).toBe(18);
    }
  });

  it('ホーム（またはアウェイ）が3試合以上続かず、同じ相手と2節続けて当たらない（どのシードでも）', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const w = createWorld(seed);
      for (const id of Object.keys(w.clubs)) {
        const games = w.fixtures.filter((f) => f.homeId === id || f.awayId === id).sort((a, b) => a.round - b.round);
        expect(games.map((f) => (f.homeId === id ? 'H' : 'A')).join('')).not.toMatch(/HHH|AAA/);
        const opponents = games.map((f) => (f.homeId === id ? f.awayId : f.homeId));
        expect(opponents.some((o, i) => i > 0 && o === opponents[i - 1])).toBe(false);
      }
    }
    for (const id of ids) {
      const venues = world.fixtures.filter((f) => f.homeId === id || f.awayId === id)
        .sort((a, b) => a.round - b.round).map((f) => (f.homeId === id ? 'H' : 'A')).join('');
      expect(venues).not.toMatch(/HHH|AAA/);
    }
  });

  it('2月下旬に開幕し、12月上旬に終わる', () => {
    const dates = [...new Set(world.fixtures.map((f) => f.date))].sort();
    expect(dates).toHaveLength(34);
    expect(dates[0]).toBe('2027-02-27');
    expect(dates.at(-1)).toBe('2027-12-04');
  });
});

describe('順位表', () => {
  const fixture = (round: number, homeId: string, awayId: string, homeGoals: number, awayGoals: number): Fixture => ({
    id: `t-${round}-${homeId}`, round, date: '2027-03-01', homeId, awayId,
    result: { homeGoals, awayGoals, events: [], stats: [] as never, ratings: {}, lineups: [[], []] },
  });

  it('勝ち点 → 得失点差 → 総得点の順に並ぶ', () => {
    const rows = computeStandings(['a', 'b', 'c', 'd'], [
      fixture(1, 'a', 'b', 3, 0), fixture(1, 'c', 'd', 1, 0),
      fixture(2, 'a', 'c', 0, 0), fixture(2, 'b', 'd', 2, 2),
    ]);
    // d と b は勝ち点1で並ぶが、得失点差は d が -1、b が -3
    expect(rows.map((r) => r.clubId)).toEqual(['a', 'c', 'd', 'b']);
    expect(rows[0]).toMatchObject({ points: 4, goalDifference: 3, played: 2, won: 1, drawn: 1 });
  });

  it('勝ち点・得失点差・総得点が並んだら、直接対決の成績で決める', () => {
    // a と b はどちらも勝ち点4・得失点差0・総得点3。直接対決は b の勝ち
    const rows = computeStandings(['a', 'b', 'c', 'd'], [
      fixture(1, 'a', 'b', 1, 2), fixture(2, 'a', 'c', 1, 0), fixture(3, 'a', 'd', 1, 1),
      fixture(2, 'c', 'b', 1, 0), fixture(3, 'b', 'd', 1, 1),
    ]);
    const a = rows.find((r) => r.clubId === 'a');
    const b = rows.find((r) => r.clubId === 'b');
    expect([a?.points, a?.goalDifference, a?.goalsFor]).toEqual([b?.points, b?.goalDifference, b?.goalsFor]);
    expect(rows.findIndex((r) => r.clubId === 'b')).toBeLessThan(rows.findIndex((r) => r.clubId === 'a'));
  });
});

describe('メンバー選び', () => {
  it('先発11人と控え9人を選び、外国籍選手は5人まで', () => {
    const world = createWorld(5);
    for (const clubId of Object.keys(world.clubs)) {
      const club = world.clubs[clubId]!;
      const selection = autoSelect(world, clubId, club.tactics.formation);
      expect(selection.lineup).toHaveLength(11);
      expect(selection.bench).toHaveLength(LEAGUE_RULES.benchSize);
      const foreign = [...selection.lineup, ...selection.bench].filter((id) => isForeign(world.players[id]!)).length;
      expect(foreign).toBeLessThanOrEqual(LEAGUE_RULES.foreignLimit);
      expect(validateSelection(world, clubId, club.tactics.formation, selection)).toEqual([]);
    }
  });

  it('出場停止の選手は選ばれず、入れるとエラーになる', () => {
    const world = createWorld(6);
    const clubId = Object.keys(world.clubs)[0]!;
    const club = world.clubs[clubId]!;
    const first = autoSelect(world, clubId, club.tactics.formation);
    const banned = world.players[first.lineup[0]!]!;
    banned.discipline.suspendedMatches = 1;
    const second = autoSelect(world, clubId, club.tactics.formation);
    expect([...second.lineup, ...second.bench]).not.toContain(banned.id);
    expect(validateSelection(world, clubId, club.tactics.formation, first).join()).toContain('出場停止');
  });
});

describe('1シーズン', () => {
  it('34節を最後まで進めると優勝が決まり、出場停止も正しく扱われる', () => {
    const world = createWorld(2027);
    const clubId = Object.keys(world.clubs)[0]!;
    let state: GameState = startNewGame(world, 'テスト監督', clubId);
    let suspensionsSeen = 0;
    while (!isSeasonOver(state)) {
      const matchday = prepareMatchday(state);
      for (const m of matchday) {
        for (const id of [...m.home.lineup, ...(m.home.bench ?? []), ...m.away.lineup, ...(m.away.bench ?? [])]) {
          expect(state.players[id]!.discipline.suspendedMatches).toBe(0);
        }
      }
      suspensionsSeen += Object.values(state.players).filter((p) => p.discipline.suspendedMatches > 0).length;
      const results: Record<string, MatchResult> = {};
      for (const m of matchday) {
        results[m.fixture.id] = simulateMatch(m.home, m.away, { seed: m.seed, detailedCommentary: false, important: m.important });
      }
      applyMatchday(state, results);
    }
    expect(state.season.round).toBe(35);
    expect(state.fixtures.every((f) => f.result !== null)).toBe(true);
    const table = standingsOf(state);
    expect(table[0]!.played).toBe(34);
    const totalGoals = state.fixtures.reduce((n, f) => n + f.result!.homeGoals + f.result!.awayGoals, 0);
    expect(table.reduce((n, r) => n + r.goalsFor, 0)).toBe(totalGoals);
    expect(suspensionsSeen).toBeGreaterThan(0);
    const scorers = clubPlayers(state, clubId).reduce((n, p) => n + p.season.goals, 0);
    expect(scorers).toBe(table.find((r) => r.clubId === clubId)!.goalsFor);

    // セーブデータに書き出して読み込んでも、同じ状態に戻る
    const restored = parseSaveFile(JSON.stringify(toSaveFile(state)));
    expect(standingsOf(restored).map((r) => r.clubId)).toEqual(table.map((r) => r.clubId));
  });

  it('新しいバージョンのセーブデータは読み込まない', () => {
    const file = toSaveFile(createWorld(1));
    expect(() => parseSaveFile(JSON.stringify({ ...file, version: 999 }))).toThrow('新しいバージョン');
    expect(() => parseSaveFile('{"app":"other"}')).toThrow('このゲームのセーブデータではありません');
  });
});
