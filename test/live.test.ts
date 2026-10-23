// 観戦中に止めて采配する機能のテスト（交代、戦術の変更、少しずつ進めること）

import { describe, expect, it } from 'vitest';
import { generateTeam } from '../src/data/generate';
import { LiveMatch, SUBSTITUTION_RULES, simulateMatch } from '../src/engine/match';
import { createRng } from '../src/engine/rng';

const rng = createRng(11);
const home = generateTeam(rng, { id: 'h', name: 'ホーム', level: 12 });
const away = generateTeam(rng, { id: 'a', name: 'アウェイ', level: 12, formation: '4-3-3' });
const manual: [boolean, boolean] = [false, true];

describe('少しずつ進める', () => {
  it('1分ずつ進めても、一気に進めても同じ結果になる', () => {
    const live = new LiveMatch(home, away, { seed: 5, aiControl: manual });
    while (live.phase !== 'finished') {
      live.advance(live.clock + 60);
      if (live.phase === 'halftime') live.startSecondHalf();
    }
    const direct = new LiveMatch(home, away, { seed: 5, aiControl: manual }).playToEnd();
    expect(live.result().score).toEqual(direct.score);
    expect(live.result().events.map((e) => e.text)).toEqual(direct.events.map((e) => e.text));
  });

  it('前半が終わるとハーフタイムで止まる', () => {
    const live = new LiveMatch(home, away, { seed: 6, aiControl: manual });
    live.advance(Number.POSITIVE_INFINITY);
    expect(live.phase).toBe('halftime');
    live.startSecondHalf();
    expect(live.phase).toBe('secondHalf');
    expect(live.clock).toBe(45 * 60);
  });
});

describe('交代', () => {
  const benchIds = home.bench ?? [];

  it('控えの選手と交代でき、記録に途中出場として残る', () => {
    const live = new LiveMatch(home, away, { seed: 7, aiControl: manual });
    live.advance(30 * 60);
    const out = home.lineup[9] as string;
    const into = benchIds[4] as string;
    expect(live.substitute(0, out, into).ok).toBe(true);
    const snapshot = live.snapshot();
    expect(snapshot.sides[0].onPitch.some((p) => p.player.id === into)).toBe(true);
    expect(snapshot.sides[0].subsUsed).toBe(1);
    const result = live.playToEnd();
    const subLine = result.players.find((l) => l.player.id === into);
    expect(subLine?.started).toBe(false);
    expect(subLine?.minuteOn).toBeGreaterThanOrEqual(30);
    expect(result.players.find((l) => l.player.id === out)?.minuteOff).toBeGreaterThanOrEqual(30);
  });

  it('交代できる回数は3回まで。ハーフタイムの交代は数えない', () => {
    const live = new LiveMatch(home, away, { seed: 8, aiControl: manual });
    live.advance(Number.POSITIVE_INFINITY);
    expect(live.substitute(0, home.lineup[10] as string, benchIds[6] as string).ok).toBe(true);
    live.startSecondHalf();
    const pairs: [number, number][] = [[9, 5], [8, 3], [7, 4]];
    for (const [i, [outIndex, benchIndex]] of pairs.entries()) {
      live.advance(live.clock + 5 * 60);
      expect(live.substitute(0, home.lineup[outIndex] as string, benchIds[benchIndex] as string).ok).toBe(true);
      expect(live.snapshot().sides[0].windowsUsed).toBe(i + 1);
    }
    live.advance(live.clock + 5 * 60);
    const fourth = live.substitute(0, home.lineup[6] as string, benchIds[1] as string);
    expect(fourth.ok).toBe(false);
    expect(fourth.message).toContain('3回');
  });

  it('同じタイミングの交代は1回と数え、交代は5人まで', () => {
    const live = new LiveMatch(home, away, { seed: 9, aiControl: manual });
    live.advance(20 * 60);
    for (let i = 0; i < SUBSTITUTION_RULES.maxSubs; i++) {
      expect(live.substitute(0, home.lineup[10 - i] as string, benchIds[i + 1] as string).ok).toBe(true);
    }
    expect(live.snapshot().sides[0].windowsUsed).toBe(1);
    expect(live.substitute(0, home.lineup[5] as string, benchIds[6] as string).ok).toBe(false);
  });

  it('途中からAIに任せると、残りの交代をAIが行う', () => {
    const live = new LiveMatch(home, away, { seed: 13, aiControl: manual });
    live.advance(Number.POSITIVE_INFINITY);
    live.startSecondHalf();
    live.advance(50 * 60);
    expect(live.snapshot().sides[0].subsUsed).toBe(0);
    live.setAiControl(0, true);
    const result = live.playToEnd();
    expect(result.players.filter((l) => l.side === 0 && !l.started).length).toBeGreaterThan(0);
  });

  it('AIのチームは後半に自分で交代する', () => {
    const results = Array.from({ length: 20 }, (_, i) => simulateMatch(home, away, { seed: 100 + i }));
    const subsPerTeam = results.reduce((n, r) => n + r.players.filter((l) => !l.started).length, 0) / (results.length * 2);
    expect(subsPerTeam).toBeGreaterThan(1.5);
    expect(subsPerTeam).toBeLessThanOrEqual(SUBSTITUTION_RULES.maxSubs);
  });
});

describe('戦術の変更', () => {
  it('試合中にフォーメーションとチーム指示を変えられる', () => {
    const live = new LiveMatch(home, away, { seed: 10, aiControl: manual });
    live.advance(50 * 60);
    const result = live.changeTactics(0, {
      formation: '4-3-3',
      instructions: { mentality: 2, defensiveLine: 1, pressing: 2, width: 1, passingLength: 0, tempo: 1 },
    });
    expect(result.ok).toBe(true);
    const side = live.snapshot().sides[0];
    expect(side.tactics.formation).toBe('4-3-3');
    expect(side.onPitch.map((p) => p.position)).toEqual(['GK', 'SB', 'CB', 'CB', 'SB', 'CM', 'DM', 'CM', 'W', 'FW', 'W']);
    expect(live.events.some((e) => e.type === 'tactics')).toBe(true);
  });

  it('フォーメーションを変えるときに、おすすめの並びから自分で入れ替えた並びにできる', () => {
    const live = new LiveMatch(home, away, { seed: 10, aiControl: manual });
    live.advance(50 * 60);
    const suggested = live.suggestOrder(0, '4-3-3');
    expect(suggested).toHaveLength(11);
    expect(new Set(suggested)).toEqual(new Set(live.snapshot().sides[0].onPitch.map((p) => p.player.id)));
    // 両ウイングの枠（9番目と11番目）の選手を入れ替える
    const order = [...suggested];
    [order[8], order[10]] = [order[10] as string, order[8] as string];
    expect(live.changeTactics(0, { formation: '4-3-3', order }).ok).toBe(true);
    expect(live.snapshot().sides[0].onPitch.map((p) => p.player.id)).toEqual(order);
  });

  it('枠の数が合わない並びは受け付けない', () => {
    const live = new LiveMatch(home, away, { seed: 12, aiControl: manual });
    expect(live.changeTactics(0, { order: home.lineup.slice(0, 10) }).ok).toBe(false);
  });

  it('中に切り込む型のウイングは、縦に突破する型よりシュートが多い', () => {
    const rngLocal = createRng(21);
    const base = generateTeam(rngLocal, { id: 'w', name: 'W', level: 12, formation: '4-3-3' });
    const opponent = generateTeam(rngLocal, { id: 'o', name: 'O', level: 12 });
    const wingerShots = (role: 'winger' | 'insideForward') => {
      const roles = Array.from({ length: 11 }, (_, i) => (i === 8 || i === 10 ? role : undefined));
      const team = { ...base, tactics: { ...base.tactics, roles: roles as never } };
      let shots = 0;
      for (let i = 0; i < 200; i++) {
        const r = simulateMatch(team, opponent, { seed: 500 + i, detailedCommentary: false });
        shots += r.players.filter((l) => l.side === 0 && l.position === 'W').reduce((n, l) => n + l.stats.shots, 0);
      }
      return shots;
    };
    expect(wingerShots('insideForward')).toBeGreaterThan(wingerShots('winger') * 1.15);
  });
});
