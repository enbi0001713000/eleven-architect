// 観戦中の2D表示（今の図）：上から見たピッチに、両チームの選手とボールを出す（ホームが右へ攻める）。
// 選手の位置は pitchModel.ts で決める（ドット絵と同じ）。動きはCSSの移り変わりでなめらかに見せる。

import type { CSSProperties } from 'react';
import type { LiveSnapshot } from '../../engine/match';
import type { MatchEvent, Side } from '../../engine/types';
import { colorDistance, textOn } from '../colors';
import { pitchSpots } from '../pitchModel';
import { useForAWhile } from './Celebration';

const W = 105;
const H = 68;
const toX = (x: number) => (Math.max(0, Math.min(6, x)) / 6) * W;
const toY = (y: number) => (Math.max(0, Math.min(5, y)) / 5) * H;

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

interface Dot {
  id: string;
  side: Side;
  x: number;
  y: number;
  label: string;
  title: string;
}

const SHOT_TYPES = new Set<MatchEvent['type']>(['goal', 'penaltyGoal', 'shotSaved', 'shotOff', 'shotBlocked']);

export function MatchPitch({ snapshot, events, colors, numberOf, moveMs = 400 }: {
  snapshot: LiveSnapshot;
  events: readonly MatchEvent[];
  colors: [string, string];
  numberOf: (playerId: string) => number | null;
  /** 選手とボールが次の位置へ動く時間（ミリ秒）。観戦の速さに合わせる */
  moveMs?: number;
}) {
  const { ball } = snapshot;
  const model = pitchSpots(snapshot);
  const names = new Map(snapshot.sides.flatMap((team) => team.onPitch.map((p) => [p.player.id, `${p.player.name}（${team.team.name}）`] as const)));
  const dots: Dot[] = model.spots.map((spot) => {
    const number = numberOf(spot.id);
    return { id: spot.id, side: spot.side, x: spot.x, y: spot.y, label: number === null ? '' : String(number), title: names.get(spot.id) ?? '' };
  });
  const holder = dots.find((d) => d.id === ball.holderId);
  const ballX = model.ball.x;
  const ballY = model.ball.y;

  // 直前のシュートとゴールを、観戦の速さにかかわらず少しの間（実際の時間で）見せる
  const lastShot = [...events].reverse().find((e) => e.side !== null && SHOT_TYPES.has(e.type));
  const lastGoal = [...events].reverse().find((e) => e.side !== null && (e.type === 'goal' || e.type === 'penaltyGoal'));
  // ピッチを出し直したときに、前のゴールをもう一度見せないように、最近の出来事だけにする
  const fresh = (e: MatchEvent | undefined) => (e && snapshot.clock - e.clock <= 240 ? e : undefined);
  const recent = useForAWhile(fresh(lastShot), 1500);
  const goal = useForAWhile(fresh(lastGoal), 2500);
  const textColor = (side: Side) => textOn(colors[side]);

  return (
    <div className="match-pitch" style={{ '--mp-move': `${moveMs}ms` } as CSSProperties}>
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
