// 戦術の相性のテスト。同じ総合力どうしでも、戦術の組み合わせで結果が変わることを確かめる。
// 詳しい数字は npm run simulate の「戦術の相性」で見る。

import { describe, expect, it } from 'vitest';
import { generateTeam, withAttributes, withRoles, withTactics } from '../src/data/generate';
import { simulateMatch } from '../src/engine/match';
import { createRng } from '../src/engine/rng';
import type { Team } from '../src/engine/types';

const rng = createRng(4242);
const teamA = generateTeam(rng, { id: 'A', name: 'A', level: 12, formation: '4-4-2' });
const teamB = generateTeam(rng, { id: 'B', name: 'B', level: 12, formation: '4-3-3' });

function conceded(home: Team, away: Team, count: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += simulateMatch(home, away, { seed: 9000 + i, detailedCommentary: false }).score[1];
  return total / count;
}

describe('戦術の相性', () => {
  it('ハイラインは、足の速いFWに背後を突かれて失点が増える（低いラインではあまり変わらない）', () => {
    const fast = withRoles(withAttributes(teamB, ['FW', 'W'], { pace: 18, acceleration: 18 }), ['FW'], 'runner');
    const slow = withRoles(withAttributes(teamB, ['FW', 'W'], { pace: 8, acceleration: 8 }), ['FW'], 'runner');
    const high = withTactics(teamA, undefined, { defensiveLine: 2 });
    const low = withTactics(teamA, undefined, { defensiveLine: -2 });
    const highGap = conceded(high, fast, 300) - conceded(high, slow, 300);
    const lowGap = conceded(low, fast, 300) - conceded(low, slow, 300);
    expect(highGap).toBeGreaterThan(0.2);
    expect(highGap - lowGap).toBeGreaterThan(0.1);
  });
});
