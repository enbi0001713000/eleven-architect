// クラブのエンブレム。形・模様・シンボル・色・英字の組み合わせで自動で描く（要件定義書「見た目とエディタ」）。

import { useId } from 'react';
import type { EmblemSpec } from '../../game/types';

const SHAPES: Record<EmblemSpec['shape'], string> = {
  shield: 'M10 8 H90 V60 Q90 95 50 112 Q10 95 10 60 Z',
  round: 'M50 12 A48 48 0 1 1 49.9 12 Z',
  crest: 'M50 6 L92 22 V62 Q92 96 50 114 Q8 96 8 62 V22 Z',
  diamond: 'M50 6 L94 60 L50 114 L6 60 Z',
};

function Pattern({ spec }: { spec: EmblemSpec }) {
  const { primary, secondary } = spec;
  switch (spec.pattern) {
    case 'stripes':
      return <>{[0, 1, 2, 3, 4].map((i) => <rect key={i} x={i * 20} y={0} width={20} height={120} fill={i % 2 === 0 ? primary : secondary} />)}</>;
    case 'halves':
      return <><rect width={50} height={120} fill={primary} /><rect x={50} width={50} height={120} fill={secondary} /></>;
    case 'band':
      return <><rect width={100} height={120} fill={primary} /><path d="M0 75 L100 15 L100 45 L0 105 Z" fill={secondary} /></>;
    case 'chevron':
      return <><rect width={100} height={120} fill={primary} /><path d="M0 40 L50 75 L100 40 L100 62 L50 97 L0 62 Z" fill={secondary} /></>;
    case 'hoops':
      return <>{[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} x={0} y={i * 20} width={100} height={20} fill={i % 2 === 0 ? primary : secondary} />)}</>;
    default:
      return <rect width={100} height={120} fill={primary} />;
  }
}

function Symbol({ spec }: { spec: EmblemSpec }) {
  const fill = spec.accent;
  const common = { fill, stroke: '#00000055', strokeWidth: 1 };
  switch (spec.symbol) {
    case 'star':
      return <polygon points="50,24 55,38 70,38 58,47 62,61 50,52 38,61 42,47 30,38 45,38" {...common} />;
    case 'ball':
      return <g><circle cx={50} cy={42} r={14} {...common} /><polygon points="50,35 56,40 54,47 46,47 44,40" fill="#00000088" /></g>;
    case 'wave':
      return <path d="M28 46 Q36 34 44 46 T60 46 T76 46 L76 52 Q68 40 60 52 T44 52 T28 52 Z" {...common} />;
    case 'mountain':
      return <path d="M26 58 L42 30 L50 42 L58 28 L76 58 Z" {...common} />;
    case 'bird':
      return <path d="M28 44 Q40 30 50 42 Q60 30 72 44 Q60 38 50 50 Q40 38 28 44 Z" {...common} />;
    case 'flame':
      return <path d="M50 24 Q62 40 58 50 Q66 46 64 38 Q74 52 62 62 Q54 66 50 66 Q38 66 36 56 Q34 46 44 40 Q42 50 48 52 Q42 38 50 24 Z" {...common} />;
  }
}

export function Emblem({ spec, size = 32, title }: { spec: EmblemSpec; size?: number; title?: string }) {
  const clipId = useId();
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 100 120" role="img" aria-label={title ?? spec.initials} className="emblem">
      <defs>
        <clipPath id={clipId}><path d={SHAPES[spec.shape]} /></clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <Pattern spec={spec} />
        <rect x={0} y={70} width={100} height={30} fill="#00000040" />
        <Symbol spec={spec} />
        <text x={50} y={92} textAnchor="middle" fontSize={spec.initials.length > 2 ? 20 : 24} fontWeight={800}
          fill="#ffffff" stroke="#000000aa" strokeWidth={1} fontFamily="Arial, sans-serif">{spec.initials}</text>
      </g>
      <path d={SHAPES[spec.shape]} fill="none" stroke={spec.accent} strokeWidth={4} />
    </svg>
  );
}
