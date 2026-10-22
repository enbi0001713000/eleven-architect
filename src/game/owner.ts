// オーナーの評価（フェーズ3-B）。要件定義書「オーナーの目標」「信頼度と解任」に対応する。
//
// シーズン前：オーナーが順位と財務の目標を示し、予算の話をする（会話）。目標は開幕までに1回だけ話し合える
// 毎月1日：前の月の成績（目標の順位との差、勝ち点）とお金（緊急の借り入れ、オーナーの穴埋め、多すぎる借り入れ）で信頼度が上下する
// 信頼度が下がると警告が届き、シーズン中にとても低くなると解任される
// 1月1日：前のシーズンを、順位と財務の目標で評価する。大きく未達で信頼度も低いと解任される

import { overallRating } from '../engine/ratings';
import { addDays, monthDay, yearOf } from './dates';
import {
  addMonths, budgetLines, budgetReport, debtOf, firstYearStart, netResult, payrollOf, reputationRanks, yearToDate, yenText,
  type YearStart,
} from './finance';
import { FINANCE } from './financeBalance';
import { addMessage } from './inbox';
import { FINANCE_GOAL_LABEL, OWNER, POSITION_GOAL_LABEL, POSITION_GOALS } from './ownerBalance';
import { LEAGUE_RULES } from './rules';
import { standingsOf } from './standings';
import type {
  Club, FinanceGoalKind, GameState, OwnerState, OwnerStrictness, SeasonEvaluation, SeasonGoals, SeasonVerdict,
} from './types';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;
const roundTo = (yen: number, unit: number): number => Math.round(yen / unit) * unit;

export const goalLabel = (position: number): string => POSITION_GOAL_LABEL[position] ?? `${position}位以内`;

export function trustLabel(trust: number): string {
  if (trust >= 80) return 'とても厚い';
  if (trust >= 60) return '厚い';
  if (trust >= 40) return '普通';
  if (trust >= 25) return '低い';
  return '危うい';
}

const VERDICT_LABEL: Record<SeasonVerdict, string> = {
  exceeded: '目標を大きく上回った', met: '目標を達成', near: 'あと一歩', missed: '目標に届かず', farMissed: '目標を大きく下回った',
};
export const verdictLabel = (verdict: SeasonVerdict): string => VERDICT_LABEL[verdict];

const VERDICT_COMMENT: Record<SeasonVerdict, string> = {
  exceeded: '期待以上の結果です。素晴らしい。',
  met: '目標どおりです。よくやってくれました。',
  near: 'あと一歩でしたね。次は期待しています。',
  missed: '目標には届きませんでした。残念です。',
  farMissed: '目標を大きく下回りました。正直に言って、失望しています。',
};

const myClub = (state: GameState): Club | undefined => state.clubs[state.manager.clubId];
const seasonPlaying = (state: GameState): boolean => state.season.round <= LEAGUE_RULES.rounds;
export const isDismissed = (state: GameState): boolean => (state.owner?.dismissed ?? null) !== null;

// ---- 目標 ----

/** 戦力（上位18人の平均総合力）の順位 */
function strengthRanks(state: GameState): Map<string, number> {
  const strength = (club: Club): number => {
    const top = club.playerIds.map((id) => state.players[id]).filter((p) => p !== undefined)
      .map(overallRating).sort((a, b) => b - a).slice(0, 18);
    return top.reduce((a, b) => a + b, 0) / Math.max(1, top.length);
  };
  const ids = Object.values(state.clubs).map((c) => ({ id: c.id, s: strength(c) })).sort((a, b) => b.s - a.s).map((c) => c.id);
  return new Map(ids.map((id, i) => [id, i + 1]));
}

/** オーナーが求める順位（この順位以内）。評判の順位と戦力の順位の平均から決める */
export function positionGoalFor(state: GameState, clubId: string): number {
  const expected = Math.round(((reputationRanks(state).get(clubId) ?? 9) + (strengthRanks(state).get(clubId) ?? 9)) / 2);
  if (expected <= 1) return 1;
  if (expected <= 4) return 3;
  if (expected <= 7) return 6;
  if (expected <= 12) return 10;
  if (expected <= 15) return 15;
  return 17;
}

/** 目標が残留より上なのに、降格圏にいる */
const inDanger = (position: number, goal: number): boolean => position >= OWNER.dangerPosition && goal < OWNER.dangerPosition;

/** 財務の目標：赤字や借り入れがあればそれを、年俸が予算ぎりぎりならそれを求める */
function financeGoalFor(state: GameState, club: Club): FinanceGoalKind {
  const fin = club.finance;
  const last = fin.history.at(-1);
  if ((last && netResult(last.ledger) < 0) || fin.balance < 0) return 'noDeficit';
  if (debtOf(fin) > FINANCE.loanLimit[club.size] * 0.3) return 'reduceDebt';
  if (payrollOf(state, club.id) > fin.budget.wages * 0.98) return 'wagesWithinBudget';
  return 'noDeficit';
}

function newGoals(state: GameState, year: number): SeasonGoals {
  const club = myClub(state);
  const position = club ? positionGoalFor(state, club.id) : 10;
  return {
    year, position, basePosition: position,
    finance: club ? financeGoalFor(state, club) : 'noDeficit',
    negotiated: false,
    debtAtStart: club ? debtOf(club.finance) : 0,
  };
}

/** 監督が決まる前の世界に入れておく、仮のオーナー（startNewGame で決め直す） */
export function placeholderOwner(year: number, date: string): OwnerState {
  return {
    trust: OWNER.startTrust, strictness: 'normal',
    goals: { year, position: 10, basePosition: 10, finance: 'noDeficit', negotiated: false, debtAtStart: 0 },
    trustHistory: [{ date, trust: OWNER.startTrust }], warned: 0, evaluations: [], dismissed: null,
  };
}

export function initialOwner(state: GameState, strictness: OwnerStrictness = 'normal'): OwnerState {
  return {
    trust: OWNER.startTrust, strictness, goals: newGoals(state, state.season.year),
    trustHistory: [{ date: state.date, trust: OWNER.startTrust }], warned: 0, evaluations: [], dismissed: null,
  };
}

/**
 * 財務の目標を、今の時点で達成できているか。黒字かどうかは、試合のない1月や前半の月で赤字に見えやすいので、
 * 11月までは判定しない（met が null）
 */
export function financeGoalStatus(state: GameState): { met: boolean | null; text: string } {
  const club = myClub(state);
  const goals = state.owner.goals;
  if (!club) return { met: true, text: '' };
  const fin = club.finance;
  if (goals.finance === 'noDeficit') {
    const net = netResult(yearToDate(fin));
    return { met: Number(state.date.slice(5, 7)) >= 12 ? net >= 0 : null, text: `今年の差し引き ${yenText(net)}（12月末に判定）` };
  }
  if (goals.finance === 'wagesWithinBudget') {
    const payroll = payrollOf(state, club.id);
    return { met: payroll <= fin.budget.wages, text: `年俸の合計 ${yenText(payroll)} ／ 年俸予算 ${yenText(fin.budget.wages)}` };
  }
  const debt = debtOf(fin);
  return { met: debt < goals.debtAtStart || debt === 0, text: `借り入れの残り ${yenText(debt)}（年の初め ${yenText(goals.debtAtStart)}）` };
}

/** 目標を話し合えるか（開幕の試合の前まで、1シーズンに1回） */
export function canNegotiate(state: GameState): boolean {
  const owner = state.owner;
  if (!owner || owner.dismissed || owner.goals.negotiated || owner.goals.year !== state.season.year) return false;
  const myId = state.manager.clubId;
  return !state.fixtures.some((f) => f.result !== null && (f.homeId === myId || f.awayId === myId));
}

/** 目標を1段下げてもらう（予算は減る）か、上げる（予算が増える）。オーナーの返事のセリフを返す */
export function negotiateGoal(state: GameState, direction: 'lower' | 'higher'): { ok: boolean; lines: string[] } {
  const club = myClub(state);
  const owner = state.owner;
  if (!club || !canNegotiate(state)) return { ok: false, lines: ['今シーズンの目標は、もう決まっています。'] };
  const goals = owner.goals;
  const budget = club.finance.budget;
  const index = POSITION_GOALS.indexOf(goals.position);
  const change = roundTo(budget.total * OWNER.negotiationBudgetShare, 1e7);
  let lines: string[];
  if (direction === 'lower') {
    const next = POSITION_GOALS[index + 1];
    if (next === undefined) return { ok: false, lines: ['これ以上、目標を下げることはできません。'] };
    goals.position = next;
    // 予算は、移籍予算から先に減らす
    const fromTransfers = Math.min(change, budget.transfers);
    budget.transfers -= fromTransfers;
    budget.wages -= change - fromTransfers;
    budget.total -= change;
    changeTrust(state, OWNER.lowerTrust);
    lines = ['……わかりました。', `目標は${goalLabel(next)}にします。そのかわり、予算は${yenText(change)}減らします。`];
  } else {
    const next = POSITION_GOALS[index - 1];
    if (next === undefined) return { ok: false, lines: ['優勝より上の目標はありませんよ。'] };
    goals.position = next;
    budget.total += change;
    budget.transfers += change;
    lines = ['頼もしいですね。', `目標は${goalLabel(next)}にしましょう。予算を${yenText(change)}増やして、移籍予算に足しておきます。`];
  }
  goals.negotiated = true;
  addMessage(state, {
    category: 'club', from: 'オーナー', important: false,
    subject: `今シーズンの目標を${goalLabel(goals.position)}にしました`,
    body: `話し合いで、今シーズンの順位の目標を${goalLabel(goals.position)}にしました（最初は${goalLabel(goals.basePosition)}）。\n`
      + `総予算 ${yenText(budget.total)}（年俸予算 ${yenText(budget.wages)}、移籍予算 ${yenText(budget.transfers)}）`,
  });
  return { ok: true, lines };
}

// ---- 信頼度 ----

function changeTrust(state: GameState, delta: number): void {
  const owner = state.owner;
  const scale = delta < 0 ? OWNER.downScale[owner.strictness] : 1;
  owner.trust = round1(clamp(owner.trust + delta * scale, 0, 100));
}

const thresholds = (state: GameState) => OWNER.thresholds[state.owner.strictness];

/** 前の月の成績とお金で、信頼度を上下させる（毎月1日） */
function monthlyTrust(state: GameState, month: string): void {
  const club = myClub(state);
  if (!club) return;
  const fin = club.finance;
  const owner = state.owner;
  const myId = club.id;
  const played = state.fixtures.filter((f) => f.result && f.date.startsWith(month) && (f.homeId === myId || f.awayId === myId));
  let delta = 0;
  // 成績：5試合以上たってから。目標の順位との差と、その月の勝ち点
  const totalPlayed = state.fixtures.filter((f) => f.result && (f.homeId === myId || f.awayId === myId)).length;
  if (played.length > 0 && totalPlayed >= 5) {
    const row = standingsOf(state).find((r) => r.clubId === myId);
    if (row) {
      delta += clamp(-(row.position - owner.goals.position) * OWNER.perPlace, ...OWNER.placeRange);
      if (inDanger(row.position, owner.goals.position)) delta += OWNER.dangerPenalty;
      if (row.position === Object.keys(state.clubs).length) delta += OWNER.bottomPenalty;
    }
    const points = played.reduce((n, f) => {
      const own = f.homeId === myId ? f.result?.homeGoals ?? 0 : f.result?.awayGoals ?? 0;
      const other = f.homeId === myId ? f.result?.awayGoals ?? 0 : f.result?.homeGoals ?? 0;
      return n + (own > other ? 3 : own === other ? 1 : 0);
    }, 0);
    const expected = OWNER.expectedPoints[owner.goals.position] ?? 1.4;
    delta += clamp((points / played.length - expected) * OWNER.pointsWeight, ...OWNER.pointsRange);
  }
  // お金
  const record = fin.months.find((m) => m.month === month);
  if ((record?.ledger.financing.owner ?? 0) > 0) delta += OWNER.ownerFunding;
  if (fin.loans.some((l) => l.emergency && l.startMonth === month)) delta += OWNER.emergencyLoan;
  if (debtOf(fin) > FINANCE.loanLimit[club.size] * OWNER.heavyDebtRatio) delta += OWNER.heavyDebt;
  if (delta !== 0) changeTrust(state, delta);
  owner.trustHistory.push({ date: addDays(state.date, -1), trust: owner.trust });
  if (owner.trustHistory.length > 400) owner.trustHistory.shift();
  checkWarnings(state);
}

function standingText(state: GameState): string {
  const row = standingsOf(state).find((r) => r.clubId === state.manager.clubId);
  return row && row.played > 0 ? `今は${row.position}位です。` : '';
}

/** 信頼度がしきい値を下回ったら、警告か解任 */
function checkWarnings(state: GameState): void {
  const owner = state.owner;
  const t = thresholds(state);
  if (owner.trust < t.dismiss && seasonPlaying(state) && state.season.round > OWNER.dismissFromRound) {
    dismiss(state, [`今シーズンの目標は${goalLabel(owner.goals.position)}でしたが、${standingText(state)}`, '成績が上向く兆しも見えません。']);
    return;
  }
  const level = owner.trust < t.warn[1] ? 2 : owner.trust < t.warn[0] ? 1 : 0;
  if (level <= owner.warned) return;
  owner.warned = level;
  const goal = goalLabel(owner.goals.position);
  const money = financeGoalStatus(state);
  const lines = level === 1
    ? [
      `${state.manager.name}監督、少しお話があります。`,
      seasonPlaying(state) ? `今シーズンの目標は${goal}ですが、${standingText(state)}` : 'クラブの状況が、思わしくありません。',
      money.met === false ? 'お金の面でも、心配が続いています。' : '',
      '正直に言って、今の状況には満足していません。',
      'このまま変わらないようなら、考えなければならないことがあります。',
    ]
    : [
      '監督、これが最後の話になるかもしれません。',
      seasonPlaying(state) ? `目標の${goal}には、まだ遠く及びません。${standingText(state)}` : 'クラブの状況は、悪くなる一方です。',
      '次に結果が出なければ、あなたを解任せざるを得ません。',
    ];
  addMessage(state, {
    category: 'club', from: 'オーナー', important: true, topic: 'ownerWarning',
    subject: level === 1 ? 'オーナーからの警告' : 'オーナーからの最後の警告',
    lines: lines.filter((l) => l !== ''),
    body: [...lines.filter((l) => l !== ''), '', `オーナーの信頼度：${Math.round(owner.trust)}（${trustLabel(owner.trust)}）`].join('\n'),
  });
}

function dismiss(state: GameState, reasons: string[]): void {
  const owner = state.owner;
  owner.dismissed = { date: state.date, reason: reasons.join('') };
  const lines = ['監督、今日は大事な話があります。', ...reasons, '本日をもって、監督を退いていただきます。', 'これまで、ありがとうございました。'];
  addMessage(state, {
    category: 'club', from: 'オーナー', important: true, topic: 'dismissal',
    subject: '監督を解任されました',
    lines,
    body: [...lines, '', `オーナーの信頼度：${Math.round(owner.trust)}`, '（他クラブからのオファーで監督を続ける機能は、フェーズ3-Cで加わります）'].join('\n'),
  });
}

/** 終わったシーズンを、順位と財務の目標で評価する（1月1日、年度を締めた後） */
function evaluateSeason(state: GameState, year: number): SeasonEvaluation | null {
  const club = myClub(state);
  const owner = state.owner;
  const goals = owner.goals;
  if (!club || goals.year !== year) return null;
  const row = state.history.find((h) => h.year === year)?.table.find((r) => r.clubId === club.id);
  if (!row) return null;
  const diff = row.position - goals.position;
  const verdict: SeasonVerdict = inDanger(row.position, goals.position) ? 'farMissed'
    : diff <= -3 ? 'exceeded' : diff <= 0 ? 'met' : diff <= 3 ? 'near' : diff <= 6 ? 'missed' : 'farMissed';
  const fin = club.finance;
  const ledger = fin.history.find((h) => h.year === year)?.ledger;
  const debt = debtOf(fin);
  const financeMet = goals.finance === 'noDeficit' ? !ledger || netResult(ledger) >= 0
    : goals.finance === 'wagesWithinBudget' ? payrollOf(state, club.id) <= fin.budget.wages
      : debt < goals.debtAtStart || debt === 0;
  const before = owner.trust;
  changeTrust(state, OWNER.verdict[verdict] + (financeMet ? OWNER.financeGoal.met : OWNER.financeGoal.missed));
  const evaluation: SeasonEvaluation = {
    year, goal: goals.position, position: row.position, verdict, finance: goals.finance, financeMet, trustBefore: before, trustAfter: owner.trust,
  };
  owner.evaluations.push(evaluation);
  owner.trustHistory.push({ date: state.date, trust: owner.trust });
  owner.warned = 0;
  const t = thresholds(state);
  if ((verdict === 'farMissed' && owner.trust < t.seasonDismiss) || owner.trust < t.dismiss) {
    dismiss(state, [
      `昨シーズンの目標は${goalLabel(goals.position)}でしたが、結果は${row.position}位でした。`,
      verdict === 'farMissed' ? '目標を大きく下回り、立て直せる見込みも持てません。' : 'クラブとして、これ以上は待てません。',
    ]);
  }
  return evaluation;
}

/** 新しいシーズンの目標と予算の話（会話で開く知らせ） */
function yearTalk(state: GameState, start: YearStart, evaluation: SeasonEvaluation | null): void {
  const club = myClub(state);
  if (!club) return;
  const goals = state.owner.goals;
  const year = goals.year;
  const evaluationLines = evaluation
    ? [
      `まず、昨シーズンの評価です。目標は${goalLabel(evaluation.goal)}でしたが、結果は${evaluation.position}位でした。`,
      VERDICT_COMMENT[evaluation.verdict],
      `財務の目標（${FINANCE_GOAL_LABEL[evaluation.finance]}）は、${evaluation.financeMet ? '達成できました' : '達成できませんでした'}。`,
    ]
    : [];
  const goalLine = `今シーズンの目標は、${goalLabel(goals.position)}です。財務では「${FINANCE_GOAL_LABEL[goals.finance]}」をお願いします。`;
  addMessage(state, {
    category: 'club', from: 'オーナー', important: true, topic: 'budget',
    subject: `${year}年の目標と予算`,
    lines: [
      evaluation ? `${state.manager.name}監督、${year}年の話をしましょう。` : `${state.manager.name}監督、ようこそ。今シーズンの目標と予算の話をさせてください。`,
      ...evaluationLines,
      goalLine,
      ...budgetLines(state, club),
      '目標について意見があれば、開幕までに聞きましょう。',
    ],
    body: [
      `今シーズンの目標：${goalLabel(goals.position)}　財務の目標：${FINANCE_GOAL_LABEL[goals.finance]}`,
      evaluation ? `昨シーズンの評価：${VERDICT_LABEL[evaluation.verdict]}（目標 ${goalLabel(evaluation.goal)}、結果 ${evaluation.position}位）。財務の目標は${evaluation.financeMet ? '達成' : '未達'}。` : '',
      `オーナーの信頼度：${Math.round(state.owner.trust)}（${trustLabel(state.owner.trust)}）`,
      '目標は、開幕までに1回だけ話し合えます（下げると予算が減り、上げると予算が増える）。',
      '',
      ...budgetReport(state, club, year, start),
    ].filter((l, i) => l !== '' || i > 0).join('\n'),
  });
}

// ---- 日付が変わったとき ----

/** advanceDay が、シーズンの出来事の前に呼ぶ（お金の締めの後）：毎月の信頼度と、1月1日のシーズンの評価 */
export function ownerBeforeEvents(state: GameState): void {
  if (!state.owner || isDismissed(state) || !state.date.endsWith('-01')) return;
  const month = addMonths(state.date.slice(0, 7), -1);
  monthlyTrust(state, month);
  if (monthDay(state.date) === '01-01' && !isDismissed(state)) evaluateSeason(state, yearOf(month));
}

/** advanceDay が、新しい年度の予算を決めた後に呼ぶ：新しい目標と、オーナーとの話 */
export function ownerAfterEvents(state: GameState, start: YearStart | null): void {
  if (!start || !state.owner || isDismissed(state)) return;
  const year = yearOf(state.date);
  const evaluation = state.owner.evaluations.find((e) => e.year === year - 1) ?? null;
  state.owner.goals = newGoals(state, year);
  yearTalk(state, start, evaluation);
}

/** 新しいゲーム：オーナーを用意して、最初の話（目標と予算）をする */
export function startOwner(state: GameState, strictness: OwnerStrictness = 'normal'): void {
  state.owner = initialOwner(state, strictness);
  yearTalk(state, firstYearStart(state), null);
}
