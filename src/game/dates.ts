// ゲーム内の日付（'YYYY-MM-DD'）の計算。時差の影響を受けないように UTC で扱う。

const toDate = (date: string): Date => new Date(`${date}T00:00:00Z`);
const toIso = (date: Date): string => date.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const d = toDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** 曜日（0が日曜日） */
export function weekday(date: string): number {
  return toDate(date).getUTCDay();
}

/** a から b までの日数（b が後なら正） */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}

export function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/** 'MM-DD' */
export function monthDay(date: string): string {
  return date.slice(5);
}

/** 日付と目的から、その日だけの乱数のシードを作る（同じセーブなら同じ結果になる） */
export function daySeed(seed: number, date: string, salt: string): number {
  let h = 2166136261 ^ seed;
  for (const ch of `${date}|${salt}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
