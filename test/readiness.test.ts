// フェーズ2で試合エンジンに加えたもののテスト（コンディション、疲労、モラル、熟成度、試合中のケガ、声かけ）

import { describe, expect, it } from 'vitest';
import { generateTeam } from '../src/data/generate';
import { LiveMatch, simulateMatch } from '../src/engine/match';
import { createRng } from '../src/engine/rng';
import type { MatchReadiness, Team } from '../src/engine/types';

const rng = createRng(21);
const home = generateTeam(rng, { id: 'h', name: 'ホーム', level: 12 });
const away = generateTeam(rng, { id: 'a', name: 'アウェイ', level: 12, formation: '4-3-3' });

function withReadiness(team: Team, readiness: MatchReadiness): Team {
  return { ...team, readiness: Object.fromEntries(team.players.map((p) => [p.id, readiness])) };
}

/** ホーム側から見た、平均の得失点差 */
function goalDiff(h: Team, a: Team, count: number, seedBase: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) {
    const r = simulateMatch(h, a, { seed: seedBase + i, detailedCommentary: false, aiControl: [true, true] });
    total += r.score[0] - r.score[1];
  }
  return total / count;
}

describe('試合前の状態', () => {
  it('万全の状態を渡しても、何も渡さないときと同じ結果になる', () => {
    const fresh: MatchReadiness = { condition: 100, fatigue: 0, morale: 60, familiarity: 1 };
    for (let seed = 1; seed <= 5; seed++) {
      const a = simulateMatch(home, away, { seed });
      const b = simulateMatch(withReadiness(home, fresh), withReadiness(away, fresh), { seed });
      expect(b.score).toEqual(a.score);
      expect(b.events.map((e) => e.text)).toEqual(a.events.map((e) => e.text));
    }
  });

  it('コンディションが悪く、疲れていて、モラルと熟成度が低いチームは成績が落ちる', () => {
    const tired = withReadiness(home, { condition: 70, fatigue: 90, morale: 25, familiarity: 0.3 });
    const normal = goalDiff(home, home, 150, 1000);
    const worse = goalDiff(tired, home, 150, 1000);
    expect(worse).toBeLessThan(normal - 0.25);
  });

  it('コンディションが試合開始時のスタミナになる', () => {
    const live = new LiveMatch(withReadiness(home, { condition: 75, fatigue: 0, morale: 60, familiarity: 1 }), away, { seed: 3 });
    const players = live.snapshot().sides[0].onPitch;
    expect(players.every((p) => p.stamina === 75)).toBe(true);
  });
});

describe('試合中のケガ', () => {
  const results = Array.from({ length: 300 }, (_, i) =>
    simulateMatch(home, away, { seed: 5000 + i, detailedCommentary: false, aiControl: [true, true] }));

  it('ケガは1チーム1試合あたり0.1〜0.4件くらい起きる', () => {
    const injuries = results.reduce((n, r) => n + r.players.filter((l) => l.injured).length, 0);
    const perTeam = injuries / results.length / 2;
    expect(perTeam).toBeGreaterThan(0.1);
    expect(perTeam).toBeLessThan(0.4);
  });

  it('ケガをすると実況に出て、AIは交代枠が残っていればすぐに代える', () => {
    let checked = 0;
    for (const r of results) {
      for (const line of r.players.filter((l) => l.injured)) {
        expect(r.events.some((e) => e.type === 'injury' && e.text.includes(line.player.name))).toBe(true);
        const subs = r.players.filter((l) => l.side === line.side && l.minuteOn !== null).length;
        const injuryEvent = r.events.find((e) => e.type === 'injury' && e.text.includes(line.player.name))!;
        // ケガの時点で交代枠が残っていたなら、その選手は途中で下がっている
        const subsBefore = r.events.filter((e) => e.type === 'substitution' && e.side === line.side && e.clock < injuryEvent.clock).length;
        if (subsBefore < 3 && subs < 5) {
          expect(line.minuteOff).not.toBeNull();
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('ケガが完治していない選手はケガをしやすい', () => {
    const count = (team: Team) => {
      let n = 0;
      for (let i = 0; i < 150; i++) {
        const r = simulateMatch(team, away, { seed: 9000 + i, detailedCommentary: false });
        n += r.players.filter((l) => l.side === 0 && l.injured).length;
      }
      return n;
    };
    const carrying = withReadiness(home, { condition: 100, fatigue: 0, morale: 60, familiarity: 1, carryingInjury: true });
    expect(count(carrying)).toBeGreaterThan(count(home) * 1.8);
  });
});

describe('声かけ', () => {
  it('出来を上げると成績が良くなり、実況に残る', () => {
    const play = (boost: number, seed: number) => {
      const live = new LiveMatch(home, home, { seed, detailedCommentary: false, aiControl: [true, true] });
      if (boost !== 0) {
        const deltas = Object.fromEntries(home.players.map((p) => [p.id, boost]));
        live.boostForm(0, deltas, 'ホームの監督が選手を鼓舞した');
      }
      return live.playToEnd();
    };
    let base = 0;
    let boosted = 0;
    for (let i = 0; i < 150; i++) {
      const a = play(0, 2000 + i);
      const b = play(0.1, 2000 + i);
      base += a.score[0] - a.score[1];
      boosted += b.score[0] - b.score[1];
      if (i === 0) expect(b.events.some((e) => e.type === 'teamTalk')).toBe(true);
    }
    expect(boosted / 150).toBeGreaterThan(base / 150 + 0.2);
  });
});
