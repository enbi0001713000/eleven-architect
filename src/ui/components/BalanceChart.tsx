// 時間とともに変わる1つの値の折れ線（手元のお金、オーナーの信頼度など）。1本だけなので凡例は置かず、見出しで何の線かを示す。
// マウスを乗せた（キーボードで選んだ）時点の値を、縦の線と吹き出しで見せる。値は表でも見られるようにしておく。

import { useRef, useState } from 'react';
import { yenText } from '../../game/finance';

export interface TrendPoint {
  /** 横軸のラベル（'YYYY-MM' または 'YYYY-MM-DD'） */
  date: string;
  value: number;
}

const WIDTH = 640;
const HEIGHT = 200;
const PAD = { left: 56, right: 70, top: 14, bottom: 26 };

/** 目盛りの間隔：1、2、5 × 10のべき乗から、5本前後になるものを選ぶ */
function niceStep(range: number): number {
  const raw = range / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 5, 10].find((u) => u * power >= raw) ?? 10;
  return unit * power;
}

const monthText = (date: string): string => `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月`;

export function TrendChart({ points, format, tick, domain, minRange = 1, label, pointLabel = monthText, axisLabel = monthText }: {
  points: TrendPoint[];
  /** 値の書き方（吹き出しと、最後の点のラベル） */
  format: (v: number) => string;
  /** 目盛りの書き方 */
  tick: (v: number) => string;
  /** 縦軸の範囲を決めておく（決めなければ、値に合わせ、0を必ず含める） */
  domain?: [number, number];
  /** 縦軸の幅の最小（値がほとんど動かないときに、変化を大きく見せすぎない） */
  minRange?: number;
  /** 読み上げ用の名前 */
  label: string;
  /** 吹き出しの日付の書き方 */
  pointLabel?: (date: string) => string;
  /** 横軸の日付の書き方 */
  axisLabel?: (date: string) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  if (points.length < 2) return <p className="muted small">記録が2つたまると、ここに推移が出ます。</p>;

  const values = points.map((p) => p.value);
  let yMin: number;
  let yMax: number;
  let step: number;
  if (domain) {
    [yMin, yMax] = domain;
    step = niceStep(yMax - yMin);
  } else {
    const lo = Math.min(0, ...values);
    const hi = Math.max(0, ...values);
    step = niceStep(Math.max(hi - lo, minRange));
    yMin = Math.floor(lo / step) * step;
    yMax = Math.ceil(hi / step) * step || step;
  }
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + step / 2; v += step) ticks.push(v);
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points.length - 1;
  const lastPoint = points[last] as TrendPoint;
  // 最初の点と、年が変わったところにだけ横軸のラベルを付ける
  const labelled = points.map((p, i) => i === 0 || p.date.slice(0, 4) !== points[i - 1]?.date.slice(0, 4));

  const pick = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((clientX - rect.left) / rect.width) * WIDTH;
    const i = Math.round(((px - PAD.left) / plotW) * (points.length - 1));
    setHover(Math.max(0, Math.min(last, i)));
  };
  const shown = hover === null ? null : points[hover];

  return (
    <div className="chart-wrap">
      <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="chart" role="img" tabIndex={0}
        aria-label={`${label}。${pointLabel(lastPoint.date)}は${format(lastPoint.value)}`}
        onPointerMove={(e) => pick(e.clientX)} onPointerLeave={() => setHover(null)}
        onFocus={() => setHover(last)} onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? last) - 1));
          if (e.key === 'ArrowRight') setHover((h) => Math.min(last, (h ?? last) + 1));
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 && !domain ? 'chart-zero' : 'chart-grid'} />
            <text x={PAD.left - 8} y={y(t)} className="chart-axis" textAnchor="end" dominantBaseline="middle">{tick(t)}</text>
          </g>
        ))}
        {points.map((p, i) => labelled[i] && (
          <text key={`${p.date}-${i}`} x={x(i)} y={HEIGHT - 8} className="chart-axis" textAnchor={i === 0 ? 'start' : 'middle'}>{axisLabel(p.date)}</text>
        ))}
        <path d={path} className="chart-line" />
        <circle cx={x(last)} cy={y(lastPoint.value)} r={4} className="chart-dot" />
        <text x={x(last) + 8} y={y(lastPoint.value)} className="chart-label" dominantBaseline="middle">{format(lastPoint.value)}</text>
        {shown && hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} className="chart-crosshair" />
            <circle cx={x(hover)} cy={y(shown.value)} r={4} className="chart-dot" />
          </g>
        )}
        <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent" />
      </svg>
      {shown && hover !== null && (
        <div className="chart-tooltip" style={{ left: `${(x(hover) / WIDTH) * 100}%` }}>
          <strong>{format(shown.value)}</strong>
          <span className="muted small">{pointLabel(shown.date)}</span>
        </div>
      )}
    </div>
  );
}

export interface BalancePoint {
  /** 'YYYY-MM' */
  month: string;
  balance: number;
}

const yenTick = (yen: number): string => (yen === 0 ? '0' : `${(yen / 1e8).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}億`);

/** 手元のお金の推移（月末） */
export function BalanceChart({ points }: { points: BalancePoint[] }) {
  return (
    <TrendChart points={points.map((p) => ({ date: p.month, value: p.balance }))} format={yenText} tick={yenTick} minRange={1e8}
      label="手元のお金の推移" pointLabel={(d) => `${monthText(d)}末`} />
  );
}
