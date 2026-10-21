// 要件定義書「試合エンジンで使わない能力値は作らない」の確認。
// 能力値を1つだけ最低（1）にして同じシードで試合をし、結果が変わることを確かめる（使われていない能力値なら、まったく同じ結果になる）。

import { describe, expect, it } from 'vitest';
import { generateTeam } from '../src/data/generate';
import { simulateMatch } from '../src/engine/match';
import { createRng } from '../src/engine/rng';
import { ATTRIBUTE_KEYS, type AttributeKey, type MatchResult, type Team } from '../src/engine/types';

const rng = createRng(31);
const home = generateTeam(rng, { id: 'h', name: 'ホーム', level: 12 });
const away = generateTeam(rng, { id: 'a', name: 'アウェイ', level: 12, formation: '4-3-3' });
const SEEDS = Array.from({ length: 10 }, (_, i) => 700 + i);

function lowered(team: Team, key: AttributeKey): Team {
  return { ...team, players: team.players.map((p) => ({ ...p, attributes: { ...p.attributes, [key]: 1 } })) };
}

function signature(results: MatchResult[]): string {
  return results.map((r) => JSON.stringify([r.score, r.stats, r.players.map((l) => l.stats.rating)])).join('|');
}

describe('能力値の使われ方', () => {
  const play = (h: Team) => SEEDS.map((seed) => simulateMatch(h, away, { seed, detailedCommentary: false }));
  const base = signature(play(home));

  it.each(ATTRIBUTE_KEYS.map((key) => [key]))('%s を下げると試合の中身が変わる', (key) => {
    expect(signature(play(lowered(home, key as AttributeKey)))).not.toBe(base);
  });
});
