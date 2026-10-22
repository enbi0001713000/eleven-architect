// フェーズ2で試合エンジンに加えたもののテスト（コンディション、疲労、モラル、熟成度、試合中のケガ、声かけ）

import { describe, expect, it } from 'vitest';
import { generateTeam } from '../src/data/generate';
import { ENGINE_CONFIG } from '../src/engine/config';
import { LiveMatch, simulateMatch, SUBSTITUTION_RULES, tirednessFactor } from '../src/engine/match';
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

  it('コンディションが悪いと、試合開始時のスタミナが下がる', () => {
    const live = new LiveMatch(withReadiness(home, { condition: 75, fatigue: 0, morale: 60, familiarity: 1 }), away, { seed: 3 });
    const players = live.snapshot().sides[0].onPitch;
    const expected = 100 - 25 * ENGINE_CONFIG.conditionWeight;
    expect(players.every((p) => p.stamina === expected)).toBe(true);
    expect(expected).toBeLessThan(100);
  });
});

describe('試合中の疲れと交代', () => {
  it('スタミナが減ると能力が下がり、65を切ると急に落ちる', () => {
    const values = [100, 90, 80, 70, 65, 60, 50, 40, 30].map(tirednessFactor);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThan(values[i - 1]!);
    expect(tirednessFactor(100)).toBe(1);
    // 65までの35で下がる分より、そこからの15で下がる分のほうが大きい
    expect(tirednessFactor(65) - tirednessFactor(50)).toBeGreaterThan(tirednessFactor(100) - tirednessFactor(65));
    expect(tirednessFactor(0)).toBe(ENGINE_CONFIG.tiredness.min);
  });

  it('AIは疲れた選手を代える。交代すると、終盤のピッチの選手は元気で、結果も良くなる', () => {
    let withSubs = 0;
    let withoutSubs = 0;
    let goalDiff = 0;
    const count = 120;
    for (let i = 0; i < count; i++) {
      const a = simulateMatch(home, away, { seed: 7000 + i, detailedCommentary: false, aiControl: [true, true] });
      const b = simulateMatch(home, away, { seed: 7000 + i, detailedCommentary: false, aiControl: [false, true] });
      withSubs += a.stats[0].staminaAtEnd / count;
      withoutSubs += b.stats[0].staminaAtEnd / count;
      goalDiff += ((a.score[0] - a.score[1]) - (b.score[0] - b.score[1])) / count;
    }
    expect(withSubs).toBeGreaterThan(withoutSubs + 5);
    expect(goalDiff).toBeGreaterThan(0);
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
        const injuryEvent = r.events.find((e) => e.type === 'injury' && e.text.includes(line.player.name))!;
        // ケガの時点で交代の人数と回数が残っていたなら、その選手は途中で下がっている
        const before = r.events.filter((e) => e.type === 'substitution' && e.side === line.side && e.clock < injuryEvent.clock);
        const windows = new Set(before.map((e) => e.clock)).size;
        if (before.length < SUBSTITUTION_RULES.maxSubs && windows < SUBSTITUTION_RULES.maxWindows) {
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
