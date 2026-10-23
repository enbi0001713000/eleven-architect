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
