// 観戦のピッチに立たせる選手の位置。試合エンジンと同じ立ち位置（フォーメーション、役割、チーム指示、攻めか守りか）から作り、
// ボールの近くへ少し寄せる。ボールを持つ選手はボールの位置に立つ。今の図（MatchPitch）とドット絵（DotPitch）で同じものを使う。
// 座標はエンジンと同じ（縦0〜6、横0〜5。ホームが右へ攻める）。

import { FORMATIONS, shapePoint } from '../engine/formations';
import type { LiveSnapshot } from '../engine/match';
import { ROLE_PROFILES } from '../engine/roles';
import type { Side } from '../engine/types';

export interface PitchSpot {
  id: string;
  side: Side;
  x: number;
  y: number;
  goalkeeper: boolean;
}

/** 文字列から0〜1の決まった値を作る（選手ごとの小さな揺れに使う） */
export function noise(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/** 近すぎる選手どうしを少し離す（重なって番号が読めなくならないように） */
function spread(spots: PitchSpot[], minimum: number): void {
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const a = spots[i] as PitchSpot;
        const b = spots[j] as PitchSpot;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= minimum) continue;
        const push = (minimum - d) / 2;
        const ux = d > 0.001 ? dx / d : 1;
        const uy = d > 0.001 ? dy / d : 0;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
      }
    }
  }
}

/** 今の手で、選手がどこに立つか。ボールの位置（持っている選手の足元）も返す */
export function pitchSpots(snapshot: LiveSnapshot, minimumGap = 0.32): { spots: PitchSpot[]; ball: { x: number; y: number } } {
  const { ball } = snapshot;
  const tick = Math.floor(snapshot.clock / 6);
  const spots: PitchSpot[] = [];
  ([0, 1] as const).forEach((side) => {
    const team = snapshot.sides[side];
    const slots = FORMATIONS[team.tactics.formation];
    const phase = ball.side === side ? 'attack' : 'defend';
    team.onPitch.forEach((p, i) => {
      const slot = slots[i];
      if (!slot || p.sentOff) return;
      const point = shapePoint(slot, team.tactics.instructions, phase, ROLE_PROFILES[p.role]);
      let x = side === 0 ? point.x : 6 - point.x;
      let y = side === 0 ? point.y : 5 - point.y;
      if (slot.position !== 'GK') {
        // チーム全体がボールのほうへ寄り、横にも絞る
        x += (ball.x - 3) * 0.25;
        y += (ball.y - y) * 0.2;
        // 少しずつ揺れて、止まって見えないようにする
        x += (noise(`${p.player.id}:${tick}`) - 0.5) * 0.25;
        y += (noise(`${p.player.id}:${tick}:y`) - 0.5) * 0.25;
      }
      spots.push({ id: p.player.id, side, x, y, goalkeeper: slot.position === 'GK' });
    });
  });
  // ボールを持つ選手はボールの位置へ。守る側でいちばん近い選手が寄せに行く
  const holder = spots.find((d) => d.id === ball.holderId);
  if (holder) {
    holder.x = ball.x + (noise(`${tick}:bx`) - 0.5) * 0.4;
    holder.y = ball.y + (noise(`${tick}:by`) - 0.5) * 0.4;
  }
  const ballX = holder?.x ?? ball.x;
  const ballY = holder?.y ?? ball.y;
  const defenders = spots.filter((d) => d.side !== ball.side);
  const presser = defenders.reduce<PitchSpot | null>((best, d) =>
    (best === null || Math.hypot(d.x - ballX, d.y - ballY) < Math.hypot(best.x - ballX, best.y - ballY) ? d : best), null);
  if (presser && Math.hypot(presser.x - ballX, presser.y - ballY) < 1.6) {
    presser.x += (ballX - presser.x) * 0.55;
    presser.y += (ballY - presser.y) * 0.55;
  }
  spread(spots, minimumGap);
  return { spots, ball: { x: holder?.x ?? ballX, y: holder?.y ?? ballY } };
}
