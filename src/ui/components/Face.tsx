// 選手や人物の顔のイラスト。IDなどの文字列から、いつも同じ顔を描く（保存はしない）。
// 国籍で肌と髪の色の幅を変え、年齢でひげや白髪が出る。選手はクラブのユニフォーム、スタッフはスーツを着る。

import { createRng } from '../../engine/rng';
import type { GameState, PlayerRecord } from '../../game/types';
import { shade } from '../colors';

export type HairStyle = 'buzz' | 'short' | 'sidePart' | 'curly' | 'spiky' | 'long' | 'receding';
export type FacialHair = 'none' | 'stubble' | 'beard' | 'mustache' | 'goatee';

/** 顔の作り（年齢によらない部分）。ひげと白髪は、決まった年齢から出る */
export interface FaceLook {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  /** 髪のボリューム（0〜6） */
  volume: number;
  /** 前髪の下がり具合（y） */
  fringe: number;
  /** 分け目の向き（-1 左、0 なし、1 右） */
  part: -1 | 0 | 1;
  /** 頭の幅の半分、あごの細さ、あごの位置 */
  width: number;
  jaw: number;
  chin: number;
  browArch: number;
  browTilt: number;
  browWeight: number;
  eyeGap: number;
  eyeHeight: number;
  nose: 0 | 1;
  mouthWidth: number;
  smile: number;
  facialHair: FacialHair;
  facialHairFrom: number;
  grayFrom: number;
  glassesFrom: number;
}

interface Palette {
  skins: string[];
  hairs: string[];
  /** 縮れた髪になりやすさ */
  curly: number;
  /** 明るい色の髪（染める・金髪）になりやすさ */
  light: number;
  lightHairs: string[];
  /** ひげを生やしやすさ */
  beard: number;
}

const PALETTES: Record<string, Palette> = {
  日本: { skins: ['#f6d8bf', '#f0caa9', '#e9be9a', '#dfb08b'], hairs: ['#1c1917', '#241c18', '#2f231c'], curly: 0.04, light: 0.12, lightHairs: ['#5a3a24', '#8a5a34', '#c49a5e'], beard: 0.25 },
  韓国: { skins: ['#f7dcc4', '#f1cdae', '#e9c09e'], hairs: ['#1c1917', '#241c18'], curly: 0.03, light: 0.12, lightHairs: ['#5a3a24', '#9a6a40'], beard: 0.15 },
  ブラジル: { skins: ['#f0cba8', '#d9a77f', '#bb8259', '#9c6642', '#7c4b2d', '#5f3821'], hairs: ['#1c1917', '#241c18', '#3a2a20', '#5a3d2a'], curly: 0.5, light: 0.1, lightHairs: ['#c9a063', '#8a5a34'], beard: 0.45 },
  スペイン: { skins: ['#f3d3b7', '#ebc39f', '#ddae86', '#cc9870'], hairs: ['#1c1917', '#30221a', '#4a3324', '#5e4130'], curly: 0.15, light: 0.06, lightHairs: ['#8a6440'], beard: 0.5 },
  セルビア: { skins: ['#f7e0cc', '#f1d2b8', '#e8c3a3'], hairs: ['#2f231c', '#4a3324', '#6b4a30', '#1c1917'], curly: 0.06, light: 0.3, lightHairs: ['#b48a58', '#d2b17c', '#8a6440'], beard: 0.45 },
};

const STYLES: HairStyle[] = ['buzz', 'short', 'short', 'sidePart', 'sidePart', 'spiky', 'long', 'receding'];
const FACIAL: FacialHair[] = ['stubble', 'stubble', 'beard', 'mustache', 'goatee'];

function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 文字列（選手のIDなど）と国籍から、顔の作りを決める。同じ文字列なら、いつも同じ顔になる */
export function faceLook(seed: string, nationality: string): FaceLook {
  const rng = createRng(hashOf(seed) || 1);
  const palette = PALETTES[nationality] ?? PALETTES['日本'] as Palette;
  const range = (min: number, max: number) => min + rng.next() * (max - min);
  const curly = rng.chance(palette.curly);
  const hairStyle: HairStyle = curly ? 'curly' : rng.pick(STYLES);
  const light = rng.chance(palette.light);
  return {
    skin: rng.pick(palette.skins),
    hair: light ? rng.pick(palette.lightHairs) : rng.pick(palette.hairs),
    hairStyle,
    volume: Math.round(range(0, 6)),
    fringe: range(30, 35),
    part: rng.pick([-1, 0, 1] as const),
    width: range(20.5, 24.5),
    jaw: range(0.5, 0.78),
    chin: range(72, 76),
    browArch: range(0.5, 2.6),
    browTilt: range(-1.2, 1.4),
    browWeight: range(1.5, 2.6),
    eyeGap: range(8.4, 10.6),
    eyeHeight: range(1.5, 2.4),
    nose: rng.pick([0, 1] as const),
    mouthWidth: range(4, 6.5),
    smile: range(-0.6, 2.6),
    facialHair: rng.chance(palette.beard) ? rng.pick(FACIAL) : 'none',
    facialHairFrom: rng.int(21, 31),
    grayFrom: rng.int(33, 48),
    glassesFrom: rng.chance(0.35) ? rng.int(38, 60) : 999,
  };
}

export type Outfit = { kind: 'kit'; primary: string; secondary: string } | { kind: 'suit'; tie: string };

/** 顔のイラスト。age で白髪とひげが変わる。glasses はスタッフ向け（年齢で決まる眼鏡） */
export function Face({ look, age, outfit, size = 48, background = '#dde3ec', title }: {
  look: FaceLook; age: number; outfit: Outfit; size?: number; background?: string; title?: string;
}) {
  const w = look.width;
  const L = 50 - w;
  const R = 50 + w;
  const gray = age >= look.grayFrom;
  const hair = gray ? (age >= look.grayFrom + 8 ? '#c9c9c9' : '#8d8d8d') : look.hair;
  // 年を取ると、生え際が後退しやすい
  const style: HairStyle = age >= 34 && look.hairStyle === 'short' && look.volume < 2 ? 'receding'
    : look.hairStyle === 'receding' && age < 29 ? 'short' : look.hairStyle;
  const facial = age >= look.facialHairFrom ? look.facialHair : 'none';
  const skinShade = shade(look.skin, 0.12);
  const line = shade(look.skin, 0.4);
  const brow = gray ? '#7a7a7a' : shade(look.hair, look.hair === '#1c1917' ? 0 : 0.25);
  const top = 16 - look.volume * 1.4;
  const headPath = `M ${L} 44 C ${L} 16 ${R} 16 ${R} 44 C ${R} 58 ${50 + w * look.jaw} 70 50 ${look.chin} C ${50 - w * look.jaw} 70 ${L} 58 ${L} 44 Z`;
  const hl = L - 1.5;
  const hr = R + 1.5;
  const fy = look.fringe;
  const leftY = fy + (look.part === -1 ? 3 : look.part === 1 ? -1 : 0);
  const rightY = fy + (look.part === 1 ? 3 : look.part === -1 ? -1 : 0);
  const cap = `M ${hl} 42 C ${hl} ${top} ${hr} ${top} ${hr} 42 C ${hr - 1} 37 ${R - 3} ${rightY} ${50 + w * 0.45} ${rightY} C 52 ${fy - 1} 48 ${fy - 1} ${50 - w * 0.45} ${leftY} C ${L + 3} ${leftY} ${hl + 1} 37 ${hl} 42 Z`;
  const eyeY = 47;
  const browY = 41;
  const glasses = age >= look.glassesFrom;
  const partSide = look.part || -1;

  return (
    <svg className="face" viewBox="7 6 86 86" width={size} height={size} role="img" aria-label={title ?? '顔'}>
      {title && <title>{title}</title>}
      <rect x={7} y={6} width={86} height={86} fill={background} />
      {/* 長い髪は頭の後ろに */}
      {style === 'long' && <path d={`M ${hl - 1} 36 C ${hl - 3} 58 ${hl + 1} 64 ${hl + 7} 63 L ${hr - 7} 63 C ${hr - 1} 64 ${hr + 3} 58 ${hr + 1} 36 Z`} fill={hair} />}
      {/* 服 */}
      {outfit.kind === 'kit' ? (
        <>
          <path d="M8 100 C10 83 28 76 50 76 C72 76 90 83 92 100 Z" fill={outfit.primary} />
          <path d="M40 77 L50 88 L60 77" fill="none" stroke={outfit.secondary} strokeWidth={3.5} strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path d="M8 100 C10 83 28 76 50 76 C72 76 90 83 92 100 Z" fill="#2d3440" />
          <path d="M41 77 L50 94 L59 77 Z" fill="#f4f4f4" />
          <path d="M48.3 80 L51.7 80 L53.2 92 L50 97 L46.8 92 Z" fill={outfit.tie} />
        </>
      )}
      <rect x={43} y={62} width={14} height={17} rx={4} fill={skinShade} />
      <ellipse cx={L + 0.5} cy={49} rx={3.6} ry={6} fill={skinShade} />
      <ellipse cx={R - 0.5} cy={49} rx={3.6} ry={6} fill={skinShade} />
      <path d={headPath} fill={look.skin} />
      {/* ひげ（口より先に描く） */}
      {facial === 'stubble' && <path d={`M ${L + 1} 52 C ${L + 1} 64 ${50 - w * look.jaw} 71 50 ${look.chin} C ${50 + w * look.jaw} 71 ${R - 1} 64 ${R - 1} 52 C ${R - 6} 60 ${56} 58 50 58 C 44 58 ${L + 6} 60 ${L + 1} 52 Z`} fill={hair} opacity={0.2} />}
      {facial === 'beard' && <path d={`M ${L} 50 C ${L} 63 ${50 - w * look.jaw} 72 50 ${look.chin + 1.5} C ${50 + w * look.jaw} 72 ${R} 63 ${R} 50 C ${R - 3} 60 ${57} 59 50 59.5 C 43 59 ${L + 3} 60 ${L} 50 Z`} fill={hair} opacity={0.9} />}
      {facial === 'goatee' && <path d={`M 46.5 66.5 C 46.5 70 48 ${look.chin} 50 ${look.chin + 0.5} C 52 ${look.chin} 53.5 70 53.5 66.5 C 52 67.5 48 67.5 46.5 66.5 Z`} fill={hair} opacity={0.75} />}
      {(facial === 'mustache' || facial === 'goatee' || facial === 'beard') && <path d="M 44 60.6 Q 50 57.2 56 60.6 Q 50 59.6 44 60.6 Z" fill={hair} />}
      {/* 髪 */}
      {style === 'curly' && (
        <g fill={hair}>
          <path d={`M ${hl} 44 C ${hl - 1} ${top + 2} ${hr + 1} ${top + 2} ${hr} 44 C ${hr - 2} 36 ${R - 4} ${fy} 50 ${fy} C ${L + 4} ${fy} ${hl + 2} 36 ${hl} 44 Z`} />
          {Array.from({ length: 9 }, (_, i) => {
            const t = i / 8;
            const x = hl + (hr - hl) * t;
            const y = top + 9 - Math.sin(Math.PI * t) * 9;
            return <circle key={i} cx={x} cy={y + 4} r={4.6 + look.volume * 0.25} />;
          })}
        </g>
      )}
      {style === 'spiky' && (
        <path d={`M ${hl} 42 L ${hl + 1} ${top + 10} L ${hl + 5} ${top + 6} L ${hl + 8} ${top} L ${50 - 8} ${top + 3} L ${50 - 3} ${top - 3} L ${50 + 2} ${top + 2} L ${50 + 7} ${top - 2} L ${hr - 8} ${top + 3} L ${hr - 4} ${top + 5} L ${hr - 1} ${top + 10} L ${hr} 42 C ${hr - 1} 37 ${R - 3} ${rightY} 50 ${fy} C ${L + 3} ${leftY} ${hl + 1} 37 ${hl} 42 Z`} fill={hair} />
      )}
      {(style === 'short' || style === 'sidePart' || style === 'long') && <path d={cap} fill={hair} />}
      {style === 'sidePart' && <path d={`M ${50 + partSide * 7} ${top + 6} Q ${50 + partSide * 12} ${fy - 4} ${50 + partSide * 2} ${fy + 1}`} fill="none" stroke={shade(hair, -0.25)} strokeWidth={0.9} opacity={0.6} />}
      {style === 'buzz' && <path d={`M ${L} 40 C ${L} 18 ${R} 18 ${R} 40 C ${R - 1} 33 ${R - 6} 29.5 50 29.5 C ${L + 6} 29.5 ${L + 1} 33 ${L} 40 Z`} fill={hair} opacity={0.85} />}
      {style === 'receding' && (
        <g fill={hair}>
          <path d={`M ${hl} 44 C ${hl} 34 ${L + 3} 28 ${L + 7} 27 C ${L + 5} 31 ${L + 3} 37 ${L + 1} 44 Z`} />
          <path d={`M ${hr} 44 C ${hr} 34 ${R - 3} 28 ${R - 7} 27 C ${R - 5} 31 ${R - 3} 37 ${R - 1} 44 Z`} />
          <path d={`M ${L + 7} 27 C 44 22 56 22 ${R - 7} 27 C 56 25.5 44 25.5 ${L + 7} 27 Z`} opacity={0.7} />
        </g>
      )}
      {/* 眉、目、鼻、口 */}
      <g fill="none" stroke={brow} strokeWidth={look.browWeight} strokeLinecap="round">
        <path d={`M ${50 - look.eyeGap - 4.5} ${browY + look.browTilt} Q ${50 - look.eyeGap} ${browY - look.browArch} ${50 - look.eyeGap + 4} ${browY}`} />
        <path d={`M ${50 + look.eyeGap + 4.5} ${browY + look.browTilt} Q ${50 + look.eyeGap} ${browY - look.browArch} ${50 + look.eyeGap - 4} ${browY}`} />
      </g>
      {[-1, 1].map((side) => (
        <g key={side}>
          <ellipse cx={50 + side * look.eyeGap} cy={eyeY} rx={2.3} ry={look.eyeHeight} fill="#262220" />
          <circle cx={50 + side * look.eyeGap + 0.7} cy={eyeY - 0.6} r={0.6} fill="#ffffff" />
          {age >= 33 && <path d={`M ${50 + side * (look.eyeGap + 4)} ${eyeY + 1} l ${side * 2} 1`} stroke={line} strokeWidth={0.6} opacity={0.6} />}
        </g>
      ))}
      {look.nose === 0
        ? <path d="M 50 49 Q 53 55.5 50 57" fill="none" stroke={line} strokeWidth={1.3} strokeLinecap="round" opacity={0.75} />
        : <path d="M 47.5 56 Q 50 58.2 52.5 56" fill="none" stroke={line} strokeWidth={1.3} strokeLinecap="round" opacity={0.75} />}
      <path d={`M ${50 - look.mouthWidth} 63 Q 50 ${63 + look.smile} ${50 + look.mouthWidth} 63`} fill="none" stroke="#8b4a3c" strokeWidth={1.6} strokeLinecap="round" />
      {glasses && (
        <g fill="none" stroke="#2b2b2b" strokeWidth={1.2}>
          <circle cx={50 - look.eyeGap} cy={eyeY} r={4.4} />
          <circle cx={50 + look.eyeGap} cy={eyeY} r={4.4} />
          <path d={`M ${50 - look.eyeGap + 4.4} ${eyeY} Q 50 ${eyeY - 1.6} ${50 + look.eyeGap - 4.4} ${eyeY}`} />
        </g>
      )}
    </svg>
  );
}

/** 選手の顔。所属クラブのユニフォームを着る（所属なしや海外の選手は灰色） */
export function PlayerFace({ game, player, size = 48 }: { game: GameState; player: PlayerRecord; size?: number }) {
  const club = player.clubId ? game.clubs[player.clubId] : undefined;
  const outfit: Outfit = club ? { kind: 'kit', primary: club.colors.primary, secondary: club.colors.secondary } : { kind: 'kit', primary: '#8a94a3', secondary: '#e8ecf2' };
  return <Face look={faceLook(player.id, player.nationality)} age={player.age} outfit={outfit} size={size} title={player.name} />;
}

/** スタッフや記者の顔（スーツ）。seed で顔が決まり、年齢は役柄で決める */
export function StaffFace({ seed, age, tie = '#7a1f2b', size = 48 }: { seed: string; age: number; tie?: string; size?: number }) {
  return <Face look={faceLook(seed, '日本')} age={age} outfit={{ kind: 'suit', tie }} size={size} />;
}
