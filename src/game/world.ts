// 新しいゲームを始めるときの世界の自動生成。要件定義書「リーグと日程」の「選手と世界の自動生成」に対応する。
// 同じシードなら、同じ世界（クラブ、選手、日程）ができる。

import { generatePlayer, playerName } from '../data/generate';
import { FOREIGN_NAMES, GIVEN_NAMES, SURNAMES } from '../data/names';
import { overallRating } from '../engine/ratings';
import { createRng, type Rng } from '../engine/rng';
import type { FormationName, Position, TeamInstructions } from '../engine/types';
import { CLUB_SEEDS, type ClubSeed } from './clubData';
import { assignSquadRoles, defaultClubTraining, defaultFamiliarity, playerPhase2Fields } from './defaults';
import { potentialFor } from './development';
import { addMessage } from './inbox';
import { makeSchedule, seasonDates } from './schedule';
import { autoSelect } from './selection';
import type { Club, ClubSize, EmblemSpec, GameState, PlayerRecord } from './types';

export const START_YEAR = 2027;
export const STATE_VERSION = 2;

/** 1クラブ28人の内訳 */
export const SQUAD_TEMPLATE: [Position, number][] = [
  ['GK', 3], ['CB', 5], ['SB', 4], ['DM', 2], ['CM', 4], ['AM', 2], ['WM', 2], ['W', 3], ['FW', 3],
];

/** 規模ごとの数値。売上の幅は要件定義書「金額の目安」の案に合わせている */
export const SIZE_PROFILE: Record<ClubSize, {
  level: [number, number]; reputation: [number, number]; capacity: [number, number];
  fans: [number, number]; revenue: [number, number]; salary: number;
}> = {
  large: { level: [13.4, 14.0], reputation: [75, 85], capacity: [40000, 60000], fans: [400000, 700000], revenue: [85e8, 115e8], salary: 1.1 },
  medium: { level: [11.6, 13.0], reputation: [55, 72], capacity: [22000, 40000], fans: [150000, 400000], revenue: [45e8, 85e8], salary: 1 },
  small: { level: [10.2, 11.2], reputation: [40, 52], capacity: [15000, 25000], fans: [60000, 150000], revenue: [19e8, 45e8], salary: 0.85 },
};

/** 規模ごとのクラブ数（大4・中10・小4） */
const SIZE_COUNTS: [ClubSize, number][] = [['large', 4], ['medium', 10], ['small', 4]];

const FORMATION_CHOICES: FormationName[] = ['4-4-2', '4-3-3', '4-2-3-1'];

const between = (rng: Rng, [lo, hi]: [number, number]): number => lo + rng.next() * (hi - lo);

/** 総合力から年俸（円）の目安を決める。要件定義書「金額の目安」の年俸の区分に合わせた折れ線 */
export function salaryFor(overall: number, factor: number): number {
  const points: [number, number][] = [
    [8, 480e4], [10, 1200e4], [11, 2500e4], [12, 4000e4], [13, 7000e4], [14, 1e8], [15, 1.5e8], [16, 2.2e8], [17, 3e8],
  ];
  const first = points[0] as [number, number];
  const lastPoint = points[points.length - 1] as [number, number];
  let yen = overall <= first[0] ? first[1] : lastPoint[1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1] as [number, number];
    const [x1, y1] = points[i] as [number, number];
    if (overall >= x0 && overall <= x1) {
      yen = y0 + ((overall - x0) / (x1 - x0)) * (y1 - y0);
      break;
    }
  }
  return Math.max(480e4, Math.round((yen * factor) / 1e5) * 1e5);
}

export function emptySeason(): PlayerRecord['season'] {
  return { appearances: 0, starts: 0, minutes: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, ratingTotal: 0, ratingCount: 0 };
}

function makeEmblem(rng: Rng, seed: ClubSeed): EmblemSpec {
  return {
    shape: rng.pick(['shield', 'round', 'crest', 'diamond'] as const),
    pattern: rng.pick(['plain', 'stripes', 'halves', 'band', 'chevron', 'hoops'] as const),
    symbol: rng.pick(['star', 'ball', 'wave', 'mountain', 'bird', 'flame'] as const),
    primary: seed.colors.primary,
    secondary: seed.colors.secondary,
    accent: rng.pick(['#ffffff', '#1a1a1a', '#d4af37']),
    initials: seed.initials,
  };
}

function randomInstructions(rng: Rng, size: ClubSize): TeamInstructions {
  // 多くのクラブは標準に近い。極端な指示に偏った世界にならないように、0を半分の確率にする
  const small = () => (rng.chance(0.5) ? 0 : rng.chance(0.5) ? 1 : -1);
  return {
    mentality: size === 'large' ? (rng.chance(0.6) ? 0 : 1) : size === 'small' ? (rng.chance(0.6) ? 0 : -1) : small(),
    defensiveLine: small(),
    pressing: small(),
    width: small(),
    passingLength: small(),
    tempo: small(),
  };
}

export function createWorld(seed: number): GameState {
  const rng = createRng(seed);
  let counter = 0;
  const nextId = () => `p${String(++counter).padStart(4, '0')}`;
  // 同じ名前の選手が出ないようにする
  const usedNames = new Set<string>();
  const uniqueName = (name: string, nationality: string): string => {
    let candidate = name;
    for (let tries = 0; usedNames.has(candidate) && tries < 50; tries++) candidate = playerName(rng, nationality);
    usedNames.add(candidate);
    return candidate;
  };
  const players: Record<string, PlayerRecord> = {};
  const clubs: Record<string, Club> = {};

  const sizes = SIZE_COUNTS.flatMap(([size, count]) => Array.from({ length: count }, () => size));
  for (let i = sizes.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [sizes[i], sizes[j]] = [sizes[j] as ClubSize, sizes[i] as ClubSize];
  }

  CLUB_SEEDS.forEach((clubSeed, index) => {
    const size = sizes[index] ?? 'medium';
    const profile = SIZE_PROFILE[size];
    const level = Math.round(between(rng, profile.level) * 10) / 10;
    const playerIds: string[] = [];
    let squadNumber = 1;
    const youthSlots = new Set([rng.int(3, 27), rng.int(3, 27), rng.int(3, 27)]);
    let slotIndex = 0;
    for (const [position, count] of SQUAD_TEMPLATE) {
      for (let k = 0; k < count; k++, slotIndex++) {
        const youth = youthSlots.has(slotIndex);
        // 1人目はレギュラー級、2人目は少し下、3人目以降は控え級。若手は能力が低いが伸びしろがある
        const playerLevel = youth ? level - 2.5 : k === 0 ? level + 0.3 : k === 1 ? level - 0.4 : level - 1.4;
        const base = generatePlayer(rng, position, playerLevel, { id: nextId(), age: youth ? rng.int(18, 20) : undefined });
        base.name = uniqueName(base.name, base.nationality);
        base.hidden.potential = potentialFor(rng, overallRating(base), base.age);
        const record: PlayerRecord = {
          ...base,
          clubId: clubSeed.id,
          squadNumber: squadNumber++,
          contract: { salary: salaryFor(overallRating(base), profile.salary), endYear: START_YEAR + rng.int(0, 3), role: 'backup' },
          season: emptySeason(),
          discipline: { yellowAccumulation: 0, suspendedMatches: 0 },
          ...playerPhase2Fields(),
        };
        players[record.id] = record;
        playerIds.push(record.id);
      }
    }
    const stadiumSuffix = rng.pick(['スタジアム', 'フットボールパーク', '総合運動公園競技場']);
    const tactics = { formation: rng.pick(FORMATION_CHOICES), instructions: randomInstructions(rng, size) };
    clubs[clubSeed.id] = {
      id: clubSeed.id,
      name: clubSeed.name,
      shortName: clubSeed.place,
      hometown: `${clubSeed.place}市`,
      founded: rng.int(1965, 2005),
      size,
      level,
      reputation: Math.round(between(rng, profile.reputation)),
      stadium: { name: `${clubSeed.place}${stadiumSuffix}`, capacity: Math.round(between(rng, profile.capacity) / 100) * 100 },
      fans: Math.round(between(rng, profile.fans) / 1000) * 1000,
      revenue: Math.round(between(rng, profile.revenue) / 1e7) * 1e7,
      colors: clubSeed.colors,
      emblem: makeEmblem(rng, clubSeed),
      rivalId: null,
      managerName: `${rng.pick(SURNAMES)} ${rng.pick(GIVEN_NAMES)}`,
      playerIds,
      tactics,
      selection: null,
      training: defaultClubTraining(),
      familiarity: defaultFamiliarity(tactics.formation, tactics.instructions),
    };
  });

  // ライバル：2クラブずつ組にする
  const ids = Object.keys(clubs);
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [shuffled[i], shuffled[j]] = [shuffled[j] as string, shuffled[i] as string];
  }
  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    const a = clubs[shuffled[i] as string];
    const b = clubs[shuffled[i + 1] as string];
    if (a && b) {
      a.rivalId = b.id;
      b.rivalId = a.id;
    }
  }

  // 海外の選手プール（試合はしない）
  const overseasPool: string[] = [];
  const nationalities = Object.keys(FOREIGN_NAMES);
  const positions = SQUAD_TEMPLATE.flatMap(([position, count]) => Array.from({ length: count }, () => position));
  for (let i = 0; i < 120; i++) {
    const base = generatePlayer(rng, rng.pick(positions), 9 + rng.next() * 5, {
      id: nextId(), age: rng.int(19, 31), nationality: rng.pick(nationalities),
    });
    base.name = uniqueName(base.name, base.nationality);
    base.hidden.potential = potentialFor(rng, overallRating(base), base.age);
    players[base.id] = {
      ...base, clubId: null, squadNumber: null, contract: null, season: emptySeason(),
      discipline: { yellowAccumulation: 0, suspendedMatches: 0 }, ...playerPhase2Fields(),
    };
    overseasPool.push(base.id);
  }

  const firstMatch = seasonDates(START_YEAR)[0] ?? `${START_YEAR}-02-27`;
  const start = new Date(`${firstMatch}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 7);

  const state: GameState = {
    version: STATE_VERSION,
    seed,
    createdAt: new Date().toISOString(),
    manager: { name: '', clubId: '' },
    season: { year: START_YEAR, round: 1 },
    date: start.toISOString().slice(0, 10),
    clubs,
    players,
    overseasPool,
    fixtures: makeSchedule(ids, rng, START_YEAR),
    nextPlayerNumber: counter + 1,
    inbox: [],
    nextMessageNumber: 1,
    requests: [],
    promises: [],
    history: [],
    fanMood: 50,
    managerRelations: {},
    lastTeamMeeting: null,
  };
  for (const id of ids) assignSquadRoles(state, id);
  return state;
}

/** 監督の名前と担当するクラブを決めて、ゲームを始められる状態にする */
export function startNewGame(world: GameState, managerName: string, clubId: string): GameState {
  const club = world.clubs[clubId];
  if (!club) throw new Error(`クラブ ${clubId} がありません`);
  club.managerName = managerName;
  club.selection = autoSelect(world, clubId, club.tactics.formation);
  const state: GameState = { ...world, manager: { name: managerName, clubId } };
  addMessage(state, {
    category: 'club', from: 'クラブ会長', important: false,
    subject: `${club.name}へようこそ`,
    body: `${managerName}監督、${club.name}へようこそ。今シーズンの目標は「${expectationOf(club)}」です。\n`
      + '開幕まで1週間あります。練習の方針と戦術を決めて、チームミーティングで目標を共有しておいてください。\n'
      + '画面右上の「次の出来事まで進める」で時間が進みます。試合の日や、大事な知らせが届いた日に止まります。',
  });
  return state;
}

/** 新しいゲームの画面で使う、クラブの前評判 */
export function expectationOf(club: Club): string {
  if (club.size === 'large') return '優勝争い';
  if (club.size === 'small') return '残留争い';
  return club.level >= 12.4 ? '上位進出' : '中位';
}
