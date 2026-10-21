// モラル（やる気）。試合結果、出場時間、約束した役割が守られているかで変わり、試合での出来に影響する。
// 要件定義書「成長と衰え」の「モラル」と、「面談と声かけ」の「選手からの申し出」「約束」に対応する。

import type { Rng } from '../engine/rng';
import { BALANCE } from './balance';
import { adjustMorale } from './condition';
import { addDays } from './dates';
import { addMessage } from './inbox';
import type { GameState, PlayerPromise, PlayerRecord, SquadRole } from './types';

export const SQUAD_ROLE_LABEL: Record<SquadRole, string> = {
  key: '主力', rotation: 'ローテーション', backup: '控え', youth: '若手',
};

export function expectedPlayingTime(player: PlayerRecord): number {
  return BALANCE.expectedPlayingTime[player.contract?.role ?? 'backup'];
}

/** 出場機会が、約束した役割より明らかに少ない */
export function isUnhappyWithPlayingTime(player: PlayerRecord): boolean {
  return player.status.playingTime < expectedPlayingTime(player) - 0.25;
}

/** 毎日：モラルは少しずつ普通に戻る。出場機会に不満があると、戻る先が低くなる */
export function dailyMorale(state: GameState, player: PlayerRecord): void {
  const promised = state.promises.some((p) => p.playerId === player.id);
  const target = isUnhappyWithPlayingTime(player) && !promised && state.season.round > 4 ? 42 : 60;
  player.status.morale += (target - player.status.morale) * BALANCE.moraleDrift;
}

/**
 * 試合の後：結果、自分の出来、出場できたか。
 * share は出場の度合い（先発1、途中出場0.5、ベンチ0.1、メンバー外0）。出られない状態の選手は null。
 */
export function afterMatchMorale(player: PlayerRecord, outcome: 1 | 0 | -1, derby: boolean, rating: number | null, share: number | null): void {
  let delta = outcome * 3 * (derby ? 1.5 : 1);
  if (rating !== null) {
    if (rating >= 7.5) delta += 3;
    else if (rating >= 7.0) delta += 1.5;
    else if (rating < 6.0) delta -= 2;
  }
  if (share !== null) {
    player.status.playingTime = player.status.playingTime * 0.85 + share * 0.15;
    if (share === 0 && player.contract?.role === 'key') delta -= 2;
  }
  adjustMorale(player, delta);
}

/** 毎週：出場機会に不満のある選手が、話をしに来る（1週間に1人まで） */
export function maybePlayerRequest(rng: Rng, state: GameState): void {
  const club = state.clubs[state.manager.clubId];
  if (!club || state.season.round <= 5) return;
  const since = addDays(state.date, -30);
  const recentRequest = state.inbox.some((m) => m.action?.kind === 'playerRequest' && m.date > since);
  if (recentRequest) return;
  // 同じ選手が申し出るのは、60日に1回まで
  const askedRecently = new Set(state.inbox
    .filter((m) => m.action?.kind === 'playerRequest' && m.date > addDays(state.date, -60))
    .map((m) => m.playerId));
  const candidates = club.playerIds.map((id) => state.players[id]).filter((p): p is PlayerRecord =>
    p !== undefined && p.status.injury === null && isUnhappyWithPlayingTime(p) && p.status.morale < 50
    && !askedRecently.has(p.id)
    && !state.promises.some((pr) => pr.playerId === p.id)
    && !state.requests.some((r) => r.playerId === p.id));
  if (candidates.length === 0) return;
  const player = candidates.sort((a, b) => a.status.morale - b.status.morale)[0] as PlayerRecord;
  if (!rng.chance(0.35 + player.hidden.ambition / 40)) return;
  const id = `r${state.nextMessageNumber}`;
  state.requests.push({ id, playerId: player.id, kind: 'playingTime', date: state.date });
  addMessage(state, {
    category: 'player', from: player.name, important: true, playerId: player.id,
    subject: `${player.name}が出場機会について話したいと言っています`,
    body: `監督、少しお時間をいただけますか。\n${SQUAD_ROLE_LABEL[player.contract?.role ?? 'backup']}として契約したのに、最近はほとんど試合に出られていません。このままでは納得できません。`,
    action: { kind: 'playerRequest', requestId: id },
  });
}

/** 約束の進み具合（先発の回数） */
export function promiseProgress(state: GameState, promise: PlayerPromise): number {
  const player = state.players[promise.playerId];
  return player ? player.season.starts - promise.startsAtPromise : 0;
}

/** 試合の後：約束が守られたか、期限が過ぎたかを確かめる */
export function checkPromises(state: GameState, seasonOver: boolean): void {
  const remaining: PlayerPromise[] = [];
  for (const promise of state.promises) {
    const player = state.players[promise.playerId];
    if (!player || player.clubId !== state.manager.clubId) continue;
    const done = promiseProgress(state, promise);
    if (done >= promise.target) {
      adjustMorale(player, 8);
      addMessage(state, {
        category: 'player', from: player.name, important: false, playerId: player.id,
        subject: `${player.name}：約束を守ってくれた`,
        body: `${player.name}は、約束どおり試合に出してもらえたことに満足しています。`,
      });
      continue;
    }
    // 試合の後、節を進める前に呼ばれるので、今の節が期限の節なら締め切る
    if (seasonOver || state.season.round >= promise.untilRound || promise.year !== state.season.year) {
      adjustMorale(player, -25);
      player.status.playingTime = Math.min(player.status.playingTime, 0.05);
      addMessage(state, {
        category: 'player', from: player.name, important: true, playerId: player.id,
        subject: `${player.name}：約束が守られなかった`,
        body: `${player.name}は、約束した出場機会（先発${promise.target}試合）が守られなかったことに強い不満を持っています。（先発 ${done}試合）`,
      });
      continue;
    }
    remaining.push(promise);
  }
  state.promises = remaining;
}
