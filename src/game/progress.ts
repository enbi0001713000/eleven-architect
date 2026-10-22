// 時間の進め方：1日ずつ進める処理と、「次の出来事まで進める」。試合の後の状態の変化もここで行う。
// 要件定義書「時間の進め方」「練習」「戦術の熟成度」「ケガと疲労」に対応する。
//
// 毎日：ケガの回復、疲労の増減、コンディションの回復、練習（疲労、ケガ、熟成度）、モラルの変化
// 毎週（月曜日）：成長と衰え、練習のレポート、選手からの申し出
// 毎月1日：前の月のお金を締める。1月1日は年度も締めて、新しい年の予算を決める（finance.ts）
//          オーナーの信頼度が上下し、1月1日は前のシーズンを評価して、新しい目標を示す（owner.ts）
// 試合の日：記者会見の知らせ。「次の出来事まで進める」は、試合の日と大事な知らせが届いた日に止まる

import { overallRating } from '../engine/ratings';
import { createRng, type Rng } from '../engine/rng';
import type { MatchResult, TeamInstructions } from '../engine/types';
import { BALANCE, TRAINING_FOCUS, TRAINING_INTENSITY } from './balance';
import { applyInjury, canPlay, createInjury, injuryName } from './condition';
import { addDays, daySeed, weekday } from './dates';
import { developWeek } from './development';
import { financeAfterEvents, financeBeforeEvents } from './finance';
import { addMessage } from './inbox';
import { afterMatchMorale, checkPromises, dailyMorale, maybePlayerRequest } from './morale';
import { seasonEvents } from './offseason';
import { isDismissed, ownerAfterEvents, ownerBeforeEvents } from './owner';
import { LEAGUE_RULES } from './rules';
import { repairSelection, validateSelection } from './selection';
import { closePress, schedulePress } from './talks';
import type { Club, Fixture, GameState, PlayerRecord } from './types';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

/** 今日が自分のクラブの試合の日で、まだ試合をしていなければ、その試合 */
export function todaysFixture(state: GameState): Fixture | undefined {
  const myId = state.manager.clubId;
  return state.fixtures.find((f) => f.date === state.date && f.result === null && (f.homeId === myId || f.awayId === myId));
}

/** 指示の違い（段階の合計） */
function instructionDistance(a: TeamInstructions, b: TeamInstructions): number {
  return (Object.keys(a) as (keyof TeamInstructions)[]).reduce((n, key) => n + Math.abs(a[key] - b[key]), 0);
}

/** チーム指示を変えた分だけ下がった熟成度（まだ1日が過ぎていなくても、試合にはこの値を使う） */
export function instructionFamiliarity(club: Club): number {
  const distance = instructionDistance(club.tactics.instructions, club.familiarity.instructionsRef);
  return distance === 0
    ? club.familiarity.instructions
    : Math.max(25, club.familiarity.instructions - distance * BALANCE.instructionChangePenalty);
}

function settleInstructions(club: Club): void {
  club.familiarity.instructions = instructionFamiliarity(club);
  club.familiarity.instructionsRef = { ...club.tactics.instructions };
}

interface DayContext {
  rng: Rng;
  matchDay: boolean;
  /** 試合の前日と翌日は、練習を自動で軽めにする */
  lightDay: boolean;
}

function dailyClub(state: GameState, club: Club, ctx: DayContext): void {
  const mine = club.id === state.manager.clubId;
  const focus = TRAINING_FOCUS[club.training.focus];
  const intensityKey = ctx.lightDay ? 'light' : club.training.intensity;
  const intensity = TRAINING_INTENSITY[intensityKey];
  settleInstructions(club);

  if (!ctx.matchDay) {
    const gain = BALANCE.familiarityGain * focus.familiarity * intensity.growth;
    for (const formation of Object.keys(club.familiarity.formations) as (keyof Club['familiarity']['formations'])[]) {
      const value = club.familiarity.formations[formation] ?? BALANCE.familiarityFloor;
      club.familiarity.formations[formation] = round1(formation === club.tactics.formation
        ? value + gain * (100 - value) / 100
        : Math.max(BALANCE.familiarityFloor, value - BALANCE.familiarityDecay));
    }
    if (club.familiarity.formations[club.tactics.formation] === undefined) {
      club.familiarity.formations[club.tactics.formation] = BALANCE.familiarityFloor;
    }
    club.familiarity.instructions = round1(club.familiarity.instructions + gain * (100 - club.familiarity.instructions) / 100);
  }

  for (const id of club.playerIds) {
    const player = state.players[id];
    if (!player) continue;
    const s = player.status;

    // ケガの回復と、再発しやすい期間
    if (s.injury) {
      s.injury.daysLeft--;
      if (s.injury.daysLeft <= 0) {
        const healed = s.injury;
        s.injury = null;
        s.recurrence = { kind: healed.kind, part: healed.part, daysLeft: ctx.rng.int(...BALANCE.recurrenceDays) };
        s.condition = Math.min(s.condition, Math.max(60, 92 - healed.days * 0.25));
        if (mine) {
          addMessage(state, {
            category: 'medical', from: 'チームドクター', important: false, playerId: player.id,
            subject: `${player.name}がケガから復帰`,
            body: `${player.name}が${injuryName(healed)}から復帰しました。しばらくは同じところを痛めやすいので、無理をさせすぎないでください。`,
          });
        }
      }
    } else if (s.recurrence) {
      s.recurrence.daysLeft--;
      if (s.recurrence.daysLeft <= 0) s.recurrence = null;
    }

    // 疲労は毎日少しずつ抜ける（年齢が上がると抜けにくい）
    const decay = BALANCE.fatigueDecay - Math.max(0, player.age - 29) * BALANCE.fatigueDecayPerAgeOver29;
    s.fatigue *= 1 - decay;

    let recovery = 1;
    if (!ctx.matchDay && !s.injury) {
      // 練習：疲労がたまり、戦術に慣れ、まれにケガをする
      s.fatigue += BALANCE.trainingLoad * focus.load * intensity.load;
      s.condition += intensity.condition;
      s.integration = Math.min(100, s.integration + 1.2 * focus.familiarity);
      recovery = focus.recovery;
      const chance = BALANCE.trainingInjury * focus.injury * intensity.injury
        * (0.5 + player.hidden.injuryProneness / 20) * (1 + s.fatigue / 50)
        * (s.recurrence ? BALANCE.recurrenceMultiplier : 1);
      if (ctx.rng.chance(chance)) {
        const injury = createInjury(ctx.rng, player, state.date, 'training');
        if (applyInjury(player, injury) && mine) reportInjury(state, player, '練習中に');
      }
    }

    // コンディションの回復。疲れがたまっていると戻りきらない
    const ceiling = 100 - Math.max(0, s.fatigue - 50) * 0.4;
    s.condition += (ceiling - s.condition) * BALANCE.conditionRecovery * recovery * (1 - s.fatigue / 250);
    s.condition = round1(clamp(s.condition, 0, 100));
    s.fatigue = round1(clamp(s.fatigue, 0, 100));

    dailyMorale(state, player);
    s.morale = round1(s.morale);
  }
}

function reportInjury(state: GameState, player: PlayerRecord, where: string): void {
  const injury = player.status.injury;
  if (!injury) return;
  const weeks = injury.days >= 14 ? `約${Math.round(injury.days / 7)}週間` : `約${injury.days}日`;
  const club = state.clubs[player.clubId ?? ''];
  const inLineup = club?.selection?.lineup.includes(player.id) || club?.selection?.bench.includes(player.id);
  addMessage(state, {
    category: 'medical', from: 'チームドクター', important: true, playerId: player.id,
    subject: `${player.name}が負傷（${injuryName(injury)}）`,
    body: `${player.name}が${where}${injuryName(injury)}を負いました。全治${weeks}の見込みです。`
      + (injury.daysLeft > BALANCE.playableInjuryDays && inLineup ? '\n試合のメンバーに入っているので、入れ替えてください。' : ''),
  });
}

/** 毎週月曜日：成長と衰え、練習のレポート、選手からの申し出 */
function weekly(state: GameState, rng: Rng): void {
  const myId = state.manager.clubId;
  const growth: { player: PlayerRecord; delta: number }[] = [];
  for (const club of Object.values(state.clubs)) {
    for (const id of club.playerIds) {
      const player = state.players[id];
      if (!player) continue;
      const change = developWeek(rng, player, club, player.status.recentMinutes);
      player.status.recentMinutes = Math.round(player.status.recentMinutes * 0.75);
      if (club.id === myId) growth.push({ player, delta: change.overall });
    }
  }
  for (const id of state.overseasPool) {
    const player = state.players[id];
    if (player) developWeek(rng, player, null, 180);
  }

  const club = state.clubs[myId];
  if (club) {
    const players = club.playerIds.map((id) => state.players[id]).filter((p): p is PlayerRecord => p !== undefined);
    const tired = players.filter((p) => p.status.fatigue >= 60).sort((a, b) => b.status.fatigue - a.status.fatigue);
    const injured = players.filter((p) => p.status.injury);
    const lines = [
      `練習の方針：${TRAINING_FOCUS[club.training.focus].label}　強度：${TRAINING_INTENSITY[club.training.intensity].label}`,
      `戦術の熟成度：フォーメーション ${Math.round(club.familiarity.formations[club.tactics.formation] ?? 0)}%、チーム指示 ${Math.round(instructionFamiliarity(club))}%`,
      tired.length > 0 ? `疲れがたまっている選手：${tired.slice(0, 5).map((p) => `${p.name}（${Math.round(p.status.fatigue)}）`).join('、')}` : '疲れがたまっている選手はいません。',
      injured.length > 0 ? `ケガで離脱中：${injured.map((p) => `${p.name}（残り${p.status.injury?.daysLeft}日）`).join('、')}` : '',
    ];
    // 月の初めには、伸びている選手も伝える
    if (Number(state.date.slice(8, 10)) <= 7) {
      const risers = growth.filter((g) => g.player.age <= 24).sort((a, b) => b.delta - a.delta).slice(0, 3);
      if (risers.length > 0) lines.push(`伸びている若手：${risers.map((g) => `${g.player.name}（総合力 ${overallRating(g.player).toFixed(1)}）`).join('、')}`);
    }
    addMessage(state, {
      category: 'training', from: 'アシスタントコーチ', important: false,
      subject: '今週の練習レポート', body: lines.filter((l) => l !== '').join('\n'),
    });
  }
  maybePlayerRequest(rng, state);
}

/** 1日進める（自分のクラブの試合が残っている日は進められない） */
export function advanceDay(state: GameState): void {
  if (todaysFixture(state)) throw new Error('今日の試合がまだ終わっていません');
  state.date = addDays(state.date, 1);
  const rng = createRng(daySeed(state.seed, state.date, 'day'));
  financeBeforeEvents(state);
  ownerBeforeEvents(state);
  seasonEvents(state, rng);
  ownerAfterEvents(state, financeAfterEvents(state, rng));
  const matchDates = new Set(state.fixtures.filter((f) => f.result === null).map((f) => f.date));
  const ctx: DayContext = {
    rng,
    matchDay: matchDates.has(state.date),
    lightDay: matchDates.has(addDays(state.date, 1)) || state.fixtures.some((f) => f.date === addDays(state.date, -1)),
  };
  for (const club of Object.values(state.clubs)) dailyClub(state, club, ctx);
  if (weekday(state.date) === 1) weekly(state, rng);
  const fixture = todaysFixture(state);
  if (fixture) {
    schedulePress(state, fixture);
    prepareSelection(state);
  }
}

/** 試合の日の朝：メンバーに出られない選手がいたら、アシスタントコーチが入れ替えておく */
function prepareSelection(state: GameState): void {
  const club = state.clubs[state.manager.clubId];
  if (!club?.selection) return;
  if (validateSelection(state, club.id, club.tactics.formation, club.selection).length === 0) return;
  const before = new Set([...club.selection.lineup, ...club.selection.bench]);
  const repaired = repairSelection(state, club.id, club.tactics.formation, club.selection);
  const after = new Set([...repaired.lineup, ...repaired.bench]);
  const out = [...before].filter((id) => !after.has(id)).map((id) => state.players[id]?.name ?? '');
  const added = [...after].filter((id) => !before.has(id)).map((id) => state.players[id]?.name ?? '');
  club.selection = repaired;
  addMessage(state, {
    category: 'club', from: 'アシスタントコーチ', important: false,
    subject: '試合に出られない選手を入れ替えました',
    body: `今日の試合のメンバーに、ケガや出場停止で出られない選手がいたので入れ替えました。\n外した選手：${out.join('、') || 'なし'}\n入れた選手：${added.join('、') || 'なし'}\n戦術の画面で変えられます。`,
  });
}

export type StopReason = 'match' | 'message' | 'limit' | 'dismissed';

/** 「次の出来事まで進める」：試合の日か、大事な知らせが届いた日まで進める */
export function advanceToNextEvent(state: GameState, maxDays = 120): { reason: StopReason; days: number } {
  const startNumber = state.nextMessageNumber;
  for (let days = 0; days < maxDays; days++) {
    if (isDismissed(state)) return { reason: 'dismissed', days };
    if (todaysFixture(state)) return { reason: 'match', days };
    advanceDay(state);
    if (todaysFixture(state)) return { reason: 'match', days: days + 1 };
    const arrived = state.inbox.filter((m) => Number(m.id.slice(1)) >= startNumber);
    if (arrived.some((m) => m.important)) return { reason: 'message', days: days + 1 };
  }
  return { reason: 'limit', days: maxDays };
}

/**
 * 試合の後の状態の変化：コンディション、疲労、ケガ、モラル、出場機会、熟成度。
 * season.ts の applyMatchday が、記録をつけたあとに呼ぶ（節を進める前）。
 */
export function afterMatches(state: GameState, fixtures: Fixture[], results: Record<string, MatchResult>): void {
  const rng = createRng(daySeed(state.seed, fixtures[0]?.date ?? state.date, `match-${state.season.round}`));
  const myId = state.manager.clubId;
  for (const fixture of fixtures) {
    const result = results[fixture.id];
    if (!result) continue;
    for (const side of [0, 1] as const) {
      const clubId = side === 0 ? fixture.homeId : fixture.awayId;
      const opponentId = side === 0 ? fixture.awayId : fixture.homeId;
      const club = state.clubs[clubId];
      if (!club) continue;
      const mine = clubId === myId;
      const outcome = Math.sign(result.score[side] - result.score[side === 0 ? 1 : 0]) as 1 | 0 | -1;
      const derby = club.rivalId === opponentId;
      const lines = new Map(result.players.filter((l) => l.side === side).map((l) => [l.player.id, l]));
      const bench = new Set(result.teams[side].bench ?? []);

      for (const id of club.playerIds) {
        const player = state.players[id];
        if (!player) continue;
        const s = player.status;
        const line = lines.get(id);
        let share: number | null;
        if (line) {
          const on = line.minuteOn ?? 0;
          const off = line.minuteOff ?? 90;
          const minutes = Math.max(1, Math.min(90, off) - Math.min(90, on));
          s.condition = round1(Math.min(s.condition, line.staminaEnd));
          s.fatigue = round1(Math.min(100, s.fatigue + BALANCE.matchLoad * (minutes / 90)));
          s.recentMinutes += minutes;
          s.recentRatings = [line.stats.rating, ...s.recentRatings].slice(0, 5);
          s.integration = Math.min(100, s.integration + 3);
          share = line.started ? 1 : 0.5;
          if (line.injured) {
            const injury = createInjury(rng, player, fixture.date, 'contact', s.injury !== null);
            if (applyInjury(player, injury) && mine) reportInjury(state, player, '試合中に');
          }
        } else if (bench.has(id)) {
          share = 0.1;
        } else {
          share = canPlay(player) ? 0 : null;
        }
        afterMatchMorale(player, outcome, derby, line?.stats.rating ?? null, share);
      }

      // 試合で使った形は熟成度が上がる
      const formation = result.teams[side].tactics.formation;
      const value = club.familiarity.formations[formation] ?? BALANCE.familiarityFloor;
      club.familiarity.formations[formation] = round1(value + BALANCE.familiarityMatchGain * (100 - value) / 100);

      if (mine) {
        state.fanMood = clamp(state.fanMood + outcome * (derby ? 4 : 2), 0, 100);
        const suspended = club.playerIds.map((id) => state.players[id])
          .filter((p): p is PlayerRecord => p !== undefined && p.discipline.suspendedMatches > 0 && lines.has(p.id)
            && ((lines.get(p.id)?.stats.redCards ?? 0) > 0 || (lines.get(p.id)?.stats.yellowCards ?? 0) > 0));
        for (const p of suspended) {
          addMessage(state, {
            category: 'discipline', from: 'リーグ事務局', important: false, playerId: p.id,
            subject: `${p.name}が出場停止`,
            body: `${p.name}は、次の${p.discipline.suspendedMatches}試合に出場できません。`,
          });
        }
      }
    }
    closePress(state, fixture.id);
  }
  checkPromises(state, state.season.round >= LEAGUE_RULES.rounds);
}
