// 観戦の速さのテスト（相手ゴールに近い場面はゆっくり、速さを上げるとボールの動きも速くなる、ゴールの後は止める）

import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../src/engine/types';
import { moveDuration, situationOf, stepDelay } from '../src/ui/matchPace';

const at = (side: 0 | 1, x: number) => ({ ball: { side, holderId: null, x, y: 2.5 } });
const event = (type: MatchEvent['type']): MatchEvent => ({ clock: 600, minute: "10'", side: 0, type, importance: 3, text: '' });

describe('観戦の速さ', () => {
  it('ボールを持つ側から見て、自陣の後ろ・中盤・相手ゴールの近くを分ける', () => {
    expect(situationOf(at(0, 0.5))).toBe('buildUp');
    expect(situationOf(at(0, 3.5))).toBe('midfield');
    expect(situationOf(at(0, 5.5))).toBe('attack');
    // アウェイは逆向きに攻める
    expect(situationOf(at(1, 0.5))).toBe('attack');
    expect(situationOf(at(1, 5.5))).toBe('buildUp');
  });

  it('相手ゴールに近い場面ほどゆっくり。速さを2倍にすると、待つ時間は半分', () => {
    expect(stepDelay(1, at(0, 5.5), [])).toBeGreaterThan(stepDelay(1, at(0, 3.5), []));
    expect(stepDelay(1, at(0, 3.5), [])).toBeGreaterThan(stepDelay(1, at(0, 0.5), []));
    expect(stepDelay(2, at(0, 3.5), [])).toBeCloseTo(stepDelay(1, at(0, 3.5), []) / 2, -1);
    expect(stepDelay(8, at(0, 3.5), [])).toBeLessThan(stepDelay(4, at(0, 3.5), []));
  });

  it('ゴールやシュートの後は止める。8倍でも、ゴールの後はしばらく見られる', () => {
    expect(stepDelay(1, at(0, 5.5), [event('goal')])).toBeGreaterThan(stepDelay(1, at(0, 5.5), [event('shotSaved')]));
    expect(stepDelay(1, at(0, 5.5), [event('shotSaved')])).toBeGreaterThan(stepDelay(1, at(0, 5.5), []));
    expect(stepDelay(8, at(0, 5.5), [event('goal')])).toBeGreaterThanOrEqual(600);
  });

  it('選手とボールは、次の手より先に動き終わる', () => {
    for (const delay of [80, 300, 600, 2500]) expect(moveDuration(delay)).toBeLessThanOrEqual(Math.max(60, delay));
  });
});
