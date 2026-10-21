// コマンドラインの引数（--seed=123 のような形）を読む。

export function readArgs(argv: readonly string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (match?.[1]) args.set(match[1], match[2] ?? 'true');
  }
  return args;
}

export function numberArg(args: Map<string, string>, name: string, fallback: number): number {
  const raw = args.get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} には数値を指定してください（今は「${raw}」）`);
  return value;
}

/** 全角文字を2文字分として、表示幅をそろえる */
export function padDisplay(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  let w = 0;
  for (const ch of text) w += /[\u0000-ÿ｡-ﾟ]/.test(ch) ? 1 : 2;
  const pad = ' '.repeat(Math.max(0, width - w));
  return align === 'left' ? text + pad : pad + text;
}

export const percent = (v: number): string => `${(v * 100).toFixed(1)}%`;
