// 節ごとの進行：試合の準備、結果の記録、選手の記録と出場停止の更新。

import type { MatchResult, Team } from '../engine/types';
import { LEAGUE_RULES } from './rules';
import { autoSelect, clubPlayers, validateSelection } from './selection';
import type { Fixture, GameState } from './types';

export interface MatchdayFixture {
  fixture: Fixture;
  home: Team;
  away: Team;
  seed: number;
  /** ダービー（ライバルとの対戦） */
  important: boolean;
}

export function isSeasonOver(state: GameState): boolean {
  return state.season.round > LEAGUE_RULES.rounds;
}

export function fixturesOfRound(state: GameState, round: number): Fixture[] {
  return state.fixtures.filter((f) => f.round === round);
}

export function fixturesOfClub(state: GameState, clubId: string): Fixture[] {
  return state.fixtures.filter((f) => f.homeId === clubId || f.awayId === clubId);
}

export function nextFixtureOf(state: GameState, clubId: string): Fixture | undefined {
  return fixturesOfClub(state, clubId).find((f) => f.result === null);
}

/** 試合で使うチーム。プレイヤーのクラブは選んだメンバー、AIのクラブ（または選び方がルール違反のとき）は自動で選ぶ */
export function buildTeam(state: GameState, clubId: string): Team {
  const club = state.clubs[clubId];
  if (!club) throw new Error(`クラブ ${clubId} がありません`);
  const formation = club.tactics.formation;
  const chosen = club.selection;
  const selection = chosen && validateSelection(state, clubId, formation, chosen).length === 0
    ? chosen
    : autoSelect(state, clubId, formation);
  return {
    id: club.id,
    name: club.name,
    players: clubPlayers(state, clubId),
    lineup: selection.lineup,
    bench: selection.bench,
    tactics: club.tactics,
  };
}

export function matchSeed(state: GameState, fixture: Fixture): number {
  const index = Number(fixture.id.split('-').at(-1) ?? 0);
  return (state.seed * 31 + fixture.round * 7919 + index * 104729) >>> 0;
}

export function prepareMatchday(state: GameState): MatchdayFixture[] {
  return fixturesOfRound(state, state.season.round).map((fixture) => ({
    fixture,
    home: buildTeam(state, fixture.homeId),
    away: buildTeam(state, fixture.awayId),
    seed: matchSeed(state, fixture),
    important: state.clubs[fixture.homeId]?.rivalId === fixture.awayId,
  }));
}

/** その節の全試合の結果を記録し、次の節へ進める */
export function applyMatchday(state: GameState, results: Record<string, MatchResult>): void {
  const fixtures = fixturesOfRound(state, state.season.round);
  const missing = fixtures.filter((f) => !results[f.id]);
  if (missing.length > 0) throw new Error(`結果が足りません：${missing.map((f) => f.id).join(', ')}`);

  // この節を出場停止で休んだ選手は、残りの試合数を1つ減らす（全クラブが毎節試合をする）
  const playing = new Set(fixtures.flatMap((f) => [f.homeId, f.awayId]));
  for (const player of Object.values(state.players)) {
    if (player.clubId && playing.has(player.clubId) && player.discipline.suspendedMatches > 0) {
      player.discipline.suspendedMatches--;
    }
  }

  for (const fixture of fixtures) {
    const result = results[fixture.id] as MatchResult;
    const ratings: Record<string, number> = {};
    for (const line of result.players) {
      ratings[line.player.id] = line.stats.rating;
      const player = state.players[line.player.id];
      if (!player) continue;
      const s = player.season;
      const minuteOn = line.minuteOn ?? 0;
      const minuteOff = line.minuteOff ?? 90;
      s.appearances++;
      if (line.started) s.starts++;
      s.minutes += Math.max(1, Math.min(90, minuteOff) - Math.min(90, minuteOn));
      s.goals += line.stats.goals;
      s.assists += line.stats.assists;
      s.yellowCards += line.stats.yellowCards;
      s.redCards += line.stats.redCards;
      s.ratingTotal += line.stats.rating;
      s.ratingCount++;

      // 出場停止：退場は次の試合から、警告は累積で
      const d = player.discipline;
      if (line.stats.redCards > 0) {
        d.suspendedMatches += line.stats.yellowCards >= 2 ? LEAGUE_RULES.secondYellowBan : LEAGUE_RULES.straightRedBan;
      } else if (line.stats.yellowCards > 0) {
        d.yellowAccumulation += line.stats.yellowCards;
        if (d.yellowAccumulation >= LEAGUE_RULES.yellowLimit) {
          d.suspendedMatches += 1;
          d.yellowAccumulation -= LEAGUE_RULES.yellowLimit;
        }
      }
    }
    fixture.result = {
      homeGoals: result.score[0],
      awayGoals: result.score[1],
      events: result.events.filter((e) => e.importance >= 2),
      stats: result.stats,
      ratings,
      lineups: [
        result.players.filter((l) => l.side === 0 && l.started).map((l) => l.player.id),
        result.players.filter((l) => l.side === 1 && l.started).map((l) => l.player.id),
      ],
    };
  }

  state.date = fixtures[0]?.date ?? state.date;
  state.season.round++;
}

export function averageRating(stats: { ratingTotal: number; ratingCount: number }): number | null {
  return stats.ratingCount === 0 ? null : Math.round((stats.ratingTotal / stats.ratingCount) * 100) / 100;
}
