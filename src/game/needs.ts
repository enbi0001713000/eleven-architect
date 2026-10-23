// チームの弱いところ：今のフォーメーションの位置ごとに、いちばん良い選手の力と控えの人数を見て、手薄な位置を探す
// （要件定義書「画面の作り直し（1.1）」の「移籍とスカウト」。コーチが教え、移籍の画面でその位置の候補を出す）

import { FORMATIONS } from '../engine/formations';
import { positionRating } from '../engine/ratings';
import type { Position } from '../engine/types';
import type { GameState, PlayerRecord } from './types';

export interface WeakSpot {
  position: Position;
  /** 足りないのが質か人数か */
  reason: 'quality' | 'depth';
  /** その位置でいちばん良い選手の力と、先発の平均 */
  best: number;
  average: number;
  /** その位置を本来のポジションとする選手の数と、形で使う枠の数 */
  count: number;
  slots: number;
}

/** 長いケガ（30日以上）の選手は、いないものとして数える */
const available = (p: PlayerRecord): boolean => (p.status.injury?.daysLeft ?? 0) < 30 && !p.leaving;

export function weakSpots(state: GameState, clubId: string): WeakSpot[] {
  const club = state.clubs[clubId];
  if (!club) return [];
  const players = club.playerIds.map((id) => state.players[id]).filter((p): p is PlayerRecord => p !== undefined && available(p));
  const slots = FORMATIONS[club.tactics.formation];
  const needed = new Map<Position, number>();
  for (const slot of slots) needed.set(slot.position, (needed.get(slot.position) ?? 0) + 1);
  // 先発の平均：位置ごとに良い順に枠の数だけ取った力の平均
  const bestFor = (position: Position, n: number) => players.map((p) => positionRating(p, position)).sort((a, b) => b - a).slice(0, n);
  const lineup = [...needed].flatMap(([position, n]) => bestFor(position, n));
  const average = lineup.reduce((a, b) => a + b, 0) / Math.max(1, lineup.length);
  const spots: (WeakSpot & { score: number })[] = [];
  for (const [position, n] of needed) {
    const ratings = bestFor(position, n);
    const worst = ratings.at(-1) ?? 0;
    const count = players.filter((p) => p.position === position).length;
    const qualityGap = average - worst;
    // 枠の数より1人多く（控え）いないと、ケガや出場停止で困る
    const depthGap = n + 1 - count;
    if (qualityGap >= 1) spots.push({ position, reason: 'quality', best: worst, average, count, slots: n, score: qualityGap });
    else if (depthGap > 0) spots.push({ position, reason: 'depth', best: worst, average, count, slots: n, score: 0.4 * depthGap });
  }
  return spots.sort((a, b) => b.score - a.score).map(({ score: _score, ...rest }) => rest);
}
