// 手元のお金の推移（月末）の折れ線。1本だけなので凡例は置かず、見出しで何の線かを示す。
// 指を置いた（マウスを乗せた）月の値を、縦の線と吹き出しで見せる。値は下の表でも見られる。

import { useRef, useState } from 'react';
import { yenText } from '../../game/finance';

export interface BalancePoint {
  /** 'YYYY-MM' */
  month: string;
  balance: number;
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

const monthText = (month: string): string => `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
const tickText = (yen: number): string => (yen === 0 ? '0' : `${(yen / 1e8).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}億`);

export function BalanceChart({ points }: { points: BalancePoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  if (points.length < 2) return <p className="muted small">月を2つ締めると、ここに推移が出ます。</p>;

  const values = points.map((p) => p.balance);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const step = niceStep(Math.max(hi - lo, 1e8));
  const yMin = Math.floor(lo / step) * step;
  const yMax = Math.ceil(hi / step) * step || step;
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + step / 2; v += step) ticks.push(v);
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
  const last = points.length - 1;
  const lastPoint = points[last] as BalancePoint;
  // 1月の目盛り（年の区切り）と、最初の月にだけラベルを付ける
  const labelled = points.map((p, i) => i === 0 || p.month.endsWith('-01'));

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
        aria-label={`手元のお金の推移。${monthText(lastPoint.month)}末は${yenText(lastPoint.balance)}`}
        onPointerMove={(e) => pick(e.clientX)} onPointerLeave={() => setHover(null)}
        onFocus={() => setHover(last)} onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? last) - 1));
          if (e.key === 'ArrowRight') setHover((h) => Math.min(last, (h ?? last) + 1));
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart-zero' : 'chart-grid'} />
            <text x={PAD.left - 8} y={y(t)} className="chart-axis" textAnchor="end" dominantBaseline="middle">{tickText(t)}</text>
          </g>
        ))}
        {points.map((p, i) => labelled[i] && (
          <text key={p.month} x={x(i)} y={HEIGHT - 8} className="chart-axis" textAnchor={i === 0 ? 'start' : 'middle'}>{monthText(p.month)}</text>
        ))}
        <path d={path} className="chart-line" />
        <circle cx={x(last)} cy={y(lastPoint.balance)} r={4} className="chart-dot" />
        <text x={x(last) + 8} y={y(lastPoint.balance)} className="chart-label" dominantBaseline="middle">{yenText(lastPoint.balance)}</text>
        {shown && hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} className="chart-crosshair" />
            <circle cx={x(hover)} cy={y(shown.balance)} r={4} className="chart-dot" />
          </g>
        )}
        <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent" />
      </svg>
      {shown && hover !== null && (
        <div className="chart-tooltip" style={{ left: `${(x(hover) / WIDTH) * 100}%` }}>
          <strong>{yenText(shown.balance)}</strong>
          <span className="muted small">{monthText(shown.month)}末</span>
        </div>
      )}
    </div>
  );
}
