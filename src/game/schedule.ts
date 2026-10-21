// 日程づくり。ホームとアウェイで総当たり（34節）。要件定義書「リーグと日程」の「シーズンの暦」に対応する。

import type { Rng } from '../engine/rng';
import type { Fixture } from './types';

/** 試合のない週末（2月最後の土曜日から数えて何週目か）。春・夏・秋の中断期間 */
const OFF_WEEKS = new Set([4, 14, 15, 16, 22, 27, 32, 36, 37]);
/** 土曜日の後の水曜日にも試合をする週（ゴールデンウィークとお盆） */
const MIDWEEK_AFTER = new Set([9, 24]);

const iso = (date: Date): string => date.toISOString().slice(0, 10);

/** その年の34節の日付。2月最後の土曜日に開幕し、12月上旬に終わる。 */
export function seasonDates(year: number): string[] {
  const lastFebDay = new Date(Date.UTC(year, 2, 0));
  const start = new Date(lastFebDay);
  start.setUTCDate(lastFebDay.getUTCDate() - ((lastFebDay.getUTCDay() + 1) % 7));
  const dates: string[] = [];
  for (let week = 0; week < 41; week++) {
    const saturday = new Date(start);
    saturday.setUTCDate(start.getUTCDate() + week * 7);
    if (!OFF_WEEKS.has(week)) dates.push(iso(saturday));
    if (MIDWEEK_AFTER.has(week)) {
      const wednesday = new Date(saturday);
      wednesday.setUTCDate(saturday.getUTCDate() + 4);
      dates.push(iso(wednesday));
    }
  }
  return dates;
}

const swap = (pairs: [string, string][]): [string, string][] => pairs.map(([h, a]) => [a, h]);

function hasLongRun(rounds: [string, string][][], teams: readonly string[]): boolean {
  for (const team of teams) {
    let run = 0;
    let last = '';
    for (const pairs of rounds) {
      const venue = pairs.some(([h]) => h === team) ? 'H' : 'A';
      run = venue === last ? run + 1 : 1;
      last = venue;
      if (run >= 3) return true;
    }
  }
  return false;
}

/**
 * 後半17節の並び。前半の組み合わせのホームとアウェイを入れ替えたものを、
 * 「ホーム（アウェイ）が3試合続かない」「同じ相手と2節続けて当たらない」ように並べる。
 */
function secondHalfOrder(firstHalf: [string, string][][], teams: readonly string[]): [string, string][][] {
  const n = firstHalf.length;
  const lastRound = firstHalf[n - 1] ?? [];
  const sameOpponents = (a: [string, string][], b: [string, string][]) =>
    a.some(([h, w]) => b.some(([x, y]) => (h === y && w === x) || (h === x && w === y)));
  for (const reversed of [false, true]) {
    for (let shift = 0; shift < n; shift++) {
      const order = Array.from({ length: n }, (_, i) => {
        const k = reversed ? (n - 1 - i + shift) % n : (i + shift) % n;
        return swap(firstHalf[k] ?? []);
      });
      if (sameOpponents(lastRound, order[0] ?? [])) continue;
      if (!hasLongRun([...firstHalf, ...order], teams)) return order;
    }
  }
  return firstHalf.map(swap);
}

/**
 * 総当たりの組み合わせ（ベルガー表）。前半17節で全チームと1回ずつ当たり、
 * 後半17節は同じ組み合わせをホームとアウェイを入れ替えて行う（並び順は secondHalfOrder で決める）。
 */
export function makeSchedule(clubIds: readonly string[], rng: Rng, year: number): Fixture[] {
  const n = clubIds.length;
  if (n % 2 !== 0) throw new Error('チーム数は偶数にしてください');
  // 毎シーズン違う日程になるように、並びをシャッフルする
  const teams = [...clubIds];
  for (let i = teams.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [teams[i], teams[j]] = [teams[j] as string, teams[i] as string];
  }

  const firstHalf: [string, string][][] = [];
  const last = n - 1;
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    // 固定チームとの試合は、節ごとにホームとアウェイを交互にする
    const fixed = teams[last] as string;
    const rotating = teams[r] as string;
    pairs.push(r % 2 === 0 ? [rotating, fixed] : [fixed, rotating]);
    for (let k = 1; k < n / 2; k++) {
      const a = teams[(r + k) % last] as string;
      const b = teams[(r - k + last) % last] as string;
      pairs.push(k % 2 === 1 ? [a, b] : [b, a]);
    }
    firstHalf.push(pairs);
  }

  const dates = seasonDates(year);
  const rounds = [...firstHalf, ...secondHalfOrder(firstHalf, teams)];
  return rounds.flatMap((pairs, i) =>
    pairs.map(([homeId, awayId], j) => ({
      id: `${year}-${String(i + 1).padStart(2, '0')}-${j + 1}`,
      round: i + 1,
      date: dates[i] ?? dates[dates.length - 1] ?? `${year}-12-01`,
      homeId,
      awayId,
      result: null,
    })));
}
