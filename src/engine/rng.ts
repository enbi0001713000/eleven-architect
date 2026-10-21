// シード付きの乱数。同じシードなら同じ乱数の並びになり、試合を再現できる。

export interface Rng {
  /** 0以上1未満 */
  next(): number;
  /** min以上max以下の整数 */
  int(min: number, max: number): number;
  chance(p: number): boolean;
  normal(mean: number, sd: number): number;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly T[], weight: (item: T) => number): T;
}

export function createRng(seed: number): Rng {
  // mulberry32
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('pick: 空の配列からは選べません');
    return items[Math.floor(next() * items.length)] as T;
  };

  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    normal: (mean, sd) => {
      // Box-Muller法
      const u = 1 - next();
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    pick,
    weighted: <T>(items: readonly T[], weight: (item: T) => number): T => {
      let total = 0;
      for (const item of items) total += Math.max(0, weight(item));
      if (total <= 0) return pick(items);
      let r = next() * total;
      for (const item of items) {
        r -= Math.max(0, weight(item));
        if (r < 0) return item;
      }
      return items[items.length - 1] as T;
    },
  };
}
