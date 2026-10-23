// 演出の予定のテスト（優勝が決まった節、選手の加入、新人の加入、見終えたら消す）

import { describe, expect, it } from 'vitest';
import { simulateMatch } from '../src/engine/match';
import { createRng } from '../src/engine/rng';
import type { MatchResult } from '../src/engine/types';
import { joinClub } from '../src/game/contracts';
import { addMoment, dismissMoment, titleDecided } from '../src/game/moments';
import { newcomers } from '../src/game/prospects';
import { applyMatchday, isSeasonOver, prepareMatchday } from '../src/game/season';
import type { StandingRow } from '../src/game/standings';
import type { GameState } from '../src/game/types';
import { createWorld, startNewGame } from '../src/game/world';

function newGame(seed = 61, index = 3): GameState {
  const world = createWorld(seed);
  return startNewGame(world, 'テスト監督', Object.keys(world.clubs)[index]!);
}

const row = (clubId: string, points: number): StandingRow => ({
  clubId, position: 0, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points, form: [],
});

describe('優勝が決まったか', () => {
  it('2位が残りをすべて勝っても届かなければ決まり、並ぶ可能性があればまだ。最終節のあとは必ず決まる', () => {
    expect(titleDecided([row('a', 70), row('b', 60)], 3)).toBe(true);
    expect(titleDecided([row('a', 69), row('b', 60)], 3)).toBe(false);
    expect(titleDecided([row('a', 60), row('b', 60)], 0)).toBe(true);
    expect(titleDecided([], 0)).toBe(false);
  });

  it('自分のクラブが勝ち続けると、優勝が決まった節に一度だけ知らせと演出が入る', () => {
    const state = newGame();
    const myId = state.manager.clubId;
    // 試合の中身は1つを使い回し、スコアだけ変える（自分のクラブは3-0で勝ち、ほかは引き分け）
    const first = prepareMatchday(state)[0]!;
    const template = simulateMatch(first.home, first.away, { seed: 1, detailedCommentary: false });
    while (!isSeasonOver(state)) {
      const results: Record<string, MatchResult> = {};
      for (const m of prepareMatchday(state)) {
        const score: [number, number] = m.fixture.homeId === myId ? [3, 0] : m.fixture.awayId === myId ? [0, 3] : [1, 1];
        results[m.fixture.id] = { ...template, score };
      }
      applyMatchday(state, results);
    }
    const titles = (state.moments ?? []).filter((m) => m.kind === 'title');
    expect(titles).toHaveLength(1);
    expect(titles[0]).toMatchObject({ kind: 'title', year: state.season.year });
    expect((titles[0] as { round: number }).round).toBeLessThan(34);
    expect(state.inbox.filter((m) => m.subject === '優勝が決まりました！')).toHaveLength(1);
  });
});

describe('選手の加入', () => {
  it('自分のクラブに入ると演出が入り、他クラブに入っても入らない', () => {
    const state = newGame();
    const myId = state.manager.clubId;
    const others = Object.keys(state.clubs).filter((id) => id !== myId);
    const player = state.players[state.clubs[others[0]!]!.playerIds[3]!]!;
    joinClub(state, player, myId, { ...player.contract! });
    expect(state.moments).toEqual([{ kind: 'signing', playerId: player.id, fromClubId: others[0], fee: 0, via: 'free' }]);
    const other = state.players[state.clubs[others[1]!]!.playerIds[3]!]!;
    joinClub(state, other, others[2]!, { ...other.contract! });
    expect(state.moments).toHaveLength(1);
  });

  it('1月10日の新人の加入は、自分のクラブに入った選手をまとめて1つの演出にする', () => {
    const state = newGame();
    const myId = state.manager.clubId;
    newcomers(state, createRng(5));
    const moments = (state.moments ?? []).filter((m) => m.kind === 'newcomers');
    expect(moments).toHaveLength(1);
    const ids = (moments[0] as { playerIds: string[] }).playerIds;
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => state.players[id]?.clubId === myId)).toBe(true);
  });

  it('見終えたら前から消え、見ないまま進めても12件までしかたまらない（古いセーブにはなくても動く）', () => {
    const state = newGame();
    delete state.moments;
    for (let i = 0; i < 15; i++) addMoment(state, { kind: 'title', year: 2000 + i, round: 34, points: 80 });
    expect(state.moments).toHaveLength(12);
    expect(state.moments![0]).toMatchObject({ year: 2003 });
    dismissMoment(state);
    expect(state.moments![0]).toMatchObject({ year: 2004 });
  });
});
