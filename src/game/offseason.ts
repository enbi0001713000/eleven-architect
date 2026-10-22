// シーズンの切り替え。要件定義書「成長と衰え」の「引退はシーズン終了時に発表する」と、シーズンの暦に対応する。
//
// 12月10日 シーズンの総括（記録を残す、表彰）
// 12月1日  契約の更新の締め切り（contracts.ts）
// 12月20日 引退の発表
// 1月1日   新しい年：年齢が1つ上がり、引退した選手が去り、契約満了の選手が移り、新しい日程が発表される
// 1月10日  新人の加入（内定した高校生・大学生と、強化部が獲る新人。prospects.ts）
// 1月20日  キャンプ開始

import { FOREIGN_NAMES } from '../data/names';
import { generatePlayer } from '../data/generate';
import { overallRating } from '../engine/ratings';
import type { Rng } from '../engine/rng';
import { monthDay, yearOf } from './dates';
import { playerPhase2Fields } from './defaults';
import { decideRetirement, potentialFor } from './development';
import { completeExpiries } from './contracts';
import { seasonEndMoney } from './finance';
import { addMessage } from './inbox';
import { newcomers, uniqueName } from './prospects';
import { pruneScouting } from './scouting';
import { LEAGUE_RULES } from './rules';
import { makeSchedule, seasonDates } from './schedule';
import { averageRating } from './season';
import { repairSelection } from './selection';
import { standingsOf } from './standings';
import type { GameState, PlayerRecord } from './types';
import { emptySeason, SQUAD_TEMPLATE } from './world';

const isSeasonDone = (state: GameState): boolean => state.season.round > LEAGUE_RULES.rounds;

/** 日付に合わせて、シーズンの切り替えの出来事を起こす（advanceDay が毎日呼ぶ） */
export function seasonEvents(state: GameState, rng: Rng): void {
  const day = monthDay(state.date);
  const done = isSeasonDone(state);
  if (day === '12-10' && done && yearOf(state.date) === state.season.year) seasonReview(state);
  if (day === '12-20' && done && yearOf(state.date) === state.season.year) retirements(state, rng);
  if (day === '01-01' && done && yearOf(state.date) === state.season.year + 1) newSeason(state, rng);
  if (day === '01-10' && !done && state.season.round === 1 && yearOf(state.date) === state.season.year) newcomers(state, rng);
  if (day === '01-20' && state.season.round === 1 && yearOf(state.date) === state.season.year) campStarts(state);
}

const leaguePlayers = (state: GameState): PlayerRecord[] => Object.values(state.players).filter((p) => p.clubId !== null);

export function seasonReview(state: GameState): void {
  const table = standingsOf(state);
  const champion = table[0];
  const myId = state.manager.clubId;
  const mine = table.find((r) => r.clubId === myId);
  const scorer = leaguePlayers(state).sort((a, b) => b.season.goals - a.season.goals || a.season.minutes - b.season.minutes)[0];
  const best = leaguePlayers(state).filter((p) => p.season.minutes >= 1500)
    .sort((a, b) => (averageRating(b.season) ?? 0) - (averageRating(a.season) ?? 0))[0];
  if (state.history.some((h) => h.year === state.season.year)) return;
  state.history.push({
    year: state.season.year,
    table: table.map((r) => ({
      clubId: r.clubId, position: r.position, won: r.won, drawn: r.drawn, lost: r.lost,
      goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst, points: r.points,
    })),
    championId: champion?.clubId ?? '',
    topScorer: scorer ? { playerId: scorer.id, name: scorer.name, clubId: scorer.clubId, goals: scorer.season.goals } : null,
    bestPlayer: best ? { playerId: best.id, name: best.name, clubId: best.clubId, rating: averageRating(best.season) ?? 0 } : null,
    manager: { clubId: myId, position: mine?.position ?? 0 },
  });
  seasonEndMoney(state, table);
  const club = (id: string | null | undefined) => (id ? state.clubs[id]?.name ?? '' : '');
  addMessage(state, {
    category: 'league', from: 'リーグ事務局', important: true,
    subject: `${state.season.year}年シーズンの総括`,
    body: [
      `優勝：${club(champion?.clubId)}（勝ち点${champion?.points ?? 0}）`,
      mine ? `${club(myId)}は${mine.position}位（勝ち点${mine.points}、${mine.won}勝${mine.drawn}分${mine.lost}敗）でした。` : '',
      scorer ? `得点王：${scorer.name}（${club(scorer.clubId)}、${scorer.season.goals}点）` : '',
      best ? `平均評価点トップ：${best.name}（${club(best.clubId)}、${(averageRating(best.season) ?? 0).toFixed(2)}）` : '',
      '',
      '12月20日に引退する選手と契約の更新が発表され、1月1日に新しいシーズンの日程が決まります。',
    ].filter((l, i) => l !== '' || i === 4).join('\n'),
  });
}

export function retirements(state: GameState, rng: Rng): void {
  const myId = state.manager.clubId;
  const myRetiring: PlayerRecord[] = [];
  const famous: PlayerRecord[] = [];
  for (const player of Object.values(state.players)) {
    if (player.retired || player.retiring || player.leaving) continue;
    if (!decideRetirement(rng, player)) continue;
    player.retiring = true;
    if (player.clubId === myId) myRetiring.push(player);
    else if (player.clubId && overallRating(player) >= 13) famous.push(player);
  }

  addMessage(state, {
    category: 'club', from: '強化部', important: true,
    subject: '引退する選手',
    body: [
      myRetiring.length > 0
        ? `今シーズン限りで引退する選手：${myRetiring.map((p) => `${p.name}（${p.age}歳）`).join('、')}`
        : 'このクラブから引退する選手はいません。',
      famous.length > 0 ? `他クラブの主な引退：${famous.slice(0, 6).map((p) => `${p.name}（${state.clubs[p.clubId ?? '']?.shortName ?? ''}、${p.age}歳）`).join('、')}` : '',
    ].filter((l) => l !== '').join('\n'),
  });
}

export function newSeason(state: GameState, rng: Rng): void {
  const year = state.season.year + 1;
  const myId = state.manager.clubId;

  for (const player of Object.values(state.players)) {
    // 今シーズンの記録を経歴に残す
    if (player.season.appearances > 0 || player.clubId) {
      player.career.push({
        year: state.season.year, clubId: player.clubId, appearances: player.season.appearances,
        goals: player.season.goals, assists: player.season.assists, averageRating: averageRating(player.season),
      });
      if (player.career.length > 25) player.career.shift();
    }
    if (player.retiring) {
      const club = player.clubId ? state.clubs[player.clubId] : undefined;
      if (club) club.playerIds = club.playerIds.filter((id) => id !== player.id);
      state.overseasPool = state.overseasPool.filter((id) => id !== player.id);
      delete state.players[player.id];
      continue;
    }
    player.age++;
    player.season = emptySeason();
    player.discipline.yellowAccumulation = 0;
    player.status.recentRatings = [];
    player.status.morale = 60 + (player.status.morale - 60) * 0.5;
    player.lastTalk = null;
  }

  // 契約満了の選手：仮の契約をしたクラブへ移るか、所属なしになる
  completeExpiries(state);

  // 海外の選手プールを補充する
  const names = new Set(Object.values(state.players).map((p) => p.name));
  const positions = SQUAD_TEMPLATE.flatMap(([position, count]) => Array.from({ length: count }, () => position));
  const nationalities = Object.keys(FOREIGN_NAMES);
  while (state.overseasPool.length < 120) {
    const nationality = rng.pick(nationalities);
    const base = generatePlayer(rng, rng.pick(positions), 9 + rng.next() * 5, {
      id: `p${String(state.nextPlayerNumber++).padStart(4, '0')}`, age: rng.int(19, 27), nationality,
    });
    base.name = uniqueName(rng, names, base.name, nationality);
    base.hidden.potential = potentialFor(rng, overallRating(base), base.age);
    state.players[base.id] = {
      ...base, clubId: null, squadNumber: null, contract: null, season: emptySeason(),
      discipline: { yellowAccumulation: 0, suspendedMatches: 0 }, ...playerPhase2Fields(),
    };
    state.overseasPool.push(base.id);
  }

  pruneScouting(state);
  state.season = { year, round: 1 };
  state.fixtures = makeSchedule(Object.keys(state.clubs), rng, year);
  state.requests = [];
  state.promises = [];

  const club = state.clubs[myId];
  if (club?.selection) club.selection = repairSelection(state, myId, club.tactics.formation, club.selection);
  const first = state.fixtures.find((f) => f.round === 1 && (f.homeId === myId || f.awayId === myId));
  const opponent = first ? state.clubs[first.homeId === myId ? first.awayId : first.homeId] : undefined;
  addMessage(state, {
    category: 'league', from: 'リーグ事務局', important: true,
    subject: `${year}年シーズンの日程が発表されました`,
    body: [
      `開幕は${seasonDates(year)[0] ?? ''}。`,
      first ? `開幕戦は${opponent?.name}と${first.homeId === myId ? 'ホーム' : 'アウェイ'}で対戦します。` : '',
      '選手は1つ年を取り、引退した選手はチームを離れました。1月10日に新人が加入します。',
    ].filter((l) => l !== '').join('\n'),
  });
}

function campStarts(state: GameState): void {
  addMessage(state, {
    category: 'training', from: 'アシスタントコーチ', important: false,
    subject: 'キャンプが始まりました',
    body: '開幕に向けたキャンプが始まりました。練習の方針を決めて、チームミーティングでシーズンの目標を共有しておくと良いでしょう。\n新しい戦術を試すなら、熟成度を上げる時間があるこの時期がおすすめです。',
  });
}
