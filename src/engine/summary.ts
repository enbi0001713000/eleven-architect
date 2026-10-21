// 大量の試合結果を集計する。要件定義書「検証と性能」の目標と比べるために使う。

import type { MatchResult, Side, TeamStats } from './types';

export interface SeasonSummary {
  matches: number;
  goalsPerMatch: number;
  homeWinRate: number;
  drawRate: number;
  awayWinRate: number;
  /** 以下は1チーム1試合あたり */
  shots: number;
  shotsOnTarget: number;
  xg: number;
  passes: number;
  passAccuracy: number;
  fouls: number;
  yellowCards: number;
  corners: number;
  offsides: number;
  /** 1試合あたり */
  redCardsPerMatch: number;
  penaltiesPerMatch: number;
}

export function summarize(results: readonly MatchResult[]): SeasonSummary {
  const n = results.length;
  let goals = 0, homeWins = 0, draws = 0, awayWins = 0, reds = 0, penalties = 0;
  const totals = { shots: 0, shotsOnTarget: 0, xg: 0, passes: 0, passesCompleted: 0, fouls: 0, yellowCards: 0, corners: 0, offsides: 0 };
  for (const r of results) {
    const [h, a] = r.score;
    goals += h + a;
    if (h > a) homeWins++;
    else if (h === a) draws++;
    else awayWins++;
    for (const s of r.stats) {
      totals.shots += s.shots;
      totals.shotsOnTarget += s.shotsOnTarget;
      totals.xg += s.xg;
      totals.passes += s.passes;
      totals.passesCompleted += s.passesCompleted;
      totals.fouls += s.fouls;
      totals.yellowCards += s.yellowCards;
      totals.corners += s.corners;
      totals.offsides += s.offsides;
      reds += s.redCards;
    }
    penalties += r.events.filter((e) => e.type === 'penalty').length;
  }
  const perTeam = (v: number) => v / (2 * n);
  return {
    matches: n,
    goalsPerMatch: goals / n,
    homeWinRate: homeWins / n,
    drawRate: draws / n,
    awayWinRate: awayWins / n,
    shots: perTeam(totals.shots),
    shotsOnTarget: perTeam(totals.shotsOnTarget),
    xg: perTeam(totals.xg),
    passes: perTeam(totals.passes),
    passAccuracy: totals.passesCompleted / Math.max(1, totals.passes),
    fouls: perTeam(totals.fouls),
    yellowCards: perTeam(totals.yellowCards),
    corners: perTeam(totals.corners),
    offsides: perTeam(totals.offsides),
    redCardsPerMatch: reds / n,
    penaltiesPerMatch: penalties / n,
  };
}

/** 片方のチームから見た、平均のスタッツ */
export function averageTeamStats(results: readonly MatchResult[], side: Side): TeamStats & { possession: number } {
  const sum: Record<string, number> = {};
  let possession = 0;
  for (const r of results) {
    const s = r.stats[side];
    for (const [k, v] of Object.entries(s)) sum[k] = (sum[k] ?? 0) + v;
    const total = r.stats[0].possessionSeconds + r.stats[1].possessionSeconds;
    possession += s.possessionSeconds / Math.max(1, total);
  }
  const avg: Record<string, number> = {};
  for (const [k, v] of Object.entries(sum)) avg[k] = v / results.length;
  return { ...(avg as unknown as TeamStats), possession: possession / results.length };
}
