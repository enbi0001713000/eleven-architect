// 画面で使う集計（得点ランキング、直近の結果など）

import { averageRating, fixturesOfClub } from '../game/season';
import type { Fixture, GameState, PlayerRecord } from '../game/types';

export function leaguePlayers(game: GameState): PlayerRecord[] {
  return Object.values(game.players).filter((p) => p.clubId !== null);
}

export function topScorers(game: GameState, limit: number, clubId?: string): PlayerRecord[] {
  return leaguePlayers(game)
    .filter((p) => (clubId ? p.clubId === clubId : true) && p.season.goals > 0)
    .sort((a, b) => b.season.goals - a.season.goals || b.season.assists - a.season.assists || a.season.minutes - b.season.minutes)
    .slice(0, limit);
}

export function topAssists(game: GameState, limit: number): PlayerRecord[] {
  return leaguePlayers(game)
    .filter((p) => p.season.assists > 0)
    .sort((a, b) => b.season.assists - a.season.assists || b.season.goals - a.season.goals)
    .slice(0, limit);
}

/** 平均評価点の高い選手（出場時間が一定以上） */
export function topRated(game: GameState, limit: number, minMinutes: number): PlayerRecord[] {
  return leaguePlayers(game)
    .filter((p) => p.season.minutes >= minMinutes)
    .sort((a, b) => (averageRating(b.season) ?? 0) - (averageRating(a.season) ?? 0))
    .slice(0, limit);
}

export function playedFixtures(game: GameState, clubId: string): Fixture[] {
  return fixturesOfClub(game, clubId).filter((f) => f.result !== null);
}

/** そのクラブから見た得点と失点 */
export function scoreFor(fixture: Fixture, clubId: string): { goalsFor: number; goalsAgainst: number; opponentId: string; home: boolean } | null {
  if (!fixture.result) return null;
  const home = fixture.homeId === clubId;
  return {
    goalsFor: home ? fixture.result.homeGoals : fixture.result.awayGoals,
    goalsAgainst: home ? fixture.result.awayGoals : fixture.result.homeGoals,
    opponentId: home ? fixture.awayId : fixture.homeId,
    home,
  };
}

/** 試合の得点者（イベントから読み取る） */
export function goalEvents(fixture: Fixture): { minute: string; side: 0 | 1; text: string }[] {
  if (!fixture.result) return [];
  return fixture.result.events
    .filter((e) => (e.type === 'goal' || e.type === 'penaltyGoal') && e.side !== null)
    .map((e) => ({ minute: e.minute, side: e.side as 0 | 1, text: e.text }));
}
