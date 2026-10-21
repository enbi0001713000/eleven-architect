// 選手とチームの自動生成。フェーズ0では試合エンジンの確認用に、能力の水準を指定してチームを作る。

import { FORMATIONS } from '../engine/formations';
import type { Rng } from '../engine/rng';
import type {
  AttributeKey, Attributes, FormationName, HiddenAttributes, Player, Position, Team, TeamInstructions,
} from '../engine/types';
import { ATTRIBUTE_KEYS } from '../engine/types';
import { FOREIGN_NAMES, GIVEN_NAMES, SURNAMES } from './names';

const GK_KEYS: readonly AttributeKey[] = ['reflexes', 'handling', 'oneOnOne', 'rushingOut'];

/** ポジションごとの、能力値の得意・不得意（チームの水準からの差） */
const PROFILES: Record<Position, Partial<Record<AttributeKey, number>>> = {
  GK: {
    reflexes: 4, handling: 4, oneOnOne: 3, rushingOut: 2, positioning: 2, concentration: 2, jumping: 1,
    shooting: -7, dribbling: -6, crossing: -6, tackling: -6, heading: -5, passing: -3, firstTouch: -3, offTheBall: -6,
  },
  CB: { tackling: 3, heading: 3, positioning: 3, strength: 3, jumping: 2, concentration: 1, shooting: -4, dribbling: -3, crossing: -3, offTheBall: -3 },
  SB: { pace: 2, acceleration: 2, stamina: 2, crossing: 2, tackling: 1, workRate: 1, heading: -1, shooting: -3 },
  DM: { tackling: 3, positioning: 2, passing: 1, workRate: 2, decisions: 1, concentration: 1, shooting: -2, dribbling: -1, offTheBall: -2 },
  CM: { passing: 2, vision: 1, decisions: 1, workRate: 2, stamina: 2 },
  AM: { passing: 2, vision: 3, dribbling: 2, firstTouch: 2, offTheBall: 1, shooting: 1, tackling: -3, heading: -2, strength: -1 },
  WM: { crossing: 2, stamina: 2, workRate: 2, pace: 1, dribbling: 1 },
  W: { pace: 3, acceleration: 3, dribbling: 3, crossing: 1, offTheBall: 1, tackling: -3, heading: -2, strength: -1 },
  FW: { shooting: 4, offTheBall: 3, composure: 2, heading: 1, firstTouch: 1, tackling: -4, passing: -1, vision: -1 },
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

export const NEUTRAL_INSTRUCTIONS: TeamInstructions = {
  mentality: 0, defensiveLine: 0, pressing: 0, width: 0, passingLength: 0, tempo: 0,
};

let playerCounter = 0;

export function playerName(rng: Rng, nationality: string): string {
  const foreign = FOREIGN_NAMES[nationality];
  if (foreign) return `${rng.pick(foreign.given)}・${rng.pick(foreign.family)}`;
  return `${rng.pick(SURNAMES)} ${rng.pick(GIVEN_NAMES)}`;
}

export interface PlayerOptions {
  /** 指定しなければ連番のIDを付ける */
  id?: string;
  age?: number;
  nationality?: string;
}

/**
 * 選手を1人作る。
 * @param level チームの水準（1〜20）。能力値はこの値を中心にばらつく。
 */
export function generatePlayer(rng: Rng, position: Position, level: number, options: PlayerOptions = {}): Player {
  const profile = PROFILES[position];
  const attributes = {} as Attributes;
  for (const key of ATTRIBUTE_KEYS) {
    const isKeeperSkill = GK_KEYS.includes(key);
    if (isKeeperSkill && position !== 'GK') {
      attributes[key] = round1(clamp(rng.normal(3, 1), 1, 6));
      continue;
    }
    attributes[key] = round1(clamp(level + (profile[key] ?? 0) + rng.normal(0, 1.8), 1, 20));
  }
  const hidden: HiddenAttributes = {
    potential: round1(clamp(level + rng.normal(1, 2), 1, 20)),
    professionalism: rng.int(4, 18),
    ambition: rng.int(4, 18),
    loyalty: rng.int(4, 18),
    consistency: rng.int(6, 18),
    bigMatch: rng.int(5, 17),
    injuryProneness: rng.int(3, 16),
    pressure: rng.int(5, 17),
    temperament: rng.int(5, 17),
  };
  const nationality = options.nationality ?? (rng.chance(0.15) ? rng.pick(Object.keys(FOREIGN_NAMES)) : '日本');
  playerCounter++;
  return {
    id: options.id ?? `p${playerCounter}`,
    name: playerName(rng, nationality),
    age: options.age ?? rng.int(18, 34),
    nationality,
    foot: rng.chance(0.75) ? 'right' : rng.chance(0.85) ? 'left' : 'both',
    position,
    attributes,
    hidden,
  };
}

export interface TeamOptions {
  id: string;
  name: string;
  /** 能力の水準（1〜20）。J1の中堅を12前後と考える。 */
  level: number;
  formation?: FormationName;
  instructions?: Partial<TeamInstructions>;
}

/** 先発11人と控え7人のチームを作る */
export function generateTeam(rng: Rng, options: TeamOptions): Team {
  const formation = options.formation ?? '4-4-2';
  const starters = FORMATIONS[formation].map((slot) => generatePlayer(rng, slot.position, options.level));
  const bench = (['GK', 'CB', 'SB', 'CM', 'CM', 'W', 'FW'] as const)
    .map((position) => generatePlayer(rng, position, options.level - 1));
  return {
    id: options.id,
    name: options.name,
    players: [...starters, ...bench],
    lineup: starters.map((p) => p.id),
    bench: bench.map((p) => p.id),
    tactics: { formation, instructions: { ...NEUTRAL_INSTRUCTIONS, ...options.instructions } },
  };
}

/** 同じチームのまま、戦術だけを変えたコピーを作る */
export function withTactics(team: Team, formation: FormationName | undefined, instructions: Partial<TeamInstructions>): Team {
  return {
    ...team,
    tactics: {
      formation: formation ?? team.tactics.formation,
      instructions: { ...team.tactics.instructions, ...instructions },
    },
  };
}
