// 観戦中の2D表示：上から見たピッチに、両チームの選手とボールを出す（ホームが右へ攻める）。
// 選手の位置は、試合エンジンと同じ立ち位置（フォーメーション、役割、チーム指示、攻めか守りか）から作り、
// ボールの近くへ少し寄せる。ボールを持つ選手はボールの位置に立つ。動きはCSSの移り変わりでなめらかに見せる。

import { useEffect, useState } from 'react';
import { FORMATIONS, shapePoint } from '../../engine/formations';
import type { LiveSnapshot } from '../../engine/match';
import { ROLE_PROFILES } from '../../engine/roles';
import type { MatchEvent, Side } from '../../engine/types';

const W = 105;
const H = 68;
const toX = (x: number) => (Math.max(0, Math.min(6, x)) / 6) * W;
const toY = (y: number) => (Math.max(0, Math.min(5, y)) / 5) * H;

/** 文字列から0〜1の決まった値を作る（選手ごとの小さな揺れに使う） */
function noise(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/** 色の明るさ（0〜1）。背番号の文字を白にするか黒にするかに使う */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0.5;
  const v = parseInt(m[1] as string, 16);
  return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
}

function colorDistance(a: string, b: string): number {
  const parse = (hex: string) => {
    const v = parseInt(hex.replace('#', ''), 16) || 0;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  return Math.abs((r1 ?? 0) - (r2 ?? 0)) + Math.abs((g1 ?? 0) - (g2 ?? 0)) + Math.abs((b1 ?? 0) - (b2 ?? 0));
}

const GRASS = '#2b7a45';

/** ユニフォームの色：芝生の緑に埋もれる色や、ホームと似た色は使わず、2番目の色か白・黒にする */
export function kitColors(home: { primary: string; secondary: string }, away: { primary: string; secondary: string }): [string, string] {
  const visible = (color: string) => colorDistance(color, GRASS) > 150;
  const pick = (options: string[], avoid?: string) =>
    options.find((c) => visible(c) && (avoid === undefined || colorDistance(c, avoid) > 160)) ?? options[options.length - 1] as string;
  const homeKit = pick([home.primary, home.secondary, '#f2f2f2']);
  const awayKit = pick([away.primary, away.secondary, '#f2f2f2', '#1a1a1a'], homeKit);
  return [homeKit, awayKit];
}

/** 近すぎる選手どうしを少し離す（重なって番号が読めなくならないように） */
function spread(dots: Dot[]): void {
  const minimum = 0.32;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const a = dots[i] as Dot;
        const b = dots[j] as Dot;
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

interface Dot {
  id: string;
  side: Side;
  x: number;
  y: number;
  label: string;
  title: string;
}

const SHOT_TYPES = new Set<MatchEvent['type']>(['goal', 'penaltyGoal', 'shotSaved', 'shotOff', 'shotBlocked']);

/** 新しい出来事が来たら、決まった時間だけ返す（試合を4倍で見ていても見逃さないように） */
function useForAWhile(event: MatchEvent | undefined, ms: number): MatchEvent | undefined {
  const [shown, setShown] = useState<MatchEvent | undefined>(undefined);
  useEffect(() => {
    if (!event) return;
    setShown(event);
    const timer = setTimeout(() => setShown((current) => (current === event ? undefined : current)), ms);
    return () => clearTimeout(timer);
  }, [event, ms]);
  return shown;
}

export function MatchPitch({ snapshot, events, colors, numberOf }: {
  snapshot: LiveSnapshot;
  events: readonly MatchEvent[];
  colors: [string, string];
  numberOf: (playerId: string) => number | null;
}) {
  const { ball } = snapshot;
  const tick = Math.floor(snapshot.clock / 6);
  const dots: Dot[] = [];
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
      const number = numberOf(p.player.id);
      dots.push({ id: p.player.id, side, x, y, label: number === null ? '' : String(number), title: `${p.player.name}（${team.team.name}）` });
    });
  });
  // ボールを持つ選手はボールの位置へ。守る側でいちばん近い選手が寄せに行く
  const holder = dots.find((d) => d.id === ball.holderId);
  if (holder) {
    holder.x = ball.x + (noise(`${tick}:bx`) - 0.5) * 0.4;
    holder.y = ball.y + (noise(`${tick}:by`) - 0.5) * 0.4;
  }
  const ballX = holder?.x ?? ball.x;
  const ballY = holder?.y ?? ball.y;
  const defenders = dots.filter((d) => d.side !== ball.side);
  const presser = defenders.reduce<Dot | null>((best, d) =>
    (best === null || Math.hypot(d.x - ballX, d.y - ballY) < Math.hypot(best.x - ballX, best.y - ballY) ? d : best), null);
  if (presser && Math.hypot(presser.x - ballX, presser.y - ballY) < 1.6) {
    presser.x += (ballX - presser.x) * 0.55;
    presser.y += (ballY - presser.y) * 0.55;
  }
  spread(dots);

  // 直前のシュートとゴールを、観戦の速さにかかわらず少しの間（実際の時間で）見せる
  const lastShot = [...events].reverse().find((e) => e.side !== null && SHOT_TYPES.has(e.type));
  const recent = useForAWhile(lastShot, 1500);
  const goal = useForAWhile(recent && (recent.type === 'goal' || recent.type === 'penaltyGoal') ? recent : undefined, 2500);
  const textColor = (side: Side) => (luminance(colors[side]) > 0.6 ? '#111' : '#fff');

  return (
    <div className="match-pitch">
      <svg viewBox={`-3 -3 ${W + 6} ${H + 6}`} role="img" aria-label="ピッチ上の選手とボール">
        <rect x={-3} y={-3} width={W + 6} height={H + 6} className="mp-grass" />
        {Array.from({ length: 10 }, (_, i) => <rect key={i} x={(W / 10) * i} y={0} width={W / 10} height={H} className={i % 2 ? 'mp-stripe' : 'mp-stripe-alt'} />)}
        <g className="mp-lines">
          <rect x={0} y={0} width={W} height={H} />
          <line x1={W / 2} y1={0} x2={W / 2} y2={H} />
          <circle cx={W / 2} cy={H / 2} r={9.15} />
          <rect x={0} y={(H - 40.3) / 2} width={16.5} height={40.3} />
          <rect x={W - 16.5} y={(H - 40.3) / 2} width={16.5} height={40.3} />
          <rect x={0} y={(H - 18.3) / 2} width={5.5} height={18.3} />
          <rect x={W - 5.5} y={(H - 18.3) / 2} width={5.5} height={18.3} />
          <rect x={-2} y={(H - 7.3) / 2} width={2} height={7.3} />
          <rect x={W} y={(H - 7.3) / 2} width={2} height={7.3} />
        </g>
        {recent?.from && (
          <line className={`mp-shot${recent.type === 'goal' || recent.type === 'penaltyGoal' ? ' goal' : ''}`}
            x1={toX(recent.from.x)} y1={toY(recent.from.y)} x2={recent.side === 0 ? W : 0} y2={H / 2} />
        )}
        {dots.map((d) => (
          <g key={d.id} className="mp-player" style={{ transform: `translate(${toX(d.x)}px, ${toY(d.y)}px)` }}>
            <title>{d.title}</title>
            <circle r={2.1} fill={colors[d.side]} className={d.id === ball.holderId ? 'mp-holder' : ''} />
            <text y={0.9} fill={textColor(d.side)}>{d.label}</text>
          </g>
        ))}
        <g className="mp-ball" style={{ transform: `translate(${toX(holder?.x ?? ballX) + 1.6}px, ${toY(holder?.y ?? ballY) + 1.2}px)` }}>
          <circle r={0.95} />
        </g>
      </svg>
      {goal && goal.side !== null && (
        <div className="mp-goal">
          <span key={goal.clock} style={{ background: colors[goal.side], color: textColor(goal.side) }}>ゴール！</span>
        </div>
      )}
    </div>
  );
}
