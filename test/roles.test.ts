// フェーズ3.5 の役割とフォーメーションのテスト（呼び方、枠の初期の役割、向き不向き、AIの役割の選び方、新しい形での試合）

import { describe, expect, it } from 'vitest';
import { generateTeam } from '../src/data/generate';
import { FORMATION_NAMES, FORMATIONS } from '../src/engine/formations';
import { simulateMatch } from '../src/engine/match';
import { createRng } from '../src/engine/rng';
import { ROLE_OPTIONS, ROLE_PROFILES, roleForSlot, roleLabel, slotDefaultRole } from '../src/engine/roles';
import type { Role } from '../src/engine/types';
import { bestRole, bestRoles, roleFit } from '../src/game/roleFit';
import { buildTeam } from '../src/game/season';
import { createWorld, startNewGame } from '../src/game/world';

describe('役割の名前', () => {
  it('サッカーの呼び方が付いていて、ポジションで呼び方が変わるものもある', () => {
    expect(roleLabel('anchor', 'DM')).toBe('アンカー');
    expect(roleLabel('volante', 'CM')).toBe('ボランチ');
    expect(roleLabel('shadowStriker', 'AM')).toBe('シャドー');
    expect(roleLabel('advancedPlaymaker', 'AM')).toBe('トップ下');
    expect(roleLabel('poacher', 'FW')).toBe('ストライカー');
    expect(roleLabel('playmaker', 'CM')).toBe('ゲームメーカー');
    expect(roleLabel('playmaker', 'DM')).toBe('レジスタ');
    expect(roleLabel('defensiveFullback', 'SB')).toBe('守備的SB');
    expect(roleLabel('defensiveFullback', 'WB')).toBe('守備的WB');
  });

  it('どの役割にも、大事な能力が3つ以上ある。どの役割も、どこかのポジションで選べる', () => {
    const selectable = new Set(Object.values(ROLE_OPTIONS).flat());
    for (const [role, profile] of Object.entries(ROLE_PROFILES)) {
      expect(profile.keys.length, role).toBeGreaterThanOrEqual(3);
      expect(selectable.has(role as Role), role).toBe(true);
    }
  });
});

describe('フォーメーション', () => {
  it('どの形も11人でGKが1人。枠の初期の役割は、そのポジションで選べるもの', () => {
    expect(FORMATION_NAMES).toEqual(['4-4-2', '4-3-3', '4-2-3-1', '4-1-4-1', '3-4-2-1', '3-5-2']);
    for (const name of FORMATION_NAMES) {
      const slots = FORMATIONS[name];
      expect(slots).toHaveLength(11);
      expect(slots.filter((s) => s.position === 'GK')).toHaveLength(1);
      slots.forEach((slot, i) => expect(ROLE_OPTIONS[slot.position]).toContain(slotDefaultRole({ formation: name }, i, slot.position)));
    }
    // 3-4-2-1 の2列目はシャドー、ボランチの2人はボランチ
    const shadow = FORMATIONS['3-4-2-1'].findIndex((s) => s.position === 'AM');
    expect(roleForSlot({ formation: '3-4-2-1', instructions: FORMATIONS_TEST_INSTRUCTIONS }, shadow, 'AM')).toBe('shadowStriker');
    expect(FORMATIONS['3-5-2'].filter((s) => s.position === 'WB')).toHaveLength(2);
  });

  it('新しい形でも試合ができ、ゴール数がふつうの範囲に入る', () => {
    const rng = createRng(11);
    const a = generateTeam(rng, { id: 'A', name: 'A', level: 12, formation: '3-4-2-1' });
    const b = generateTeam(rng, { id: 'B', name: 'B', level: 12, formation: '3-5-2' });
    const c = generateTeam(rng, { id: 'C', name: 'C', level: 12, formation: '4-1-4-1' });
    let goals = 0;
    const n = 40;
    for (let i = 0; i < n; i++) {
      const r1 = simulateMatch(a, b, { seed: 100 + i, detailedCommentary: false });
      const r2 = simulateMatch(b, c, { seed: 200 + i, detailedCommentary: false });
      goals += r1.score[0] + r1.score[1] + r2.score[0] + r2.score[1];
    }
    const perMatch = goals / (2 * n);
    expect(perMatch).toBeGreaterThan(1.8);
    expect(perMatch).toBeLessThan(3.8);
  });
});

const FORMATIONS_TEST_INSTRUCTIONS = { mentality: 0, defensiveLine: 0, pressing: 0, width: 0, passingLength: 0, tempo: 0 };

describe('向き不向き', () => {
  it('◎○△がどれも出る。GKとフィールドの選手を入れ替えると、どの役割も△', () => {
    const world = createWorld(5);
    const marks = { good: 0, ok: 0, poor: 0 };
    for (const p of Object.values(world.players)) {
      for (const role of ROLE_OPTIONS[p.position]) marks[roleFit(p, role, p.position)]++;
    }
    const total = marks.good + marks.ok + marks.poor;
    expect(marks.good / total).toBeGreaterThan(0.1);
    expect(marks.poor / total).toBeGreaterThan(0.1);
    expect(marks.ok / total).toBeGreaterThan(0.4);
    const keeper = Object.values(world.players).find((p) => p.position === 'GK')!;
    const striker = Object.values(world.players).find((p) => p.position === 'FW')!;
    expect(roleFit(keeper, 'poacher', 'FW')).toBe('poor');
    expect(roleFit(striker, 'goalkeeper', 'GK')).toBe('poor');
  });

  it('一番向いている役割は、そのポジションで選べるもの。AIのクラブは試合で選手に合わせた役割を使う', () => {
    const world = createWorld(5);
    for (const p of Object.values(world.players).slice(0, 80)) expect(ROLE_OPTIONS[p.position]).toContain(bestRole(p, p.position));
    const state = startNewGame(world, 'テスト監督', Object.keys(world.clubs)[0]!);
    const aiId = Object.keys(state.clubs)[1]!;
    const team = buildTeam(state, aiId);
    const players = team.lineup.map((id) => state.players[id]);
    expect(team.tactics.roles).toEqual(bestRoles(team.tactics.formation, players));
    // 自分のクラブは、選んだ役割のまま（何も選んでいなければ初期値）
    const mine = buildTeam(state, state.manager.clubId);
    expect(mine.tactics.roles).toBeUndefined();
  });
});
