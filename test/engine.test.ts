// 試合エンジンの自動テスト。要件定義書「フェーズ0の完成条件」と「検証と性能」の目標を確かめる。
// たくさんの試合を回すので、数十秒かかる。

import { beforeAll, describe, expect, it } from 'vitest';
import { generateTeam, withTactics } from '../src/data/generate';
import { simulateMatch } from '../src/engine/match';
import { createRng } from '../src/engine/rng';
import { averageTeamStats, summarize } from '../src/engine/summary';
import type { FormationName, MatchResult, Team } from '../src/engine/types';

const run = (home: Team, away: Team, count: number, seedBase: number): MatchResult[] =>
  Array.from({ length: count }, (_, i) => simulateMatch(home, away, { seed: seedBase + i, detailedCommentary: false }));

describe('1試合', () => {
  const rng = createRng(1);
  const home = generateTeam(rng, { id: 'h', name: 'ホーム', level: 12 });
  const away = generateTeam(rng, { id: 'a', name: 'アウェイ', level: 12, formation: '4-3-3' });

  it('結果と実況が出る', () => {
    const result = simulateMatch(home, away, { seed: 42 });
    expect(result.score[0]).toBeGreaterThanOrEqual(0);
    expect(result.events.some((e) => e.type === 'kickoff')).toBe(true);
    expect(result.events.at(-1)?.type).toBe('fulltime');
    const goalEvents = result.events.filter((e) => e.type === 'goal' || e.type === 'penaltyGoal').length;
    expect(goalEvents).toBe(result.score[0] + result.score[1]);
    expect(result.players).toHaveLength(22);
  });

  it('同じシードなら同じ試合になる', () => {
    const a = simulateMatch(home, away, { seed: 7 });
    const b = simulateMatch(home, away, { seed: 7 });
    expect(b.score).toEqual(a.score);
    expect(b.events.map((e) => e.text)).toEqual(a.events.map((e) => e.text));
  });

  it('評価点は3.0〜10.0に収まる', () => {
    for (const line of simulateMatch(home, away, { seed: 3 }).players) {
      expect(line.stats.rating).toBeGreaterThanOrEqual(3);
      expect(line.stats.rating).toBeLessThanOrEqual(10);
    }
  });
});

describe('結果の分布（要件定義書の目標）', () => {
  let results: MatchResult[] = [];

  beforeAll(() => {
    const rng = createRng(2026);
    const formations: FormationName[] = ['4-4-2', '4-3-3', '4-2-3-1'];
    const league = Array.from({ length: 18 }, (_, i) =>
      generateTeam(rng, { id: `c${i}`, name: `クラブ${i + 1}`, level: 10 + (4 * (i % 6)) / 5, formation: formations[i % 3] }));
    results = Array.from({ length: 1200 }, (_, i) => {
      const h = i % 18;
      const a = (h + 1 + (Math.floor(i / 18) % 17)) % 18;
      return simulateMatch(league[h]!, league[a]!, { seed: 100000 + i, detailedCommentary: false });
    });
  });

  it('1試合の平均ゴールが2.6〜2.9点', () => {
    const { goalsPerMatch } = summarize(results);
    expect(goalsPerMatch).toBeGreaterThanOrEqual(2.6);
    expect(goalsPerMatch).toBeLessThanOrEqual(2.9);
  });

  it('ホームの勝率が約45%、引き分けが約25%', () => {
    const { homeWinRate, drawRate } = summarize(results);
    expect(homeWinRate).toBeGreaterThanOrEqual(0.4);
    expect(homeWinRate).toBeLessThanOrEqual(0.5);
    expect(drawRate).toBeGreaterThanOrEqual(0.2);
    expect(drawRate).toBeLessThanOrEqual(0.3);
  });
});

describe('力の差と戦術', () => {
  it('強いチームのほうがよく勝つが、番狂わせも起きる', () => {
    const rng = createRng(77);
    const strong = generateTeam(rng, { id: 's', name: '強い', level: 14 });
    const weak = generateTeam(rng, { id: 'w', name: '弱い', level: 10 });
    const s = summarize(run(strong, weak, 400, 200000));
    expect(s.homeWinRate).toBeGreaterThan(0.55);
    expect(s.awayWinRate).toBeGreaterThan(0.03);
  });

  it('プレスを強くすると、相手陣内で奪う回数・ファウル・疲れが増え、相手のパス成功率が下がる', () => {
    const rng = createRng(3);
    const base = generateTeam(rng, { id: 'p', name: 'プレス', level: 12 });
    const opponent = generateTeam(rng, { id: 'o', name: '相手', level: 12 });
    const low = run(withTactics(base, undefined, { pressing: -2 }), opponent, 400, 400000);
    const high = run(withTactics(base, undefined, { pressing: 2 }), opponent, 400, 400000);
    const [lowMine, highMine] = [averageTeamStats(low, 0), averageTeamStats(high, 0)];
    const [lowTheirs, highTheirs] = [averageTeamStats(low, 1), averageTeamStats(high, 1)];
    expect(highMine.highRecoveries).toBeGreaterThan(lowMine.highRecoveries * 1.1);
    expect(highMine.fouls).toBeGreaterThan(lowMine.fouls);
    expect(highMine.staminaAtEnd).toBeLessThan(lowMine.staminaAtEnd);
    expect(highTheirs.passesCompleted / highTheirs.passes).toBeLessThan(lowTheirs.passesCompleted / lowTheirs.passes);
  });
});

describe('性能', () => {
  it('AI同士の試合は1試合50ミリ秒以内', () => {
    const rng = createRng(5);
    const home = generateTeam(rng, { id: 'h', name: 'H', level: 12 });
    const away = generateTeam(rng, { id: 'a', name: 'A', level: 12 });
    run(home, away, 20, 1); // 最初の数試合は遅いので慣らす
    const started = performance.now();
    run(home, away, 100, 1000);
    expect((performance.now() - started) / 100).toBeLessThan(50);
  });
});
