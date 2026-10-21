// フォーメーションと、攻撃時・守備時の選手の立ち位置。
// 座標はそのチームから見た向きで、x は 0（自陣ゴール）〜 6（相手ゴール）、y は 0（左サイド）〜 5（右サイド）。

import type { RoleProfile } from './roles';
import type { FormationName, Position, TeamInstructions } from './types';

export interface Slot {
  position: Position;
  x: number;
  y: number;
}

const GK: Slot = { position: 'GK', x: 0.3, y: 2.5 };
const BACK_FOUR: Slot[] = [
  { position: 'SB', x: 1.3, y: 0.6 },
  { position: 'CB', x: 1.0, y: 1.9 },
  { position: 'CB', x: 1.0, y: 3.1 },
  { position: 'SB', x: 1.3, y: 4.4 },
];

/** 守備時の基本の立ち位置。並び順は Team.lineup の順と同じ。 */
export const FORMATIONS: Record<FormationName, Slot[]> = {
  '4-4-2': [
    GK, ...BACK_FOUR,
    { position: 'WM', x: 2.5, y: 0.7 },
    { position: 'CM', x: 2.4, y: 1.95 },
    { position: 'CM', x: 2.4, y: 3.05 },
    { position: 'WM', x: 2.5, y: 4.3 },
    { position: 'FW', x: 3.7, y: 1.95 },
    { position: 'FW', x: 3.7, y: 3.05 },
  ],
  '4-3-3': [
    GK, ...BACK_FOUR,
    { position: 'CM', x: 2.6, y: 1.5 },
    { position: 'DM', x: 2.0, y: 2.5 },
    { position: 'CM', x: 2.6, y: 3.5 },
    { position: 'W', x: 3.5, y: 0.6 },
    { position: 'FW', x: 3.9, y: 2.5 },
    { position: 'W', x: 3.5, y: 4.4 },
  ],
  '4-2-3-1': [
    GK, ...BACK_FOUR,
    { position: 'DM', x: 2.1, y: 1.9 },
    { position: 'DM', x: 2.1, y: 3.1 },
    { position: 'W', x: 3.1, y: 0.7 },
    { position: 'AM', x: 3.1, y: 2.5 },
    { position: 'W', x: 3.1, y: 4.3 },
    { position: 'FW', x: 3.9, y: 2.5 },
  ],
};

/** 攻撃時に前へ出る量 */
const ATTACK_PUSH: Record<Position, number> = {
  GK: 0, CB: 0.7, SB: 1.4, DM: 0.9, CM: 1.2, AM: 1.3, WM: 1.4, W: 1.5, FW: 1.4,
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export type Phase = 'attack' | 'defend';

/** チーム指示と役割を反映した、攻撃時または守備時の立ち位置 */
export function shapePoint(slot: Slot, ins: TeamInstructions, phase: Phase, role?: RoleProfile): { x: number; y: number } {
  if (slot.position === 'GK') {
    const x = phase === 'attack' ? 0.5 + 0.1 * ins.defensiveLine + (role?.attackX ?? 0) : 0.3 + (role?.defendX ?? 0);
    return { x, y: 2.5 };
  }
  const isDefender = slot.position === 'CB' || slot.position === 'SB';
  let x = slot.x + ins.defensiveLine * (isDefender ? 0.3 : 0.18);
  let y = slot.y;
  if (phase === 'attack') {
    x += ATTACK_PUSH[slot.position] + ins.mentality * (slot.position === 'CB' ? 0.08 : 0.22) + (role?.attackX ?? 0);
    y = 2.5 + (y - 2.5) * (1 + ins.width * 0.12);
    // 役割による横の動き：＋ならサイドへ、−なら中央へ
    if (role && role.attackY !== 0) y += Math.sign(y - 2.5 || 1) * role.attackY;
  } else {
    // プレスが強いと前線と中盤が前に出る。最終ラインの高さは守備ラインの指示だけで決まる
    const isFront = slot.position === 'FW' || slot.position === 'AM' || slot.position === 'W';
    if (!isDefender) x += ins.pressing * (isFront ? 0.25 : 0.1);
    x += role?.defendX ?? 0;
    y = 2.5 + (y - 2.5) * 0.9;
  }
  return { x: clamp(x, 0.2, 5.8), y: clamp(y, 0.2, 4.8) };
}
