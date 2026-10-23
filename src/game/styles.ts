// 戦い方：現実の戦術の名前が付いた、チーム指示のまとまり（要件定義書「画面の作り直し（1.1）」の「戦い方」）。
// 選ぶとチーム指示6つが決まり、合うフォーメーションと役割を「おすすめ」として出す。
// 今の先発の能力から合い具合（★1〜3）を出し、次の相手の戦い方からコーチのおすすめを決める。
// 指示の値と強い相手・弱い相手は、戦い方どうしを総当たりで回して決めた（npm run styles）。

import { FORMATIONS } from '../engine/formations';
import { roleForSlot, ROLE_OPTIONS } from '../engine/roles';
import type { AttributeKey, FormationName, Position, Role, Tactics, TeamInstructions } from '../engine/types';
import { instructionDistance } from './progress';
import { clubStrength } from './transfers';
import type { GameState, PlayerRecord } from './types';

export type StyleId =
  | 'balanced' | 'tikiTaka' | 'positional' | 'wingPlay' | 'totalFootball'
  | 'gegenpress' | 'counter' | 'catenaccio' | 'kickAndRush';

type Group = 'GK' | 'DF' | 'MF' | 'FW' | 'wide';

export interface PlayStyle {
  id: StyleId;
  name: string;
  /** ひとこと説明 */
  summary: string;
  /** 強い相手・弱い相手 */
  strong: string;
  weak: string;
  instructions: TeamInstructions;
  /** 合うフォーメーション（先頭ほど合う） */
  formations: FormationName[];
  /** ポジションごとの合う役割（同じポジションが2つあれば順に使う） */
  roles: Partial<Record<Position, Role[]>>;
  /** 合い具合を見る能力と、見る選手のグループ */
  keys: { attribute: AttributeKey; groups: Group[] }[];
}

const ALL: Group[] = ['DF', 'MF', 'FW', 'wide'];
const ins = (mentality: number, defensiveLine: number, pressing: number, width: number, passingLength: number, tempo: number): TeamInstructions =>
  ({ mentality, defensiveLine, pressing, width, passingLength, tempo });

export const STYLES: PlayStyle[] = [
  {
    id: 'balanced', name: 'バランス', summary: 'どれも標準。大きな弱みがない',
    strong: '迷ったらこれ', weak: '尖った強みもない',
    instructions: ins(0, 0, 0, 0, 0, 0), formations: ['4-4-2', '4-2-3-1', '4-3-3'], roles: {}, keys: [],
  },
  {
    id: 'tikiTaka', name: 'ティキ・タカ', summary: '短いパスをつないでボールを持ち続ける',
    strong: '前に出てくる相手', weak: '速いカウンター',
    instructions: ins(1, 1, 1, 0, -2, -1), formations: ['4-3-3', '4-1-4-1'],
    roles: { GK: ['sweeperKeeper'], CB: ['ballPlayingDefender'], DM: ['playmaker'], CM: ['playmaker', 'mezzala'], AM: ['advancedPlaymaker'], FW: ['falseNine'], W: ['insideForward'] },
    keys: [{ attribute: 'passing', groups: ALL }, { attribute: 'firstTouch', groups: ALL }, { attribute: 'composure', groups: ALL }, { attribute: 'vision', groups: ['MF', 'FW'] }],
  },
  {
    id: 'positional', name: 'ポジショナルプレー', summary: '幅と位置取りで数的優位を作る',
    strong: '引いて守る相手', weak: '前から奪いに来る相手',
    instructions: ins(1, 0, 1, 2, -1, 0), formations: ['4-3-3', '3-4-2-1'],
    roles: { CB: ['ballPlayingDefender'], SB: ['invertedFullback'], DM: ['anchor'], CM: ['mezzala', 'playmaker'], W: ['winger'] },
    keys: [{ attribute: 'passing', groups: ALL }, { attribute: 'decisions', groups: ALL }, { attribute: 'positioning', groups: ALL }, { attribute: 'vision', groups: ['MF'] }],
  },
  {
    id: 'wingPlay', name: 'ウイングプレー', summary: 'サイドを広く使い、クロスから点を取る',
    strong: '中を固める相手', weak: '前から奪いに来る相手',
    instructions: ins(1, 0, 0, 2, 1, 0), formations: ['4-4-2', '4-3-3'],
    roles: { SB: ['attackingFullback'], WB: ['wingBack'], WM: ['winger'], W: ['winger'], FW: ['targetMan', 'poacher'] },
    keys: [{ attribute: 'crossing', groups: ['wide'] }, { attribute: 'pace', groups: ['wide'] }, { attribute: 'dribbling', groups: ['wide'] }, { attribute: 'heading', groups: ['FW'] }],
  },
  {
    id: 'totalFootball', name: 'トータルフットボール', summary: '全員で攻め、全員で守る',
    strong: '引いて守る相手', weak: 'ボールを持つ相手',
    instructions: ins(1, 1, 1, 1, 0, 0), formations: ['4-3-3', '3-4-2-1'],
    roles: { GK: ['sweeperKeeper'], CB: ['ballPlayingDefender'], SB: ['attackingFullback'], CM: ['boxToBox'], FW: ['falseNine'] },
    keys: [{ attribute: 'stamina', groups: ALL }, { attribute: 'workRate', groups: ALL }, { attribute: 'passing', groups: ALL }, { attribute: 'decisions', groups: ALL }],
  },
  {
    id: 'gegenpress', name: 'ゲーゲンプレス', summary: '奪われたらすぐ囲んで奪い返す',
    strong: '後ろからつなぐ相手', weak: '裏を取られやすい。疲れやすい',
    instructions: ins(1, 1, 2, 0, 0, 1), formations: ['4-3-3', '4-2-3-1'],
    roles: { GK: ['sweeperKeeper'], DM: ['volante'], CM: ['boxToBox'], W: ['insideForward'], FW: ['runner'] },
    keys: [{ attribute: 'stamina', groups: ALL }, { attribute: 'workRate', groups: ALL }, { attribute: 'acceleration', groups: ALL }, { attribute: 'tackling', groups: ['MF', 'FW', 'wide'] }],
  },
  {
    id: 'counter', name: 'カウンターアタック', summary: '自陣で待ち構え、奪ったら速く前へ',
    strong: 'ラインの高い相手', weak: '引いて守る相手',
    instructions: ins(-2, -1, 0, 0, 1, 1), formations: ['4-4-2', '4-2-3-1', '3-5-2'],
    roles: { CB: ['coverDefender'], SB: ['defensiveFullback'], DM: ['anchor'], CM: ['boxToBox'], W: ['winger'], WM: ['winger'], FW: ['runner', 'poacher'] },
    keys: [{ attribute: 'pace', groups: ['FW', 'wide'] }, { attribute: 'acceleration', groups: ['FW', 'wide'] }, { attribute: 'positioning', groups: ['DF'] }, { attribute: 'concentration', groups: ['DF'] }],
  },
  {
    id: 'catenaccio', name: 'カテナチオ', summary: 'ゴール前を固め、少ない点差で勝ち切る',
    strong: 'カウンターの相手、リードを守るとき', weak: '点を取りにくい',
    instructions: ins(-2, -1, 0, -1, 1, 0), formations: ['3-5-2', '4-1-4-1'],
    roles: { CB: ['coverDefender', 'stopper'], SB: ['defensiveFullback'], WB: ['defensiveFullback'], DM: ['anchor'], CM: ['anchor', 'boxToBox'], FW: ['targetMan', 'poacher'] },
    keys: [{ attribute: 'positioning', groups: ['DF', 'MF'] }, { attribute: 'tackling', groups: ['DF', 'MF'] }, { attribute: 'concentration', groups: ['DF'] }, { attribute: 'heading', groups: ['DF'] }],
  },
  {
    id: 'kickAndRush', name: 'キック・アンド・ラッシュ', summary: '長いボールを前線に蹴り、競り合いとこぼれ球で攻める',
    strong: '前から寄せてくる相手', weak: 'ボールを持つ相手',
    instructions: ins(1, 0, 0, 0, 2, 1), formations: ['4-4-2', '3-5-2'],
    roles: { CB: ['stopper'], CM: ['boxToBox'], W: ['winger'], WM: ['wideMidfielder'], FW: ['targetMan', 'poacher'] },
    keys: [{ attribute: 'heading', groups: ['FW'] }, { attribute: 'strength', groups: ['FW'] }, { attribute: 'jumping', groups: ['FW'] }, { attribute: 'stamina', groups: ALL }],
  },
];

export const STYLE_BY_ID: Record<StyleId, PlayStyle> = Object.fromEntries(STYLES.map((s) => [s.id, s])) as Record<StyleId, PlayStyle>;

/** 今の指示にいちばん近い戦い方。どれからも離れていれば null（自分の指示） */
export function nearestStyle(instructions: TeamInstructions): PlayStyle | null {
  let best: PlayStyle | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const style of STYLES) {
    const d = instructionDistance(style.instructions, instructions);
    if (d < bestDistance) {
      best = style;
      bestDistance = d;
    }
  }
  return bestDistance <= 2 ? best : null;
}

/**
 * 戦い方に合うフォーメーション。今の形が合う形のうちに入っていれば、そのまま。
 * 入っていなければ、合う形のうち熟成度がいちばん高い形（同じなら先に並んでいる形）
 */
export function styleFormation(style: PlayStyle, current: FormationName, familiarity: Partial<Record<FormationName, number>> = {}): FormationName {
  if (style.formations.includes(current)) return current;
  const best = [...style.formations].sort((a, b) => (familiarity[b] ?? 0) - (familiarity[a] ?? 0))[0];
  return best ?? current;
}

/** 戦い方に合う役割（枠ごと）。決めていないポジションは今の役割のまま */
export function styleRoles(style: PlayStyle, formation: FormationName, current: Tactics): Role[] {
  const used = new Map<Position, number>();
  return FORMATIONS[formation].map((slot, i) => {
    const options = style.roles[slot.position];
    const n = used.get(slot.position) ?? 0;
    used.set(slot.position, n + 1);
    const wanted = options?.[n % options.length];
    if (wanted && ROLE_OPTIONS[slot.position].includes(wanted)) return wanted;
    return formation === current.formation ? roleForSlot(current, i, slot.position) : roleForSlot({ ...current, formation, roles: [] }, i, slot.position);
  });
}

const groupOf = (position: Position): Group[] => {
  if (position === 'GK') return ['GK'];
  if (position === 'CB') return ['DF'];
  if (position === 'SB' || position === 'WB') return ['DF', 'wide'];
  if (position === 'WM') return ['MF', 'wide'];
  if (position === 'W') return ['FW', 'wide'];
  if (position === 'FW') return ['FW'];
  return ['MF'];
};

const OUTFIELD: AttributeKey[] = [
  'shooting', 'passing', 'dribbling', 'crossing', 'firstTouch', 'tackling', 'heading', 'decisions', 'vision', 'positioning',
  'offTheBall', 'concentration', 'workRate', 'composure', 'pace', 'acceleration', 'stamina', 'strength', 'jumping',
];

export interface StyleFit {
  /** 1〜3 */
  stars: 1 | 2 | 3;
  /** いちばん足りない能力（★3のときは null） */
  weakest: AttributeKey | null;
  /** いちばん生きる能力 */
  strongest: AttributeKey | null;
}

/**
 * 今の先発と戦い方の合い具合。戦い方で大事な能力が、その選手たちのふだんの能力（平均）よりどれだけ高いかで決める
 * （チームの力そのものではなく、向き不向きを見る）
 */
export function styleFit(lineup: readonly (PlayerRecord | undefined)[], style: PlayStyle, slotPositions: readonly Position[]): StyleFit {
  if (style.keys.length === 0) return { stars: 3, weakest: null, strongest: null };
  const ratios: { key: AttributeKey; ratio: number }[] = [];
  for (const { attribute, groups } of style.keys) {
    let sum = 0;
    let base = 0;
    lineup.forEach((p, i) => {
      const position = slotPositions[i];
      if (!p || !position || !groupOf(position).some((g) => groups.includes(g))) return;
      sum += p.attributes[attribute];
      base += OUTFIELD.reduce((n, k) => n + p.attributes[k], 0) / OUTFIELD.length;
    });
    if (base > 0) ratios.push({ key: attribute, ratio: sum / base });
  }
  if (ratios.length === 0) return { stars: 2, weakest: null, strongest: null };
  const average = ratios.reduce((n, r) => n + r.ratio, 0) / ratios.length;
  const sorted = [...ratios].sort((a, b) => a.ratio - b.ratio);
  const stars: 1 | 2 | 3 = average >= 1.06 ? 3 : average >= 0.96 ? 2 : 1;
  return { stars, weakest: stars === 3 ? null : sorted[0]?.key ?? null, strongest: sorted.at(-1)?.key ?? null };
}

/** 先発と枠のポジション（クラブの今の形とメンバー） */
export function lineupOf(state: GameState, clubId: string): { players: (PlayerRecord | undefined)[]; positions: Position[] } {
  const club = state.clubs[clubId];
  if (!club) return { players: [], positions: [] };
  const positions = FORMATIONS[club.tactics.formation].map((s) => s.position);
  const ids = club.selection?.lineup ?? [];
  return { players: positions.map((_, i) => state.players[ids[i] ?? '']), positions };
}

export interface StyleAdvice {
  style: PlayStyle;
  formation: FormationName;
  reason: string;
}

/**
 * 次の相手に合わせたおすすめ（コーチの提案）。相手の戦い方と力の差から選び、迷ったら今の選手に合う戦い方にする。
 * 相性は、試合エンジンの戦術の相性の検証（ラインの高い相手にはカウンターが効く、など）に合わせている
 */
export function recommendStyle(state: GameState, myId: string, opponentId: string): StyleAdvice {
  const me = state.clubs[myId];
  const opponent = state.clubs[opponentId];
  const current = me?.tactics.formation ?? '4-4-2';
  const { players, positions } = lineupOf(state, myId);
  const fit = (s: PlayStyle) => styleFit(players, s, positions).stars;
  // 合う形に慣れていなければ（今の形より熟成度が20以上低い）、形は今のままにする
  const familiarity = me?.familiarity.formations ?? {};
  const advice = (id: StyleId, reason: string): StyleAdvice => {
    const style = STYLE_BY_ID[id];
    const formation = styleFormation(style, current, familiarity);
    const keep = (familiarity[formation] ?? 0) < (familiarity[current] ?? 0) - 20;
    return { style, formation: keep ? current : formation, reason };
  };
  if (!me || !opponent) return advice('balanced', '相手のことが分からないので、標準の形で臨みます。');
  const theirs = opponent.tactics.instructions;
  const gap = clubStrength(state, opponentId) - clubStrength(state, myId);
  const better = (a: StyleId, b: StyleId): StyleId => (fit(STYLE_BY_ID[b]) > fit(STYLE_BY_ID[a]) ? b : a);
  if (gap > 0.8) return advice(better('counter', 'catenaccio'), `${opponent.name}は力が上です。守りを固めて、奪ったら速く攻めるのが良さそうです。`);
  if (theirs.defensiveLine >= 1) return advice('counter', `${opponent.name}はラインが高いので、裏を狙うカウンターが効きそうです。`);
  if (theirs.pressing >= 2) return advice('kickAndRush', `${opponent.name}は前から強く寄せてきます。長いボールでプレスをかわしましょう。`);
  if (theirs.mentality <= -1 && theirs.defensiveLine <= -1) {
    return advice(better('positional', 'wingPlay'), `${opponent.name}は引いて守ります。幅を使って崩しましょう。`);
  }
  if (theirs.passingLength <= -1) return advice('gegenpress', `${opponent.name}は後ろから短くつなぎます。前から奪いに行くと効きそうです。`);
  if (gap < -0.8) return advice(better('tikiTaka', 'totalFootball'), `${opponent.name}より力が上です。ボールを持って押し込みましょう。`);
  const best = [...STYLES].sort((a, b) => fit(b) - fit(a))[0] ?? STYLE_BY_ID.balanced;
  return advice(best.id, `力は互角です。今の選手に一番合う${best.name}で臨みましょう。`);
}
