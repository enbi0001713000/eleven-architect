// シーズンの切り替え。要件定義書「成長と衰え」の「引退はシーズン終了時に発表する」と、シーズンの暦に対応する。
//
// 12月10日 シーズンの総括（記録を残す、表彰）
// 12月20日 引退の発表と、契約の自動更新（契約の交渉はフェーズ4で追加）
// 1月1日   新しい年：年齢が1つ上がり、引退した選手が去り、新しい日程が発表される
// 1月10日  新人の加入（スカウトでの獲得はフェーズ4で追加。それまでは自動で入る）
// 1月20日  キャンプ開始

import { FOREIGN_NAMES } from '../data/names';
import { generatePlayer, playerName } from '../data/generate';
import { overallRating } from '../engine/ratings';
import type { Rng } from '../engine/rng';
import type { Position } from '../engine/types';
import { BALANCE } from './balance';
import { monthDay, yearOf } from './dates';
import { assignSquadRoles, defaultStatus, playerPhase2Fields, roleByRank } from './defaults';
import { decideRetirement } from './development';
import { addMessage } from './inbox';
import { HOME_NATIONALITY, LEAGUE_RULES } from './rules';
import { makeSchedule, seasonDates } from './schedule';
import { averageRating } from './season';
import { repairSelection } from './selection';
import { standingsOf } from './standings';
import type { GameState, PlayerRecord } from './types';
import { emptySeason, salaryFor, SIZE_PROFILE, SQUAD_TEMPLATE } from './world';

const isSeasonDone = (state: GameState): boolean => state.season.round > LEAGUE_RULES.rounds;

/** AIのクラブが契約を更新しない選手：序列がこれより下で、25歳以上 */
const RELEASE_RANK = 22;
/** 退団させても、この人数は残す */
const RELEASE_MIN_SQUAD = 24;

/** 日付に合わせて、シーズンの切り替えの出来事を起こす（advanceDay が毎日呼ぶ） */
export function seasonEvents(state: GameState, rng: Rng): void {
  const day = monthDay(state.date);
  const done = isSeasonDone(state);
  if (day === '12-10' && done && yearOf(state.date) === state.season.year) seasonReview(state);
  if (day === '12-20' && done && yearOf(state.date) === state.season.year) retirementsAndContracts(state, rng);
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

export function retirementsAndContracts(state: GameState, rng: Rng): void {
  const myId = state.manager.clubId;
  const year = state.season.year;
  const myRetiring: PlayerRecord[] = [];
  const famous: PlayerRecord[] = [];
  for (const player of Object.values(state.players)) {
    if (player.retired || player.retiring || player.leaving) continue;
    if (!decideRetirement(rng, player)) continue;
    player.retiring = true;
    if (player.clubId === myId) myRetiring.push(player);
    else if (player.clubId && overallRating(player) >= 13) famous.push(player);
  }

  // 契約が切れる選手は、自動で更新する（交渉はフェーズ4）。
  // AIのクラブは、序列の低いベテランとは更新せず、退団させる（自分のクラブは全員と更新する）
  const renewed: PlayerRecord[] = [];
  const left: PlayerRecord[] = [];
  for (const club of Object.values(state.clubs)) {
    const ranked = club.playerIds.map((id) => state.players[id]).filter((p): p is PlayerRecord => p !== undefined && !p.retiring)
      .sort((a, b) => overallRating(b) - overallRating(a));
    let remaining = ranked.length;
    ranked.forEach((player, rank) => {
      if (!player.contract || player.contract.endYear > year) return;
      if (club.id !== myId && rank >= RELEASE_RANK && player.age >= 25 && remaining > RELEASE_MIN_SQUAD) {
        player.leaving = true;
        remaining--;
        return;
      }
      player.contract = {
        salary: salaryFor(overallRating(player), SIZE_PROFILE[club.size].salary),
        endYear: year + (player.age >= 31 ? 1 : rng.int(1, 3)),
        role: roleByRank(rank, player.age + 1),
      };
      if (club.id === myId) renewed.push(player);
    });
    if (club.id !== myId) left.push(...ranked.filter((p) => p.leaving));
  }

  addMessage(state, {
    category: 'club', from: '強化部', important: true,
    subject: '引退する選手と、契約の更新',
    body: [
      myRetiring.length > 0
        ? `今シーズン限りで引退する選手：${myRetiring.map((p) => `${p.name}（${p.age}歳）`).join('、')}`
        : 'このクラブから引退する選手はいません。',
      famous.length > 0 ? `他クラブの主な引退：${famous.slice(0, 6).map((p) => `${p.name}（${state.clubs[p.clubId ?? '']?.shortName ?? ''}、${p.age}歳）`).join('、')}` : '',
      renewed.length > 0
        ? `契約が切れる${renewed.length}人と、自動で契約を更新しました：${renewed.map((p) => p.name).join('、')}`
        : '',
      left.length > 0 ? `他クラブでは${left.length}人が契約満了で退団します。` : '',
      '（契約の交渉と、契約を更新しない選択は、フェーズ4で追加します）',
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
    if (player.retiring || player.leaving) {
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
    state.players[base.id] = {
      ...base, clubId: null, squadNumber: null, contract: null, season: emptySeason(),
      discipline: { yellowAccumulation: 0, suspendedMatches: 0 }, ...playerPhase2Fields(),
    };
    state.overseasPool.push(base.id);
  }

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

function uniqueName(rng: Rng, names: Set<string>, name: string, nationality: string): string {
  let candidate = name;
  for (let tries = 0; names.has(candidate) && tries < 50; tries++) candidate = playerName(rng, nationality);
  names.add(candidate);
  return candidate;
}

/** 足りないポジション（理想の内訳と比べて、いちばん足りないところ） */
function neededPosition(state: GameState, clubId: string): Position {
  const club = state.clubs[clubId];
  const counts = new Map<Position, number>();
  for (const id of club?.playerIds ?? []) {
    const p = state.players[id];
    if (p) counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
  }
  let best: Position = 'CM';
  let bestGap = -Infinity;
  for (const [position, ideal] of SQUAD_TEMPLATE) {
    const gap = (ideal - (counts.get(position) ?? 0)) / ideal;
    if (gap > bestGap) {
      best = position;
      bestGap = gap;
    }
  }
  return best;
}

export function newcomers(state: GameState, rng: Rng): void {
  const myId = state.manager.clubId;
  const year = state.season.year;
  const names = new Set(Object.values(state.players).map((p) => p.name));
  const mine: PlayerRecord[] = [];
  for (const club of Object.values(state.clubs)) {
    const count = club.playerIds.length;
    // 引退で減った分を埋める。毎年2人以上は入れる（登録の上限まで）
    const need = Math.min(LEAGUE_RULES.squadMax - count, Math.max(BALANCE.squadTarget - count, 2));
    const numbers = new Set(club.playerIds.map((id) => state.players[id]?.squadNumber));
    for (let i = 0; i < need; i++) {
      const position = neededPosition(state, club.id);
      const fromHighSchool = rng.chance(0.55);
      const age = fromHighSchool ? 18 : 22;
      const level = club.level - (fromHighSchool ? 3.2 : 2.4) + rng.normal(0, 0.6);
      const base = generatePlayer(rng, position, level, {
        id: `p${String(state.nextPlayerNumber++).padStart(4, '0')}`, age, nationality: HOME_NATIONALITY,
      });
      base.name = uniqueName(rng, names, base.name, base.nationality);
      base.hidden.potential = Math.round(Math.max(overallRating(base) + 1, Math.min(18.5, club.level + rng.normal(0.3, 1.6))) * 10) / 10;
      let number = 2;
      while (numbers.has(number)) number++;
      numbers.add(number);
      const record: PlayerRecord = {
        ...base,
        clubId: club.id,
        squadNumber: number,
        contract: { salary: salaryFor(overallRating(base), SIZE_PROFILE[club.size].salary), endYear: year + 2, role: 'youth' },
        season: emptySeason(),
        discipline: { yellowAccumulation: 0, suspendedMatches: 0 },
        ...playerPhase2Fields(),
        status: defaultStatus(BALANCE.newcomerIntegration),
      };
      state.players[record.id] = record;
      club.playerIds.push(record.id);
      if (club.id === myId) mine.push(record);
    }
    if (club.id !== myId) assignSquadRoles(state, club.id);
  }
  addMessage(state, {
    category: 'club', from: '強化部', important: true,
    subject: '新人選手が加入しました',
    body: mine.length > 0
      ? `${mine.map((p) => `${p.name}（${p.position}、${p.age}歳、総合力 ${overallRating(p).toFixed(1)}）`).join('\n')}\n\n新しく入った選手は、まだ戦術に慣れていません。（高校生・大学生のスカウトはフェーズ4で追加します）`
      : '今年は新人の加入はありません（登録の上限に達しています）。',
  });
}

function campStarts(state: GameState): void {
  addMessage(state, {
    category: 'training', from: 'アシスタントコーチ', important: false,
    subject: 'キャンプが始まりました',
    body: '開幕に向けたキャンプが始まりました。練習の方針を決めて、チームミーティングでシーズンの目標を共有しておくと良いでしょう。\n新しい戦術を試すなら、熟成度を上げる時間があるこの時期がおすすめです。',
  });
}
