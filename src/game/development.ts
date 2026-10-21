// 成長と衰え、引退。要件定義書「成長と衰え」に対応する。
// 能力値は練習、試合への出場、年齢、潜在能力、プロ意識の組み合わせで、毎週少しずつ変わる。

import { overallRating, positionWeights } from '../engine/ratings';
import type { Rng } from '../engine/rng';
import { ATTRIBUTE_KEYS, type AttributeKey } from '../engine/types';
import { BALANCE, GOALKEEPING_KEYS, MENTAL_KEYS, PHYSICAL_KEYS, TECHNICAL_KEYS, TRAINING_FOCUS, TRAINING_INTENSITY } from './balance';
import type { Club, PlayerRecord } from './types';

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** 年齢による伸びやすさ。GKはピークが2年遅い */
function ageGrowth(age: number, keeper: boolean): number {
  const a = keeper ? age - 2 : age;
  if (a <= 20) return 1;
  if (a <= 22) return 0.8;
  if (a <= 24) return 0.6;
  if (a <= 26) return 0.4;
  if (a <= 28) return 0.2;
  return 0.05;
}

/** ポジションの総合力に効く能力（よく伸びる） */
function relevantKeys(player: PlayerRecord): Set<AttributeKey> {
  return new Set(Object.keys(positionWeights(player.position)) as AttributeKey[]);
}

export interface WeeklyChange {
  /** 総合力の変化 */
  overall: number;
  /** 大きく変わった能力 */
  notable: { key: AttributeKey; delta: number }[];
}

/**
 * 1週間分の成長と衰え。club が null（海外の選手プール）なら、バランスの練習をしているものとして扱う。
 * 総合力が潜在能力に届くと伸びが止まる。30歳を過ぎるとフィジカルから衰え、メンタルはその後も伸びることがある。
 */
export function developWeek(rng: Rng, player: PlayerRecord, club: Club | null, weeklyMinutes: number): WeeklyChange {
  const keeper = player.position === 'GK';
  const focus = TRAINING_FOCUS[club?.training.focus ?? 'balanced'];
  const intensity = TRAINING_INTENSITY[club?.training.intensity ?? 'normal'];
  const before = overallRating(player);
  const gap = player.hidden.potential - before;
  const professionalism = 0.55 + (player.hidden.professionalism / 20) * 0.9;
  // 最近よく試合に出ているほど伸びる。若手ほど試合の影響が大きい
  const played = Math.min(1, player.status.recentMinutes / 360);
  const playFactor = player.age <= 23 ? 0.45 + 0.9 * played : 0.7 + 0.45 * played;
  const injured = player.status.injury !== null ? 0.2 : 1;
  const base = BALANCE.weeklyGrowth * professionalism * playFactor * focus.growth * intensity.growth * injured;
  const relevant = relevantKeys(player);
  const youthGrowth = ageGrowth(player.age, keeper);
  const veteranMental = player.age >= 27 && player.age <= 33 ? 0.3 : 0;
  const declineAge = keeper ? 32 : 30;
  const declineSlowdown = 1.25 - player.hidden.professionalism / 40;
  const notable: WeeklyChange['notable'] = [];

  for (const key of ATTRIBUTE_KEYS) {
    if (!keeper && GOALKEEPING_KEYS.includes(key)) continue;
    let delta = 0;
    // 伸び：潜在能力との差があるうちだけ。メンタルはベテランでも少し余裕を持たせる
    const mental = MENTAL_KEYS.includes(key);
    const room = mental && veteranMental > 0 ? gap + 0.8 : gap;
    if (room > 0) {
      const ageFactor = mental ? Math.max(youthGrowth, veteranMental) : youthGrowth;
      let weight = relevant.has(key) ? 1.3 : 0.6;
      if (focus.boosted.length > 0) weight *= focus.boosted.includes(key) ? 1.8 : 0.8;
      if (player.trainingFocus) weight *= player.trainingFocus === key ? 2.5 : 0.9;
      delta += base * ageFactor * weight * Math.min(1, room / 1.5) * (0.4 + 1.2 * rng.next());
    }
    // 衰え：年齢から。プロ意識が高いほど遅い
    if (PHYSICAL_KEYS.includes(key) && player.age >= declineAge) {
      const rate = key === 'strength' ? 0.5 : 1;
      delta -= BALANCE.physicalDecline * (player.age - declineAge + 1) * rate * declineSlowdown * (0.5 + rng.next());
    }
    if ((TECHNICAL_KEYS.includes(key) || GOALKEEPING_KEYS.includes(key)) && player.age >= declineAge + 2) {
      delta -= BALANCE.technicalDecline * (player.age - declineAge - 1) * declineSlowdown * (0.5 + rng.next());
    }
    if (delta === 0) continue;
    const next = round2(Math.max(1, Math.min(20, player.attributes[key] + delta)));
    const change = next - player.attributes[key];
    player.attributes[key] = next;
    if (Math.abs(change) >= 0.08) notable.push({ key, delta: change });
  }
  return { overall: overallRating(player) - before, notable };
}

/** シーズン終了時に引退する確率 */
export function retirementChance(player: PlayerRecord): number {
  const age = player.position === 'GK' ? player.age - 2 : player.age;
  const overall = overallRating(player);
  if (age >= 39) return 1;
  if (age >= 35) return Math.min(1, 0.4 + (age - 35) * 0.17 + Math.max(0, 11.5 - overall) * 0.12);
  if (age >= 33) return Math.min(1, 0.15 + Math.max(0, 11 - overall) * 0.15);
  if (age >= 30) return Math.max(0, 9.5 - overall) * 0.12;
  return 0;
}

export function decideRetirement(rng: Rng, player: PlayerRecord): boolean {
  return rng.chance(retirementChance(player));
}
