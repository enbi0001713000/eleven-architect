// 1.1「画面の作り直し」のテスト（戦い方、チームの弱いところ、ホームの今やること、アシスタントコーチの一言、練習の予定、交渉の進み具合）

import { describe, expect, it } from 'vitest';
import { FORMATIONS } from '../src/engine/formations';
import { ROLE_OPTIONS } from '../src/engine/roles';
import type { FormationName } from '../src/engine/types';
import { weakSpots } from '../src/game/needs';
import { trainingDayKind } from '../src/game/progress';
import {
  lineupOf, nearestStyle, recommendStyle, STYLE_BY_ID, styleFit, styleFormation, styleRoles, STYLES,
} from '../src/game/styles';
import type { GameState, TransferBid } from '../src/game/types';
import { addDays } from '../src/game/dates';
import { createWorld, startNewGame } from '../src/game/world';
import { bidSteps } from '../src/ui/bidProgress';
import { coachLines, coachName, coachScreenOf, COACH_SCREENS, pickCoachLine } from '../src/ui/coach';
import { homeTodos } from '../src/ui/todos';

function newGame(seed = 11, index = 3): GameState {
  const world = createWorld(seed);
  return startNewGame(world, 'テスト監督', Object.keys(world.clubs)[index]!);
}

describe('戦い方', () => {
  it('9つの戦い方があり、指示はそれぞれ違い、自分の指示からは自分が選ばれる', () => {
    expect(STYLES).toHaveLength(9);
    const keys = new Set(STYLES.map((s) => JSON.stringify(s.instructions)));
    expect(keys.size).toBe(STYLES.length);
    for (const style of STYLES) {
      expect(nearestStyle(style.instructions)?.id).toBe(style.id);
      for (const v of Object.values(style.instructions)) expect(Math.abs(v)).toBeLessThanOrEqual(2);
    }
  });

  it('近い指示は近い戦い方になり、どれからも遠い指示は自分の指示（null）になる', () => {
    const near = { ...STYLE_BY_ID.tikiTaka.instructions, tempo: 0 };
    expect(nearestStyle(near)?.id).toBe('tikiTaka');
    expect(nearestStyle({ mentality: 2, defensiveLine: -2, pressing: -2, width: -2, passingLength: -2, tempo: -2 })).toBeNull();
  });

  it('合う形は、今の形が入っていればそのまま、なければ熟成度の高い形', () => {
    const counter = STYLE_BY_ID.counter;
    expect(styleFormation(counter, '4-4-2')).toBe('4-4-2');
    expect(styleFormation(counter, '4-3-3')).toBe(counter.formations[0]);
    expect(styleFormation(counter, '4-3-3', { '3-5-2': 80, '4-4-2': 40 })).toBe('3-5-2');
  });

  it('提案する役割は、どの形でもその枠で選べる役割', () => {
    const game = newGame();
    const club = game.clubs[game.manager.clubId]!;
    for (const style of STYLES) {
      for (const formation of Object.keys(FORMATIONS) as FormationName[]) {
        const roles = styleRoles(style, formation, club.tactics);
        expect(roles).toHaveLength(FORMATIONS[formation].length);
        roles.forEach((role, i) => expect(ROLE_OPTIONS[FORMATIONS[formation][i]!.position]).toContain(role));
      }
    }
  });

  it('合い具合は★1〜3で、バランスは誰でも★3', () => {
    const game = newGame();
    const { players, positions } = lineupOf(game, game.manager.clubId);
    expect(players.filter(Boolean)).toHaveLength(11);
    for (const style of STYLES) {
      const fit = styleFit(players, style, positions);
      expect([1, 2, 3]).toContain(fit.stars);
      if (style.keys.length > 0) expect(fit.strongest).not.toBeNull();
    }
    expect(styleFit(players, STYLE_BY_ID.balanced, positions).stars).toBe(3);
  });

  it('コーチのおすすめは、相手のラインが高ければカウンター（力の差が大きくなければ）', () => {
    const game = newGame();
    const myId = game.manager.clubId;
    const opponentId = Object.keys(game.clubs).find((id) => id !== myId)!;
    const advice = recommendStyle(game, myId, opponentId);
    expect(STYLES).toContain(advice.style);
    expect(advice.reason.length).toBeGreaterThan(0);
    // 力の差をなくすため、相手を自分と同じ選手にして、ラインだけ高くする
    const opponent = game.clubs[opponentId]!;
    opponent.playerIds = [...game.clubs[myId]!.playerIds];
    opponent.selection = game.clubs[myId]!.selection;
    opponent.tactics = { ...opponent.tactics, instructions: { mentality: 0, defensiveLine: 2, pressing: 0, width: 0, passingLength: 0, tempo: 0 } };
    expect(recommendStyle(game, myId, opponentId).style.id).toBe('counter');
    // 合う形に慣れていなければ、形は今のまま
    const me = game.clubs[myId]!;
    me.tactics = { ...me.tactics, formation: '4-3-3' };
    me.familiarity.formations = { '4-3-3': 90, '4-4-2': 30, '4-2-3-1': 30, '3-5-2': 30 };
    expect(recommendStyle(game, myId, opponentId).formation).toBe('4-3-3');
    me.familiarity.formations = { '4-3-3': 60, '4-4-2': 50 };
    expect(recommendStyle(game, myId, opponentId).formation).toBe('4-4-2');
  });
});

describe('チームの弱いところ', () => {
  it('ある位置の選手がいなくなると、その位置が弱いところに出る', () => {
    const game = newGame();
    const club = game.clubs[game.manager.clubId]!;
    const position = FORMATIONS[club.tactics.formation].find((s) => s.position !== 'GK' && s.position !== 'CB')!.position;
    club.playerIds = club.playerIds.filter((id) => game.players[id]?.position !== position);
    const spots = weakSpots(game, club.id);
    expect(spots.map((s) => s.position)).toContain(position);
    const spot = spots.find((s) => s.position === position)!;
    expect(spot.count).toBe(0);
  });

  it('長いケガの選手は、いないものとして数える', () => {
    const game = newGame();
    const club = game.clubs[game.manager.clubId]!;
    const gks = club.playerIds.filter((id) => game.players[id]?.position === 'GK');
    for (const id of gks.slice(1)) {
      game.players[id]!.status.injury = { kind: 'muscle', part: '太もも', date: game.date, days: 60, daysLeft: 60 } as never;
    }
    const gk = weakSpots(game, club.id).find((s) => s.position === 'GK');
    expect(gk).toBeDefined();
    expect(gk!.count).toBe(1);
  });
});

describe('ホームの今やること', () => {
  it('メンバーが決まっていなければ、試合前の問題として出る', () => {
    const game = newGame();
    game.clubs[game.manager.clubId]!.selection = null;
    const todos = homeTodos(game);
    expect(todos[0]?.kind).toBe('problem');
    expect(todos[0]?.screen.name).toBe('tactics');
  });

  it('疲れのたまった先発がいると、コーチのおすすめに出る', () => {
    const game = newGame();
    const club = game.clubs[game.manager.clubId]!;
    const starter = game.players[club.selection!.lineup[3]!]!;
    starter.status.fatigue = 85;
    const tired = homeTodos(game).find((t) => t.key.startsWith('advice:tired'));
    expect(tired?.text).toContain(starter.name);
  });
});

describe('アシスタントコーチ', () => {
  it('名前はクラブごとに決まり、何度呼んでも同じ', () => {
    const game = newGame();
    const ids = Object.keys(game.clubs);
    expect(coachName(game, ids[0]!)).toBe(coachName(game, ids[0]!));
    expect(coachName(game, ids[0]!).length).toBeGreaterThan(2);
  });

  it('財務とクラブの画面は、経営の画面としてあつかう。試合の画面では話さない', () => {
    expect(coachScreenOf('finance')).toBe('management');
    expect(coachScreenOf('myClub')).toBe('management');
    expect(coachScreenOf('tactics')).toBe('tactics');
    expect(coachScreenOf('match')).toBeNull();
  });

  it('どの画面でも一言があり、話した一言は繰り返さない', () => {
    const game = newGame();
    for (const screen of COACH_SCREENS) {
      expect(coachLines(game, screen).length, screen).toBeGreaterThan(0);
      const seen = new Set<string>();
      const keys: string[] = [];
      for (let i = 0; i < 5; i++) {
        const line = pickCoachLine(game, screen, seen);
        if (!line) break;
        keys.push(line.key);
        seen.add(`${game.seed}:${line.key}`);
      }
      expect(new Set(keys).size, screen).toBe(keys.length);
    }
  });
});

describe('練習の予定', () => {
  it('試合の日、その前日と翌日は軽め、ほかはふつう', () => {
    const game = newGame();
    const myId = game.manager.clubId;
    const fixture = game.fixtures.find((f) => f.result === null && (f.homeId === myId || f.awayId === myId))!;
    expect(trainingDayKind(game, fixture.date)).toBe('match');
    expect(trainingDayKind(game, addDays(fixture.date, -1))).toBe('light');
    expect(trainingDayKind(game, addDays(fixture.date, 1))).toBe('light');
    expect(trainingDayKind(game, addDays(fixture.date, -3))).toBe('normal');
  });
});

describe('交渉の進み具合', () => {
  const bid = (fields: Partial<TransferBid>): TransferBid => ({
    id: 'b1', kind: 'transfer', playerId: 'p1', sellerId: 'other', buyerId: 'me', fee: 1e7, wageShare: 1, status: 'waiting',
    date: '2027-01-10', due: '2027-01-14', counter: null, contract: null, rounds: 0, note: '', ...fields,
  });

  it('買う側は、申し込み→クラブの返事→選手との契約→加入', () => {
    expect(bidSteps(bid({}), 'me')).toEqual({ steps: ['申し込み', 'クラブの返事', '選手との契約', '加入'], current: 1 });
    expect(bidSteps(bid({ status: 'countered' }), 'me').current).toBe(1);
    expect(bidSteps(bid({ status: 'accepted' }), 'me').current).toBe(2);
    expect(bidSteps(bid({ status: 'agreed' }), 'me').current).toBe(3);
    expect(bidSteps(bid({ status: 'done' }), 'me').current).toBe(4);
  });

  it('レンタルには選手との契約がなく、売る側は段階が3つ', () => {
    expect(bidSteps(bid({ kind: 'loan', status: 'agreed' }), 'me')).toEqual({ steps: ['申し込み', 'クラブの返事', '加入'], current: 2 });
    expect(bidSteps(bid({ buyerId: 'other', sellerId: 'me' }), 'me').steps).toHaveLength(3);
  });
});
