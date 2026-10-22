// フェーズ4-A の契約のテスト（市場価値、代理人、選手の希望、更新の交渉、締め切り、契約満了の選手の移籍、古いセーブ）

import { describe, expect, it } from 'vitest';
import { simulateMatch } from '../src/engine/match';
import { overallRating } from '../src/engine/ratings';
import type { MatchResult } from '../src/engine/types';
import { AGENT_STYLES, CONTRACT } from '../src/game/contractBalance';
import {
  agentOf, askingSalary, createAgents, deservedRole, marketPlayers, marketValue, marketValueRange, maxYears, neededSalary,
  offerContract, projectedSquad, talkStatus, wageRoom, type ContractOffer,
} from '../src/game/contracts';
import { createRng } from '../src/engine/rng';
import { advanceDay, todaysFixture } from '../src/game/progress';
import { parseSaveFile, toSaveFile } from '../src/game/save';
import { applyMatchday, prepareMatchday } from '../src/game/season';
import type { GameState, PlayerRecord } from '../src/game/types';
import { createWorld, startNewGame } from '../src/game/world';

function newGame(seed = 41, index = 3): GameState {
  const world = createWorld(seed);
  return startNewGame(world, 'テスト監督', Object.keys(world.clubs)[index]!);
}

function playUntil(state: GameState, date: string, each?: (s: GameState) => void): void {
  while (state.date < date) {
    if (todaysFixture(state)) {
      const results: Record<string, MatchResult> = {};
      for (const m of prepareMatchday(state)) results[m.fixture.id] = simulateMatch(m.home, m.away, { seed: m.seed, detailedCommentary: false });
      applyMatchday(state, results);
    } else {
      advanceDay(state);
    }
    each?.(state);
  }
}

const myPlayers = (state: GameState): PlayerRecord[] =>
  state.clubs[state.manager.clubId]!.playerIds.map((id) => state.players[id]!).sort((a, b) => overallRating(b) - overallRating(a));

/** 代理人の希望どおりの条件 */
function fairOffer(state: GameState, player: PlayerRecord, clubId: string): ContractOffer {
  const kind = player.clubId === clubId && !player.leaving ? 'renewal' : 'signing';
  const offer: ContractOffer = {
    salary: 0, role: deservedRole(state, player, clubId), years: Math.min(maxYears(player), CONTRACT.preferredYears(player.age)),
    clauseMultiple: CONTRACT.defaultClause, bonus: { appearance: 0, goal: 0 },
  };
  return { ...offer, salary: neededSalary(state, player, clubId, kind, offer).salary };
}

describe('市場価値', () => {
  it('若くて伸びしろがあるほど高く、契約が残り少ないと下がる。J1の主力で1億円くらい', () => {
    const state = newGame();
    const player = myPlayers(state)[0]!;
    const year = state.season.year;
    const base = { ...player, contract: { ...player.contract!, endYear: year + 3 } };
    const young = { ...base, age: 20, hidden: { ...base.hidden, potential: overallRating(base) + 3 } };
    const old = { ...base, age: 32 };
    expect(marketValue(young, year)).toBeGreaterThan(marketValue(base, year));
    expect(marketValue(old, year)).toBeLessThan(marketValue(base, year));
    expect(marketValue({ ...base, contract: { ...base.contract, endYear: year } }, year)).toBeLessThan(marketValue(base, year));

    const all = Object.values(state.players).filter((p) => p.clubId);
    const starters = all.filter((p) => p.age >= 25 && p.age <= 27 && Math.abs(overallRating(p) - 13) < 0.3 && p.contract!.endYear > year + 1);
    const typical = starters.map((p) => marketValue(p, year)).sort((a, b) => a - b)[Math.floor(starters.length / 2)]!;
    expect(typical).toBeGreaterThan(0.6e8);
    expect(typical).toBeLessThan(1.6e8);
  });

  it('他クラブの選手は幅で見え、本当の値はその中にある', () => {
    const state = newGame();
    const other = Object.values(state.players).find((p) => p.clubId && p.clubId !== state.manager.clubId)!;
    const range = marketValueRange(state, other);
    const value = marketValue(other, state.season.year);
    expect(range.exact).toBe(false);
    expect(range.low).toBeLessThanOrEqual(value);
    expect(range.high).toBeGreaterThanOrEqual(value);
    expect(marketValueRange(state, myPlayers(state)[0]!).exact).toBe(true);
  });
});

describe('代理人と選手の希望', () => {
  it('代理人は3つの性格に分かれ、選手ごとに決まっている', () => {
    const agents = createAgents(createRng(1));
    expect(agents).toHaveLength(CONTRACT.agents);
    expect(new Set(agents.map((a) => a.style))).toEqual(new Set(['calm', 'normal', 'tough']));
    const state = newGame();
    const player = myPlayers(state)[0]!;
    expect(agentOf(state, player)).toBe(agentOf(state, player));
  });

  it('強気な代理人ほど高い年俸を求める。役割を下げると高くなり、2段下げると断る。出来高ボーナスで年俸を抑えられる', () => {
    const state = newGame();
    const clubId = state.manager.clubId;
    const star = myPlayers(state)[0]!;
    const offer = { role: deservedRole(state, star, clubId), years: 3, clauseMultiple: 1.5 };
    expect(offer.role).toBe('key');
    const ask = (style: 'calm' | 'tough') => {
      state.agents = state.agents.map((a) => ({ ...a, style }));
      return askingSalary(state, star, clubId, 'signing', offer).salary;
    };
    expect(ask('tough')).toBeGreaterThan(ask('calm'));
    expect(AGENT_STYLES.tough.patience).toBeLessThan(AGENT_STYLES.calm.patience);
    const normal = askingSalary(state, star, clubId, 'signing', offer).salary;
    expect(askingSalary(state, star, clubId, 'signing', { ...offer, role: 'rotation' }).salary).toBeGreaterThan(normal);
    expect(askingSalary(state, star, clubId, 'signing', { ...offer, role: 'backup' }).refuse).not.toBeNull();
    const withBonus = neededSalary(state, star, clubId, 'signing', { ...offer, salary: 0, bonus: { appearance: 50e4, goal: 100e4 } }).salary;
    expect(withBonus).toBeLessThan(normal);
  });
});

describe('更新の交渉', () => {
  it('7月から交渉でき、希望どおりなら合意して契約が延び、代理人の手数料を払う', () => {
    const state = newGame();
    const player = myPlayers(state)[2]!;
    player.contract!.endYear = state.season.year;
    expect(talkStatus(state, player.id).ok).toBe(false);
    state.date = `${state.season.year}-07-01`;
    expect(talkStatus(state, player.id)).toMatchObject({ ok: true, kind: 'renewal' });
    const fees = state.clubs[state.manager.clubId]!.finance.current.expense.agentFees;
    const offer = fairOffer(state, player, state.manager.clubId);
    const answer = offerContract(state, player.id, offer);
    expect(answer.verdict).toBe('accept');
    expect(player.contract!.endYear).toBe(state.season.year + offer.years);
    expect(player.contract!.releaseClause).toBeGreaterThan(0);
    expect(state.clubs[state.manager.clubId]!.finance.current.expense.agentFees).toBeGreaterThan(fees);
  });

  it('安すぎる提示には希望を返し、何度も断られると決裂して14日話せない', () => {
    const state = newGame();
    const player = myPlayers(state)[1]!;
    player.contract!.endYear = state.season.year;
    state.date = `${state.season.year}-08-01`;
    const offer = fairOffer(state, player, state.manager.clubId);
    const first = offerContract(state, player.id, { ...offer, salary: Math.round(offer.salary * 0.9) });
    expect(first.verdict).toBe('counter');
    expect(first.ask).toBe(offer.salary);
    let answer = first;
    for (let i = 0; i < 3 && answer.verdict === 'counter'; i++) answer = offerContract(state, player.id, { ...offer, salary: Math.round(offer.salary * 0.9) });
    expect(answer.verdict).toBe('brokeOff');
    expect(talkStatus(state, player.id).ok).toBe(false);
    expect(state.contractTalks[player.id]!.closedUntil).toBe(`${state.season.year}-08-15`);
  });

  it('年俸予算の残りを超える年俸は提示できない', () => {
    const state = newGame();
    const player = myPlayers(state)[0]!;
    player.contract!.endYear = state.season.year;
    state.date = `${state.season.year}-07-01`;
    const room = wageRoom(state, state.manager.clubId);
    const answer = offerContract(state, player.id, { ...fairOffer(state, player, state.manager.clubId), salary: player.contract!.salary + Math.max(0, room) + 1e8 });
    expect(answer.verdict).toBe('invalid');
    expect(answer.message).toContain('年俸予算');
  });
});

describe('締め切りと、契約満了の選手の移籍', () => {
  it('12月1日に、自分で更新しなかった主力は契約満了。AIクラブが契約満了の選手を獲り、1月1日に移る。決まらない選手は3月28日に去る', () => {
    const state = newGame(43, 5);
    const year = state.season.year;
    const myId = state.manager.clubId;
    const star = myPlayers(state)[0]!;
    star.contract!.endYear = year;
    const backup = myPlayers(state).find((p) => p.contract!.role === 'backup' || p.contract!.role === 'youth')!;
    backup.contract!.endYear = year;

    let preContracts = 0;
    let marketSeen = 0;
    playUntil(state, `${year}-12-31`, (s) => {
      if (s.date === `${year}-12-02`) marketSeen = marketPlayers(s).length;
    });
    expect(star.leaving).toBe(true);
    // 任せた控えの選手は、強化部が更新したか、契約満了になった
    expect(backup.leaving === true || backup.contract!.endYear > year).toBe(true);
    expect(marketSeen).toBeGreaterThan(10);
    const joining = Object.values(state.players).filter((p) => p.joining);
    preContracts = joining.length;
    expect(preContracts).toBeGreaterThan(2);

    // 他クラブの契約満了の選手と、仮の契約をする
    const target = marketPlayers(state).filter((p) => p.clubId !== myId).sort((a, b) => overallRating(b) - overallRating(a))
      .find((p) => !askingSalary(state, p, myId, 'signing', { role: deservedRole(state, p, myId), years: 2, clauseMultiple: 1.5 }).refuse
        && neededSalary(state, p, myId, 'signing', { ...fairOffer(state, p, myId) }).salary <= wageRoom(state, myId));
    expect(target).toBeDefined();
    expect(offerContract(state, target!.id, fairOffer(state, target!, myId)).verdict).toBe('accept');
    expect(target!.joining?.clubId).toBe(myId);

    const movers = joining.map((p) => [p.id, p.joining!.clubId] as const);
    playUntil(state, `${year + 1}-01-02`);
    expect(target!.clubId).toBe(myId);
    expect(state.clubs[myId]!.playerIds).toContain(target!.id);
    for (const [id, clubId] of movers) {
      if (state.players[id]) expect(state.players[id]!.clubId).toBe(clubId);
    }
    expect(state.freeAgents.length).toBeGreaterThan(0);
    expect(state.players[star.id]?.clubId ?? null).not.toBe(myId);

    playUntil(state, `${year + 1}-03-29`);
    expect(state.freeAgents).toHaveLength(0);
    for (const club of Object.values(state.clubs)) {
      expect(club.playerIds.length).toBeGreaterThanOrEqual(CONTRACT.newcomerMinSquad);
      expect(club.playerIds.length).toBeLessThanOrEqual(30);
      // 来季の見込み：レンタルで借りている選手は除き、貸している選手は足す
      const here = club.playerIds.filter((id) => !state.players[id]!.loan).length;
      const lent = Object.values(state.players).filter((p) => p.loan?.fromClubId === club.id).length;
      expect(projectedSquad(state, club.id).length).toBe(here + lent);
    }
    // 背番号が重ならない
    for (const club of Object.values(state.clubs)) {
      const numbers = club.playerIds.map((id) => state.players[id]!.squadNumber);
      expect(new Set(numbers).size).toBe(numbers.length);
    }
  }, 120000);
});

describe('古いセーブデータ（版6）', () => {
  it('フェーズ3-Cのセーブデータを読み込むと、代理人と違約金が足される', () => {
    const state = newGame();
    const v6 = structuredClone(state) as unknown as Record<string, unknown>;
    delete v6.agents;
    delete v6.freeAgents;
    delete v6.contractTalks;
    delete v6.contractDelegation;
    for (const p of Object.values(v6.players as Record<string, { contract: Record<string, unknown> | null }>)) {
      if (p.contract) {
        delete p.contract.releaseClause;
        delete p.contract.bonus;
      }
    }
    v6.version = 6;
    const loaded = parseSaveFile(JSON.stringify({ ...toSaveFile(state), version: 6, state: v6 }));
    expect(loaded.version).toBe(9);
    expect(loaded.agents).toHaveLength(CONTRACT.agents);
    expect(loaded.freeAgents).toEqual([]);
    const player = Object.values(loaded.players).find((p) => p.contract)!;
    expect(player.contract!.releaseClause).toBeGreaterThan(0);
    expect(player.contract!.bonus).toBeNull();
    advanceDay(loaded);
  });
});
