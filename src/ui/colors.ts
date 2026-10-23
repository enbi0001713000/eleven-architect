// 色の計算：明るさ、色どうしの近さ、背景の上で読める文字の色

/** 色の明るさ（0〜1） */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0.5;
  const v = parseInt(m[1] as string, 16);
  return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
}

/** 2つの色の近さ（RGBの差の合計。0〜765） */
export function colorDistance(a: string, b: string): number {
  const parse = (hex: string) => {
    const v = parseInt(hex.replace('#', ''), 16) || 0;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  return Math.abs((r1 ?? 0) - (r2 ?? 0)) + Math.abs((g1 ?? 0) - (g2 ?? 0)) + Math.abs((b1 ?? 0) - (b2 ?? 0));
}

/** この色の上に置く文字の色（白か黒） */
export const textOn = (background: string): string => (luminance(background) > 0.6 ? '#111111' : '#ffffff');

/** 色を暗く（amount が負なら明るく）する。amount は -1〜1 */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1] as string, 16);
  const mix = (c: number) => Math.round(amount >= 0 ? c * (1 - amount) : c + (255 - c) * -amount);
  const r = mix((v >> 16) & 255);
  const g = mix((v >> 8) & 255);
  const b = mix(v & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * クラブの色を、画面の飾りに使う変数にする。線や絵記号に使う色は背景から見分けられるように選ぶ
 * （明るい配色で白に近い色なら2番目の色、暗い配色で黒に近い色なら明るくした色）
 */
export function clubVars(colors: { primary: string; secondary: string } | undefined, theme: 'light' | 'dark' = 'light'): Record<string, string> {
  if (!colors) return {};
  const { primary, secondary } = colors;
  const line = theme === 'dark'
    ? (luminance(primary) > 0.3 ? primary : luminance(secondary) > 0.3 ? secondary : shade(primary, -0.5))
    : (luminance(primary) < 0.85 ? primary : luminance(secondary) < 0.85 ? secondary : '#7d8797');
  return {
    '--club': primary,
    '--club-2': secondary,
    '--club-dark': shade(primary, 0.35),
    '--club-ink': textOn(primary),
    '--club-line': line,
  };
}
