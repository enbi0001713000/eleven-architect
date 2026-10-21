// 順位表。順位の決め方：勝ち点 → 得失点差 → 総得点 → 直接対決の成績（要件定義書「ルール」）

import { LEAGUE_RULES } from './rules';
import type { Fixture, GameState } from './types';

export interface StandingRow {
  clubId: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  /** 直近5試合（古い順）。W = 勝ち、D = 引き分け、L = 負け */
  form: ('W' | 'D' | 'L')[];
}

function emptyRow(clubId: string): StandingRow {
  return { clubId, position: 0, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, form: [] };
}

function tally(clubIds: readonly string[], fixtures: readonly Fixture[]): Map<string, StandingRow> {
  const rows = new Map(clubIds.map((id) => [id, emptyRow(id)]));
  const played = fixtures.filter((f) => f.result).sort((a, b) => a.round - b.round);
  for (const f of played) {
    const home = rows.get(f.homeId);
    const away = rows.get(f.awayId);
    const r = f.result;
    if (!home || !away || !r) continue;
    const record = (row: StandingRow, scored: number, conceded: number) => {
      row.played++;
      row.goalsFor += scored;
      row.goalsAgainst += conceded;
      if (scored > conceded) {
        row.won++;
        row.points += LEAGUE_RULES.points.win;
        row.form.push('W');
      } else if (scored === conceded) {
        row.drawn++;
        row.points += LEAGUE_RULES.points.draw;
        row.form.push('D');
      } else {
        row.lost++;
        row.points += LEAGUE_RULES.points.loss;
        row.form.push('L');
      }
    };
    record(home, r.homeGoals, r.awayGoals);
    record(away, r.awayGoals, r.homeGoals);
  }
  for (const row of rows.values()) {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
    row.form = row.form.slice(-5);
  }
  return rows;
}

export function computeStandings(clubIds: readonly string[], fixtures: readonly Fixture[]): StandingRow[] {
  const rows = [...tally(clubIds, fixtures).values()];
  const key = (r: StandingRow) => [r.points, r.goalDifference, r.goalsFor];
  const compare = (a: StandingRow, b: StandingRow) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      const d = (kb[i] ?? 0) - (ka[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  rows.sort(compare);

  // 勝ち点・得失点差・総得点が並んだチームは、そのチームどうしの対戦成績で決める
  const result: StandingRow[] = [];
  for (let i = 0; i < rows.length;) {
    let j = i + 1;
    while (j < rows.length && compare(rows[i] as StandingRow, rows[j] as StandingRow) === 0) j++;
    const group = rows.slice(i, j);
    if (group.length > 1) {
      const ids = new Set(group.map((r) => r.clubId));
      const headToHead = tally([...ids], fixtures.filter((f) => ids.has(f.homeId) && ids.has(f.awayId)));
      group.sort((a, b) => {
        const ha = headToHead.get(a.clubId) as StandingRow;
        const hb = headToHead.get(b.clubId) as StandingRow;
        return (hb.points - ha.points) || (hb.goalsFor - hb.goalsAgainst - (ha.goalsFor - ha.goalsAgainst))
          || a.clubId.localeCompare(b.clubId);
      });
    }
    result.push(...group);
    i = j;
  }
  result.forEach((row, index) => { row.position = index + 1; });
  return result;
}

export function standingsOf(state: GameState): StandingRow[] {
  return computeStandings(Object.keys(state.clubs), state.fixtures);
}
