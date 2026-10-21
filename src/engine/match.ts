// 試合エンジン（ゾーン方式）。要件定義書「試合エンジン」「戦術と観戦」の章に対応する。
//
// ピッチを縦6×横5の30マスに分け、ボールを持った選手のプレーを一手ずつ計算する。
// マスの番号は「ホームが攻める向き」で数える（行0 = ホームのゴール側、行5 = アウェイのゴール側）。
// 計算の中では、攻めている側から見た向き（行5 = 相手ゴール前）に直して考える。
//
// LiveMatch は少しずつ進められるので、観戦画面で止めて交代や戦術の変更ができる。
// AIが采配する側は、決まった時間に交代や戦術の変更を自分で行う。

import { commentary, type CommentaryKey, type CommentaryNames } from './commentary';
import { ENGINE_CONFIG as C } from './config';
import { FORMATIONS, shapePoint, type Slot } from './formations';
import { positionFit, positionRating } from './ratings';
import { createRng, type Rng } from './rng';
import { ROLE_OPTIONS, ROLE_PROFILES, roleForSlot, type RoleProfile } from './roles';
import type {
  AttributeKey, FormationName, MatchEvent, MatchEventType, MatchPlayerLine, MatchReadiness, MatchResult, Player,
  PlayerMatchStats, Position, Role, Side, Tactics, Team, TeamInstructions, TeamStats,
} from './types';

const ROWS = 6;
const COLS = 5;
const ZONES = ROWS * COLS;
const HALF = 45 * 60;

/** 交代のルール（要件定義書：5人まで、交代できる回数は3回まで。ハーフタイムの交代は回数に数えない） */
export const SUBSTITUTION_RULES = { maxSubs: 5, maxWindows: 3 } as const;

export interface MatchOptions {
  seed: number;
  /** false にすると細かい実況（重要度1）を作らない。大量に試合を回すとき用。 */
  detailedCommentary?: boolean;
  /** AIが交代と戦術の変更を行う側。省略すると両チームともAI。 */
  aiControl?: [boolean, boolean];
  /** ダービーなどの重要な試合。勝負強さ（隠れ能力）が出来に影響する。 */
  important?: boolean;
}

/** 互換のための別名 */
export type SimulateOptions = MatchOptions;

export type MatchPhase = 'firstHalf' | 'halftime' | 'secondHalf' | 'finished';

export interface ChangeResult {
  ok: boolean;
  message?: string;
}

export interface TacticsChange {
  formation?: FormationName;
  instructions?: TeamInstructions;
  /** 枠ごとの役割 */
  roles?: Role[];
  /** 枠の順に並べたピッチ上の選手ID（11人、退場者を含む）。省略すると自動で割り当てる。 */
  order?: string[];
}

export interface LivePlayer {
  player: Player;
  position: Position;
  role: Role;
  stamina: number;
  sentOff: boolean;
  injured: boolean;
  stats: PlayerMatchStats;
}

export interface LiveSideSnapshot {
  team: Team;
  tactics: Tactics;
  /** 枠の順 */
  onPitch: LivePlayer[];
  bench: { player: Player; used: boolean }[];
  subsUsed: number;
  windowsUsed: number;
  stats: TeamStats;
}

export interface LiveSnapshot {
  clock: number;
  minute: string;
  phase: MatchPhase;
  score: [number, number];
  sides: [LiveSideSnapshot, LiveSideSnapshot];
}

export function simulateMatch(home: Team, away: Team, options: MatchOptions): MatchResult {
  return new LiveMatch(home, away, options).playToEnd();
}

interface OnPitch {
  player: Player;
  position: Position;
  slot: Slot;
  role: Role;
  profile: RoleProfile;
  /** 本来のポジションとの適性（1 = 本来のポジション） */
  fit: number;
  /** 0〜100 */
  stamina: number;
  /** その日の出来（1.0 が普段どおり） */
  form: number;
  /** 蓄積疲労による能力の倍率 */
  fatigueFactor: number;
  /** 戦術の熟成度（0〜1） */
  familiarity: number;
  /** ケガのしやすさの倍率（隠れ能力、蓄積疲労、完治前の出場） */
  injuryRisk: number;
  injured: boolean;
  sentOff: boolean;
  started: boolean;
  /** 結果に並べる順（先発は枠の順、途中出場は出た順） */
  order: number;
  minuteOn: number | null;
  minuteOff: number | null;
  stats: PlayerMatchStats;
}

interface SideState {
  team: Team;
  tactics: Tactics;
  ins: TeamInstructions;
  /** 試合開始時のチーム指示（AIが戻すときの基準） */
  baseIns: TeamInstructions;
  /** 枠の順 */
  players: OnPitch[];
  bench: { player: Player; used: boolean }[];
  /** 途中で退いた選手 */
  subbedOff: OnPitch[];
  subsUsed: number;
  windowsUsed: number;
  lastSubClock: number | null;
  ai: boolean;
  aiDone: Set<string>;
  /** [選手][マス] 攻撃時にその選手がマスに与える影響（0〜1） */
  attackInfluence: number[][];
  /** [選手][マス] 守備時にその選手がマスに与える影響（0〜1） */
  defendInfluence: number[][];
  /** 攻撃時にその選手がいるマス */
  attackZone: number[];
  stats: TeamStats;
}

/** 攻めている側から見たマスの位置。r = 5 が相手ゴール前、c = 2 が中央。 */
interface Frame {
  r: number;
  c: number;
}

type Action = 'pass' | 'dribble' | 'shoot' | 'cross' | 'clear';
type ShotKind = 'open' | 'header' | 'freeKick';

/** ポジションごとの、シュートとドリブルの選びやすさ */
const SHOOT_TENDENCY: Record<Position, number> = {
  GK: 0, CB: 0.4, SB: 0.5, DM: 0.6, CM: 0.8, AM: 1.1, WM: 0.9, W: 1.1, FW: 1.4,
};
const DRIBBLE_TENDENCY: Record<Position, number> = {
  GK: 0, CB: 0.3, SB: 0.8, DM: 0.5, CM: 0.8, AM: 1.3, WM: 1.1, W: 1.6, FW: 1.0,
};

/** AIの交代のタイミング（分）と、そのときに代える最大人数 */
const AI_SUB_CHECKPOINTS: { minute: number; count: number }[] = [
  { minute: 60, count: 2 }, { minute: 70, count: 2 }, { minute: 80, count: 1 },
];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const other = (side: Side): Side => (side === 0 ? 1 : 0);

const EVENT_TYPE: Record<CommentaryKey, MatchEventType> = {
  kickoff: 'kickoff', secondHalf: 'kickoff', halftime: 'halftime', fulltime: 'fulltime',
  goal: 'goal', headerGoal: 'goal', freeKickGoal: 'goal', penaltyGoal: 'penaltyGoal',
  shotSaved: 'shotSaved', headerSaved: 'shotSaved', shotOff: 'shotOff', headerOff: 'shotOff',
  shotBlocked: 'shotBlocked', penalty: 'penalty', penaltyMissed: 'penaltyMissed', penaltyWide: 'penaltyMissed',
  corner: 'corner', freeKick: 'freeKick', foul: 'foul', yellowCard: 'yellowCard',
  secondYellow: 'redCard', redCard: 'redCard', offside: 'offside',
  substitution: 'substitution', tacticsAttack: 'tactics', tacticsDefend: 'tactics', tacticsChange: 'tactics', injury: 'injury',
  throughBall: 'buildUp', breakaway: 'buildUp', dribble: 'buildUp', tackle: 'buildUp', interception: 'buildUp', cross: 'buildUp',
};

function emptyPlayerStats(): PlayerMatchStats {
  return {
    rating: 6.3, passes: 0, passesCompleted: 0, keyPasses: 0, dribbles: 0, dribblesWon: 0,
    shots: 0, shotsOnTarget: 0, goals: 0, assists: 0, tackles: 0, interceptions: 0,
    fouls: 0, yellowCards: 0, redCards: 0, saves: 0,
  };
}

function emptyTeamStats(): TeamStats {
  return {
    goals: 0, shots: 0, shotsOnTarget: 0, xg: 0, possessionSeconds: 0, passes: 0,
    passesCompleted: 0, tackles: 0, interceptions: 0, highRecoveries: 0, fouls: 0,
    corners: 0, offsides: 0, yellowCards: 0, redCards: 0, staminaAtEnd: 100,
  };
}

export class LiveMatch {
  private readonly rng: Rng;
  private readonly seed: number;
  private readonly detailed: boolean;
  private readonly important: boolean;
  private readonly sides: [SideState, SideState];
  private readonly eventList: MatchEvent[] = [];
  private readonly goals: [number, number] = [0, 0];
  private matchPhase: MatchPhase = 'firstHalf';
  private time = 0;
  private half: 1 | 2 = 1;
  private halfEnd = HALF;
  /** プレー以外で止まった時間（ファウル、ゴールなど） */
  private stoppage = 0;
  private finalResult: MatchResult | null = null;

  // ボールの状態
  private side: Side = 0;
  private holder = 0;
  private zone = 0;
  /** 直前にパス（やクロス）を出した選手。アシストとキーパスの記録に使う。 */
  private lastPasser: number | null = null;
  /** ボールを失った直後で、守備の形が整っていない時刻まで（その側が守るとき） */
  private readonly transitionUntil: [number, number] = [-1, -1];
  /** 直前に裏へのボールが通り、GKと1対1に近い形になっている */
  private breakaway = false;

  // 1手の間は守備の圧力を使い回すためのキャッシュ
  private stepId = 0;
  private readonly pressureCache: [Float64Array, Float64Array] = [new Float64Array(ZONES), new Float64Array(ZONES)];
  private readonly pressureStamp: [Int32Array, Int32Array] = [new Int32Array(ZONES).fill(-1), new Int32Array(ZONES).fill(-1)];
  private readonly defendScoreCache: [number[], number[]] = [[], []];
  private readonly defendScoreStamp: [number, number] = [-1, -1];
  private readonly pressingUnitCache: [number, number] = [1, 1];
  private readonly pressingUnitStamp: [number, number] = [-1, -1];

  constructor(home: Team, away: Team, options: MatchOptions) {
    this.seed = options.seed;
    this.detailed = options.detailedCommentary ?? true;
    this.important = options.important ?? false;
    this.rng = createRng(options.seed);
    const ai = options.aiControl ?? [true, true];
    this.sides = [this.createSide(home, 0, ai[0]), this.createSide(away, 1, ai[1])];
    this.kickoff(0, 'kickoff');
    this.halfEnd = HALF + this.rng.int(1, 4) * 60;
  }

  get phase(): MatchPhase {
    return this.matchPhase;
  }

  /** 試合開始からの秒数（後半は2700秒から数える） */
  get clock(): number {
    return this.time;
  }

  get score(): readonly [number, number] {
    return this.goals;
  }

  get events(): readonly MatchEvent[] {
    return this.eventList;
  }

  /** untilClock 秒まで進める。ハーフタイムか試合終了になったら、そこで止まる。 */
  advance(untilClock: number): void {
    if (this.matchPhase === 'halftime' || this.matchPhase === 'finished') return;
    while (this.time < untilClock) {
      this.aiTick();
      this.step();
      if (this.time < this.halfEnd) continue;
      if (this.half === 1) {
        this.say('halftime', null, 2, {});
        this.matchPhase = 'halftime';
      } else {
        this.say('fulltime', null, 2, {});
        this.matchPhase = 'finished';
        this.finalResult = this.finish();
      }
      return;
    }
  }

  /** ハーフタイムから後半を始める */
  startSecondHalf(): void {
    if (this.matchPhase !== 'halftime') return;
    this.matchPhase = 'secondHalf';
    this.half = 2;
    this.time = HALF;
    this.halfEnd = 2 * HALF + this.rng.int(2, 6) * 60;
    this.kickoff(1, 'secondHalf');
  }

  /** 最後まで進めて結果を返す */
  playToEnd(): MatchResult {
    while (this.matchPhase !== 'finished') {
      this.advance(Number.POSITIVE_INFINITY);
      if (this.matchPhase === 'halftime') this.startSecondHalf();
    }
    return this.result();
  }

  result(): MatchResult {
    if (!this.finalResult) throw new Error('試合はまだ終わっていません');
    return this.finalResult;
  }

  // ---- 采配 ----

  /** その側の交代と戦術の変更を、AIに任せるかどうか（「結果まで飛ばす」ときなど） */
  setAiControl(side: Side, ai: boolean): void {
    this.sides[side].ai = ai;
  }

  isAiControlled(side: Side): boolean {
    return this.sides[side].ai;
  }

  /** 選手交代。outId を下げて、控えの inId を入れる。 */
  substitute(side: Side, outId: string, inId: string): ChangeResult {
    if (this.matchPhase === 'finished') return { ok: false, message: '試合は終わっています' };
    const state = this.sides[side];
    if (state.subsUsed >= SUBSTITUTION_RULES.maxSubs) {
      return { ok: false, message: `交代枠（${SUBSTITUTION_RULES.maxSubs}人）を使い切っています` };
    }
    const index = state.players.findIndex((op) => op.player.id === outId);
    const outgoing = state.players[index];
    if (!outgoing) return { ok: false, message: '下げる選手がピッチにいません' };
    if (outgoing.sentOff) return { ok: false, message: '退場した選手は交代できません' };
    const benchEntry = state.bench.find((b) => b.player.id === inId);
    if (!benchEntry) return { ok: false, message: '入れる選手が控えにいません' };
    if (benchEntry.used) return { ok: false, message: 'その選手はすでに出場しています' };

    // ハーフタイム以外で、新しく試合を止めて交代するときは「交代の回数」を1回使う
    const newWindow = this.matchPhase !== 'halftime' && state.lastSubClock !== this.time;
    if (newWindow && state.windowsUsed >= SUBSTITUTION_RULES.maxWindows) {
      return { ok: false, message: `交代できる回数（${SUBSTITUTION_RULES.maxWindows}回）を使い切っています` };
    }
    if (newWindow) {
      state.windowsUsed++;
      state.lastSubClock = this.time;
    }

    const minute = this.currentMinute();
    outgoing.minuteOff = minute;
    state.subbedOff.push(outgoing);
    const incoming = this.createOnPitch(benchEntry.player, outgoing.slot, outgoing.role, false, state.team.readiness?.[inId]);
    incoming.minuteOn = minute;
    incoming.order = 100 + state.subsUsed;
    state.players[index] = incoming;
    benchEntry.used = true;
    state.subsUsed++;
    if (this.side === side && this.holder === index) this.lastPasser = null;
    this.say('substitution', side, 2, { team: state.team.name, p: incoming.player.name, q: outgoing.player.name });
    this.updateInfluence(state, side);
    this.stepId++;
    return { ok: true };
  }

  /** フォーメーション、チーム指示、役割、並びを変える */
  changeTactics(side: Side, change: TacticsChange, announce: CommentaryKey = 'tacticsChange'): ChangeResult {
    if (this.matchPhase === 'finished') return { ok: false, message: '試合は終わっています' };
    const state = this.sides[side];
    const formation = change.formation ?? state.tactics.formation;
    const slots = FORMATIONS[formation];

    if (change.formation !== undefined || change.order !== undefined) {
      const order = change.order ?? this.autoOrder(state.players, slots);
      const current = new Map(state.players.map((op) => [op.player.id, op]));
      if (order.length !== slots.length || new Set(order).size !== order.length || order.some((id) => !current.has(id))) {
        return { ok: false, message: 'ピッチにいる11人を、それぞれ1つの枠に入れてください' };
      }
      const holderId = this.side === side ? state.players[this.holder]?.player.id : undefined;
      state.players = order.map((id, i) => {
        const op = current.get(id) as OnPitch;
        const slot = slots[i] as Slot;
        op.slot = slot;
        op.position = slot.position;
        op.fit = positionFit(op.player.position, slot.position);
        return op;
      });
      if (holderId !== undefined) this.holder = Math.max(0, state.players.findIndex((op) => op.player.id === holderId));
      this.lastPasser = null;
    }

    const roles = state.players.map((op, i) => {
      const wanted = change.roles?.[i] ?? (change.formation === undefined ? op.role : undefined);
      return wanted && ROLE_OPTIONS[op.position].includes(wanted) ? wanted : roleForSlot({ ...state.tactics, roles: [] }, i, op.position);
    });
    state.players.forEach((op, i) => {
      op.role = roles[i] as Role;
      op.profile = ROLE_PROFILES[op.role];
    });
    if (change.instructions) state.ins = { ...change.instructions };
    state.tactics = { ...state.tactics, formation, instructions: state.ins, roles };
    this.say(announce, side, 2, { team: state.team.name });
    this.updateInfluence(state, side);
    this.stepId++;
    return { ok: true };
  }

  snapshot(): LiveSnapshot {
    const sideSnapshot = (state: SideState): LiveSideSnapshot => ({
      team: state.team,
      tactics: state.tactics,
      onPitch: state.players.map((op) => ({
        player: op.player, position: op.position, role: op.role, stamina: op.stamina,
        sentOff: op.sentOff, injured: op.injured, stats: { ...op.stats },
      })),
      bench: state.bench.map((b) => ({ ...b })),
      subsUsed: state.subsUsed,
      windowsUsed: state.windowsUsed,
      stats: { ...state.stats },
    });
    return {
      clock: this.time,
      minute: this.minuteLabel(),
      phase: this.matchPhase,
      score: [this.goals[0], this.goals[1]],
      sides: [sideSnapshot(this.sides[0]), sideSnapshot(this.sides[1])],
    };
  }

  // ---- 準備 ----

  private createSide(team: Team, side: Side, ai: boolean): SideState {
    const slots = FORMATIONS[team.tactics.formation];
    if (team.lineup.length !== slots.length) {
      throw new Error(`${team.name}: 先発は${slots.length}人必要です（今は${team.lineup.length}人）`);
    }
    const findPlayer = (id: string): Player => {
      const player = team.players.find((p) => p.id === id);
      if (!player) throw new Error(`${team.name}: 選手 ${id} が見つかりません`);
      return player;
    };
    const players = team.lineup.map((id, i): OnPitch => {
      const slot = slots[i] as Slot;
      const op = this.createOnPitch(findPlayer(id), slot, roleForSlot(team.tactics, i, slot.position), true, team.readiness?.[id]);
      op.order = i;
      return op;
    });
    const ins = { ...team.tactics.instructions };
    const state: SideState = {
      team,
      tactics: { ...team.tactics, roles: players.map((op) => op.role) },
      ins,
      baseIns: { ...ins },
      players,
      bench: (team.bench ?? []).filter((id) => !team.lineup.includes(id)).map((id) => ({ player: findPlayer(id), used: false })),
      subbedOff: [],
      subsUsed: 0,
      windowsUsed: 0,
      lastSubClock: null,
      ai,
      aiDone: new Set(),
      attackInfluence: [],
      defendInfluence: [],
      attackZone: [],
      stats: emptyTeamStats(),
    };
    this.updateInfluence(state, side);
    return state;
  }

  private createOnPitch(player: Player, slot: Slot, role: Role, started: boolean, readiness?: MatchReadiness): OnPitch {
    // 安定感が低いほど、その日の出来のブレが大きい。重要な試合では勝負強さが効く。モラルも出来に響く。
    const spread = 0.02 + 0.08 * (1 - player.hidden.consistency / 20);
    const bigMatch = this.important ? 1 + (player.hidden.bigMatch - 10) * 0.005 : 1;
    const morale = 1 + ((readiness?.morale ?? 60) - 60) * C.moralePerPoint;
    const fatigue = readiness?.fatigue ?? 0;
    return {
      player, position: slot.position, slot, role, profile: ROLE_PROFILES[role],
      fit: positionFit(player.position, slot.position), stamina: clamp(readiness?.condition ?? 100, 20, 100),
      form: clamp(this.rng.normal(1, spread), 0.8, 1.2) * bigMatch * morale,
      fatigueFactor: 1 - (Math.max(0, fatigue - C.fatigueThreshold) / (100 - C.fatigueThreshold)) * C.fatigueMaxPenalty,
      familiarity: clamp(readiness?.familiarity ?? 1, 0, 1),
      injuryRisk: (0.5 + player.hidden.injuryProneness / 20) * (0.75 + fatigue / 100)
        * (readiness?.carryingInjury ? C.injury.carryingMultiplier : 1),
      injured: false, sentOff: false,
      started, order: 0, minuteOn: null, minuteOff: null, stats: emptyPlayerStats(),
    };
  }

  /** 声かけなどで、選手のその日の出来を変える（delta は +0.03 なら3%良くなる）。note があれば実況に残す */
  boostForm(side: Side, deltas: Record<string, number>, note?: string): void {
    for (const op of this.sides[side].players) {
      const delta = deltas[op.player.id];
      if (delta !== undefined) op.form = clamp(op.form * (1 + delta), 0.75, 1.3);
    }
    if (note) this.pushEvent('teamTalk', side, 2, note);
    this.stepId++;
  }

  /** 新しいフォーメーションの枠に、ピッチ上の選手を適性の高い順に割り当てる */
  private autoOrder(players: OnPitch[], slots: Slot[]): string[] {
    const remaining = [...players];
    const order: (string | null)[] = slots.map(() => null);
    // GK→守備→前線の順に、空いている枠へ一番合う選手を入れる
    const slotOrder = slots.map((slot, i) => ({ slot, i }))
      .sort((a, b) => (a.slot.position === 'GK' ? -1 : 0) - (b.slot.position === 'GK' ? -1 : 0));
    for (const { slot, i } of slotOrder) {
      const candidates = remaining.filter((op) => !op.sentOff);
      if (candidates.length === 0) break;
      const best = candidates.reduce((a, b) =>
        positionRating(b.player, slot.position) > positionRating(a.player, slot.position) ? b : a);
      order[i] = best.player.id;
      remaining.splice(remaining.indexOf(best), 1);
    }
    // 退場者は残りの枠へ
    return order.map((id) => id ?? (remaining.shift() as OnPitch).player.id);
  }

  /** 立ち位置から、各選手が各マスに与える影響を計算し直す（開始時、交代、戦術変更、退場のとき） */
  private updateInfluence(state: SideState, side: Side): void {
    const toAbsolute = (p: { x: number; y: number }) => (side === 0 ? p : { x: 6 - p.x, y: 5 - p.y });
    const influenceRow = (p: { x: number; y: number }, out: boolean): number[] => {
      const row: number[] = [];
      for (let z = 0; z < ZONES; z++) {
        const dx = p.x - (Math.floor(z / COLS) + 0.5);
        const dy = p.y - ((z % COLS) + 0.5);
        row.push(out ? 0 : Math.max(0, 1 - Math.hypot(dx, dy) / C.influenceRadius));
      }
      return row;
    };
    state.attackInfluence = [];
    state.defendInfluence = [];
    state.attackZone = [];
    for (const op of state.players) {
      const attack = toAbsolute(shapePoint(op.slot, state.ins, 'attack', op.profile));
      const defend = toAbsolute(shapePoint(op.slot, state.ins, 'defend', op.profile));
      state.attackInfluence.push(influenceRow(attack, op.sentOff));
      state.defendInfluence.push(influenceRow(defend, op.sentOff));
      state.attackZone.push(clamp(Math.floor(attack.x), 0, ROWS - 1) * COLS + clamp(Math.floor(attack.y), 0, COLS - 1));
    }
  }

  // ---- AIの采配 ----

  private aiTick(): void {
    const minute = Math.floor(this.time / 60);
    for (const side of [0, 1] as const) {
      const state = this.sides[side];
      if (!state.ai) continue;
      this.aiInjurySubstitution(side, state);
      if (this.half === 1) continue;
      this.aiTactics(side, state, minute);
      this.aiSubstitutions(side, state, minute);
    }
  }

  /** ケガをした選手は、交代できるならすぐに代える */
  private aiInjurySubstitution(side: Side, state: SideState): void {
    for (const op of state.players) {
      if (!op.injured || op.sentOff) continue;
      const keeper = op.position === 'GK';
      const available = state.bench.filter((b) => !b.used && (b.player.position === 'GK') === keeper);
      const pool = available.length > 0 ? available : state.bench.filter((b) => !b.used);
      if (pool.length === 0) return;
      const best = pool.reduce((a, b) =>
        positionRating(b.player, op.position) > positionRating(a.player, op.position) ? b : a);
      this.substitute(side, op.player.id, best.player.id);
    }
  }

  /** 選手がケガをする。プレーは続けられるが、能力は大きく下がる */
  private injure(side: Side, op: OnPitch): void {
    if (op.injured || op.sentOff) return;
    op.injured = true;
    op.stats.rating -= 0.2;
    this.say('injury', side, 3, { p: op.player.name });
    this.stepId++;
  }

  private maybeInjure(side: Side, op: OnPitch, chance: number): void {
    if (!op.injured && this.rng.chance(chance * op.injuryRisk)) this.injure(side, op);
  }

  private aiTactics(side: Side, state: SideState, minute: number): void {
    const diff = this.goals[side] - this.goals[other(side)];
    const once = (key: string, at: number, action: () => void) => {
      if (minute < at || state.aiDone.has(key)) return;
      state.aiDone.add(key);
      action();
    };
    const withMentality = (m: number, tempo: number) =>
      ({ ...state.ins, mentality: clamp(m, -2, 2), tempo: clamp(tempo, -2, 2) });
    once('tactics60', 60, () => {
      if (diff < 0) this.changeTactics(side, { instructions: withMentality(state.baseIns.mentality + 1, state.ins.tempo) }, 'tacticsAttack');
    });
    once('tactics75', 75, () => {
      if (diff < 0) {
        this.changeTactics(side, { instructions: withMentality(state.baseIns.mentality + 2, state.baseIns.tempo + 1) }, 'tacticsAttack');
      } else if (diff > 0) {
        this.changeTactics(side, { instructions: withMentality(state.baseIns.mentality - 1, state.baseIns.tempo - 1) }, 'tacticsDefend');
      }
    });
  }

  private aiSubstitutions(side: Side, state: SideState, minute: number): void {
    for (const checkpoint of AI_SUB_CHECKPOINTS) {
      const key = `subs${checkpoint.minute}`;
      if (minute < checkpoint.minute || state.aiDone.has(key)) continue;
      state.aiDone.add(key);
      // 疲れている選手と、出来の悪い選手から代える
      const tired = state.players
        .filter((op) => !op.sentOff && op.position !== 'GK' && (op.stamina < 72 || op.stats.rating < 5.8))
        .sort((a, b) => (a.stamina + 15 * a.stats.rating) - (b.stamina + 15 * b.stats.rating));
      let made = 0;
      for (const op of tired) {
        if (made >= checkpoint.count) break;
        const available = state.bench.filter((b) => !b.used && b.player.position !== 'GK');
        if (available.length === 0) return;
        const best = available.reduce((a, b) =>
          positionRating(b.player, op.position) > positionRating(a.player, op.position) ? b : a);
        if (positionRating(best.player, op.position) < positionRating(op.player, op.position) * 0.75) continue;
        if (this.substitute(side, op.player.id, best.player.id).ok) made++;
      }
    }
  }

  // ---- 位置と能力の計算 ----

  private frame(side: Side, zone: number): Frame {
    const r = Math.floor(zone / COLS);
    const c = zone % COLS;
    return side === 0 ? { r, c } : { r: ROWS - 1 - r, c: COLS - 1 - c };
  }

  private toZone(side: Side, r: number, c: number): number {
    return side === 0 ? r * COLS + c : (ROWS - 1 - r) * COLS + (COLS - 1 - c);
  }

  /** 攻めている側から見て、ペナルティエリアの中央寄りのマスか */
  private inBox(att: Side, zone: number): boolean {
    const f = this.frame(att, zone);
    return f.r === ROWS - 1 && f.c >= 1 && f.c <= 3;
  }

  private op(side: Side, index: number): OnPitch {
    const op = this.sides[side].players[index];
    if (!op) throw new Error(`選手 ${index} がいません`);
    return op;
  }

  /** スタミナ、その日の出来、ホームの後押し、ポジションの適性を反映した能力値 */
  private attr(side: Side, op: OnPitch, key: AttributeKey): number {
    const home = side === 0 ? C.homeAdvantage : 1;
    // 能力の差がそのまま出すぎないよう、平均からの差を少し縮める（番狂わせが起きる余地を残す）
    const raw = op.player.attributes[key];
    const value = C.attributeCenter + (raw - C.attributeCenter) * C.attributeSpread;
    // 戦術の熟成度が低いと、判断力とポジショニングが下がる
    const familiar = key === 'decisions' || key === 'positioning' || key === 'offTheBall' ? 1 - C.familiarityWeight * (1 - op.familiarity) : 1;
    const tired = C.staminaFloor + (1 - C.staminaFloor) * (op.stamina / 100);
    return value * home * op.form * tired * (0.85 + 0.15 * op.fit)
      * op.fatigueFactor * familiar * (op.injured ? C.injury.playingHurt : 1);
  }

  private defendScore(side: Side, op: OnPitch): number {
    const a = (k: AttributeKey) => this.attr(side, op, k);
    return (0.35 * a('tackling') + 0.3 * a('positioning') + 0.15 * a('concentration') + 0.1 * a('pace') + 0.1 * a('strength'))
      * op.profile.defend;
  }

  private supportScore(side: Side, op: OnPitch): number {
    const a = (k: AttributeKey) => this.attr(side, op, k);
    return 0.4 * a('offTheBall') + 0.3 * a('firstTouch') + 0.15 * a('pace') + 0.15 * a('decisions');
  }

  /** 守っている側が、そのマスにかけている圧力（1前後）。1手の間は同じ値を使い回す。 */
  private pressure(defSide: Side, zone: number): number {
    const cache = this.pressureCache[defSide];
    const stamp = this.pressureStamp[defSide];
    if (stamp[zone] === this.stepId) return cache[zone] ?? 0;

    const state = this.sides[defSide];
    let scores = this.defendScoreCache[defSide];
    if (this.defendScoreStamp[defSide] !== this.stepId) {
      scores = state.players.map((op) => (op.sentOff ? 0 : this.defendScore(defSide, op)));
      this.defendScoreCache[defSide] = scores;
      this.defendScoreStamp[defSide] = this.stepId;
    }
    // ボールを失った直後は、攻めていたときの位置から守ることになる（前に人数をかけていたほど、後ろが手薄）
    const w = this.transitionWeight(defSide);
    let sum = 0;
    for (let i = 0; i < scores.length; i++) {
      const influence = (1 - w) * (state.defendInfluence[i]?.[zone] ?? 0) + w * (state.attackInfluence[i]?.[zone] ?? 0);
      sum += influence * (scores[i] ?? 0);
    }
    let value = sum / C.zoneStrengthScale;
    // 相手陣内（守る側から見て前の半分）では、プレスの強さに応じてボールに寄せる
    const r = this.frame(defSide, zone).r;
    if (r >= 3) {
      const level = (state.ins.pressing + 2) / 4;
      value += C.pressing.boost * level * (r >= 4 ? 1 : C.pressing.midfieldReach) * this.pressingUnit(defSide);
    }
    cache[zone] = value;
    stamp[zone] = this.stepId;
    return value;
  }

  /** 守備の形が整っていない度合い（0〜transition.blend）。ボールを失った直後ほど大きい */
  private transitionWeight(side: Side): number {
    const left = this.transitionUntil[side] - this.time;
    return left > 0 ? C.transition.blend * Math.min(1, left / C.transition.seconds) : 0;
  }

  /** 走る速さ（スピードと加速） */
  private speed(side: Side, op: OnPitch): number {
    return 0.5 * this.attr(side, op, 'pace') + 0.5 * this.attr(side, op, 'acceleration');
  }

  /** 最終ライン（CBとSB）の平均の速さ */
  private backLineSpeed(side: Side): number {
    const line = this.sides[side].players.filter((op) => !op.sentOff && (op.position === 'CB' || op.position === 'SB'));
    return line.length === 0 ? 8 : line.reduce((sum, op) => sum + this.speed(side, op), 0) / line.length;
  }

  /** 前線と中盤の、寄せる力（運動量・スピード・スタミナ）。1が平均的。 */
  private pressingUnit(side: Side): number {
    if (this.pressingUnitStamp[side] === this.stepId) return this.pressingUnitCache[side];
    const front = this.sides[side].players.filter((op) => !op.sentOff && op.position !== 'GK' && op.position !== 'CB' && op.position !== 'SB');
    const total = front.reduce((sum, op) =>
      sum + 0.6 * this.attr(side, op, 'workRate') + 0.2 * this.attr(side, op, 'pace') + 0.2 * this.attr(side, op, 'acceleration'), 0);
    const value = front.length === 0 ? 0 : total / front.length / 12;
    this.pressingUnitCache[side] = value;
    this.pressingUnitStamp[side] = this.stepId;
    return value;
  }

  private active(side: Side, filter: (op: OnPitch, i: number) => boolean = () => true): number[] {
    const result: number[] = [];
    this.sides[side].players.forEach((op, i) => {
      if (!op.sentOff && filter(op, i)) result.push(i);
    });
    return result;
  }

  /** 抜け出してGKと1対1になったときのxG */
  private breakawayXg(f: Frame): number {
    const row = C.xg[f.r] ?? [0];
    return (row[Math.min(2, Math.abs(f.c - 2))] ?? 0) * C.behind.breakawayXg;
  }

  /** GKが前に出て、裏へのボールやクロスを処理する力（0が平均的）。飛び出しが主で、前に出て守る型だと強くなる */
  private keeperSweep(side: Side, aerial: boolean): number {
    const index = this.goalkeeper(side);
    if (index === null) return -0.5;
    const keeper = this.op(side, index);
    const a = (k: AttributeKey) => this.attr(side, keeper, k);
    const value = aerial
      ? 0.5 * a('rushingOut') + 0.3 * a('handling') + 0.2 * a('jumping')
      : 0.7 * a('rushingOut') + 0.3 * a('pace');
    return ((value - 12) / 8) * (keeper.role === 'sweeperKeeper' && !aerial ? 1.5 : 1);
  }

  private goalkeeper(side: Side): number | null {
    const keepers = this.active(side, (op) => op.position === 'GK');
    if (keepers[0] !== undefined) return keepers[0];
    // GKが退場したら、反応の数値が一番高い選手が代わりに入る
    const field = this.active(side);
    if (field.length === 0) return null;
    return field.reduce((best, i) =>
      this.op(side, i).player.attributes.reflexes > this.op(side, best).player.attributes.reflexes ? i : best);
  }

  /** 守る側から、そのマスで一番からみそうな選手を選ぶ */
  private pickDefender(defSide: Side, zone: number, allowKeeper: boolean): number {
    const state = this.sides[defSide];
    const candidates = this.active(defSide, (op) => allowKeeper || op.position !== 'GK');
    return this.rng.weighted(candidates, (i) =>
      (state.defendInfluence[i]?.[zone] ?? 0) + 0.02);
  }

  /** セットプレーのキッカー。指定された選手がピッチにいればその選手、いなければ能力で選ぶ。 */
  private setPieceTaker(att: Side, kind: 'penalty' | 'freeKick' | 'corner'): number {
    const state = this.sides[att];
    const chosenId = state.tactics.setPieces?.[kind];
    const field = this.active(att, (op) => op.position !== 'GK');
    const chosen = field.find((i) => this.op(att, i).player.id === chosenId);
    if (chosen !== undefined) return chosen;
    const score = (op: OnPitch) => {
      const a = op.player.attributes;
      return kind === 'penalty' ? a.shooting + a.composure : kind === 'freeKick' ? a.shooting : a.crossing;
    };
    return field.reduce((best, i) => (score(this.op(att, i)) > score(this.op(att, best)) ? i : best));
  }

  // ---- 1手の進行 ----

  private step(): void {
    this.stepId++;
    const att = this.side;
    const def = other(att);
    const carrier = this.op(att, this.holder);
    if (carrier.sentOff) {
      this.holder = this.active(att)[0] ?? 0;
    }
    const f = this.frame(att, this.zone);
    const presHere = this.pressure(def, this.zone);
    // 裏に抜け出した選手は、寄せられる前にシュートまで持ち込みやすい
    const breakaway = this.breakaway && f.r === ROWS - 1;
    this.breakaway = false;
    if (!breakaway && carrier.position !== 'GK' && this.tryDispossess(att, def, f, presHere)) {
      this.tick(Math.max(1.5, C.secondsPerAction + this.rng.next() * 2 - 1), att);
      return;
    }
    const action = carrier.position === 'GK' ? 'pass'
      : breakaway && this.rng.chance(C.behind.breakawayShoot) ? 'shoot'
        : this.chooseAction(att, carrier, f, presHere);

    switch (action) {
      case 'pass': this.doPass(att, def, f, presHere); break;
      case 'dribble': this.doDribble(att, def, f); break;
      case 'shoot': this.doShot(att, def, f, 'open', this.holder, breakaway ? this.breakawayXg(f) : null, presHere); break;
      case 'cross': this.doCross(att, def); break;
      case 'clear': this.doClear(att, def); break;
    }

    const ins = this.sides[att].ins;
    const playTime = Math.max(1.5, C.secondsPerAction - 0.5 * ins.tempo + this.rng.next() * 3 - 1.5);
    this.tick(playTime + this.stoppage, att);
    this.stoppage = 0;
  }

  /** 囲まれた選手が、プレーする前にボールを奪われる */
  private tryDispossess(att: Side, def: Side, f: Frame, pressure: number): boolean {
    const carrier = this.op(att, this.holder);
    const keep = 0.5 * this.attr(att, carrier, 'composure') + 0.5 * this.attr(att, carrier, 'firstTouch');
    // 長いボールを使うチームは早くボールを離すので、寄せられて奪われにくい（そのぶんパスの精度は落ちる）
    const ins = this.sides[att].ins;
    const direct = 1 - C.dispossession.directRelief * clamp(ins.passingLength + 0.5 * ins.tempo, -2, 2);
    const chance = C.dispossession.base * Math.max(0, pressure - 0.4)
      * (f.r === ROWS - 1 ? C.dispossession.boxMultiplier : 1) * (1.5 - keep / 20) * direct;
    if (!this.rng.chance(chance)) return false;
    const defenderIndex = this.pickDefender(def, this.zone, f.r === ROWS - 1);
    const defender = this.op(def, defenderIndex);
    defender.stats.tackles++;
    defender.stats.rating += 0.05;
    this.sides[def].stats.tackles++;
    carrier.stats.rating -= 0.03;
    this.say('tackle', def, 1, { p: carrier.player.name, q: defender.player.name });
    this.maybeInjure(att, carrier, C.injury.onTackle);
    this.turnover(def, defenderIndex, this.zone, true);
    return true;
  }

  private chooseAction(att: Side, op: OnPitch, f: Frame, pressure: number): Action {
    const W = C.weights;
    const ins = this.sides[att].ins;
    const role = op.profile;
    const a = (k: AttributeKey) => this.attr(att, op, k);
    const central = f.c >= 1 && f.c <= 3;
    const wide = f.c === 0 || f.c === COLS - 1;

    const shootBias = SHOOT_TENDENCY[op.position] * role.shoot * (a('shooting') / 12) * (1 + 0.12 * ins.mentality);
    let shoot = 0;
    if (f.r === 5) shoot = (central ? W.shotInBox : W.shotInBoxWide) * shootBias;
    else if (f.r === 4) shoot = (central ? W.shotOutsideBox : W.shotOutsideBoxWide) * shootBias;

    const cross = wide && f.r >= 3
      ? (f.r >= 4 ? W.cross : W.earlyCross) * role.cross * (a('crossing') / 12) * (1 + 0.12 * ins.width)
      : 0;
    const dribble = W.dribble * DRIBBLE_TENDENCY[op.position] * role.dribble * (a('dribbling') / 12)
      * (1 + 0.1 * ins.mentality) * (f.r >= 2 ? 1 : 0.4) * (f.r === 5 ? 0.5 : 1);
    const clear = f.r <= 1 && pressure > 1 ? W.clear * (pressure - 0.6) * (1.2 - a('composure') / 20) : 0;

    const options: [Action, number][] = [
      ['pass', W.pass], ['dribble', dribble], ['shoot', shoot], ['cross', cross], ['clear', clear],
    ];
    return this.rng.weighted(options, ([, w]) => w)[0];
  }

  private doPass(att: Side, def: Side, f: Frame, presHere: number): void {
    const state = this.sides[att];
    const ins = state.ins;
    const defIns = this.sides[def].ins;
    const passerIndex = this.holder;
    const passer = this.op(att, passerIndex);

    // 相手に囲まれていると、パスを出す前に倒されることがある
    const foulChance = C.fouls.onPassPerPressure * Math.max(0, presHere) * (1 + 0.15 * defIns.pressing)
      * (this.inBox(att, this.zone) ? C.fouls.inBoxMultiplier : 1);
    if (this.rng.chance(foulChance)) {
      this.commitFoul(def, this.pickDefender(def, this.zone, false), att, passerIndex, this.zone);
      return;
    }

    const isKeeper = passer.position === 'GK';
    const candidates = this.active(att, (op, i) => i !== passerIndex && (op.position !== 'GK' || f.r <= 1));
    const vision = this.attr(att, passer, 'vision');
    const targetInfo = (j: number) => {
      const tz = state.attackZone[j] ?? this.zone;
      const tf = this.frame(att, tz);
      const dr = tf.r - f.r;
      return { tz, tf, dr, dist: Math.max(0.7, Math.hypot(dr, tf.c - f.c)) };
    };
    const target = this.rng.weighted(candidates, (j) => {
      const { tz, dr, dist } = targetInfo(j);
      const lengthPreference = isKeeper ? 1 - 0.2 * ins.passingLength : 1 - 0.15 * ins.passingLength;
      let forward = dr > 0 ? 1 + 0.45 * dr * (1 + 0.15 * ins.tempo + 0.1 * ins.mentality) * passer.profile.forward
        : dr === 0 ? 0.75 : 0.4 * (1 - 0.12 * ins.tempo);
      if (dr >= 2) forward *= vision / 12;
      const receiver = this.op(att, j);
      const sup = (state.attackInfluence[j]?.[tz] ?? 0) * this.supportScore(att, receiver) / C.zoneStrengthScale;
      const open = sup / (sup + this.pressure(def, tz) + 0.1);
      const boxWeight = this.frame(att, tz).r === ROWS - 1 && f.r < ROWS - 1 ? C.pass.boxTargetWeight : 1;
      return Math.exp(-dist * C.pass.distanceDecay * lengthPreference) * forward * open * boxWeight * receiver.profile.target;
    });
    const { tz, tf, dr, dist } = targetInfo(target);
    const receiver = this.op(att, target);

    passer.stats.passes++;
    state.stats.passes++;

    // オフサイド（相手のラインが高いほど、裏を狙う選手ほど起きやすい）
    if (tf.r >= 4 && dr >= 2 &&
      this.rng.chance(Math.max(0.01, C.offside.base + C.offside.perLineStep * defIns.defensiveLine) * receiver.profile.offside)) {
      state.stats.offsides++;
      this.say('offside', att, 1, { p: receiver.player.name });
      this.stoppage += 15;
      this.turnover(def, this.pickDefender(def, tz, false), tz, false);
      return;
    }

    const a = (k: AttributeKey) => this.attr(att, passer, k);
    const quality = 0.5 * a('passing') + 0.25 * a('vision') + 0.25 * a('decisions');
    // 長いボールは寄せてくる相手の頭を越えるので、出し手への寄せの影響が小さい
    const longBall = dist >= 3;
    const passerPressure = (C.pass.pressurePenalty * presHere + C.pass.pressureDistancePenalty * presHere * Math.min(dist, 3))
      * (longBall ? C.pass.longBallPressureRelief : 1);
    // 最終ラインの裏へのボール：ラインが高いほど、受け手が守備陣より速いほど通りやすい
    const behind = dr >= 2 && tf.r >= ROWS - 2;
    // プレスをかけるとチーム全体が前に出るので、ラインを上げたときと同じように背後が空く
    const lineHeight = defIns.defensiveLine + C.behind.pressingShare * defIns.pressing + 2 * this.transitionWeight(def);
    const paceEdge = behind ? clamp((this.speed(att, receiver) - this.backLineSpeed(def)) / 8, -1, 1) : 0;
    const space = clamp((lineHeight + 2) / 4, 0, 1.25);
    const behindBonus = behind ? C.behind.line * lineHeight + C.behind.pace * paceEdge * space : 0;
    const success = clamp(
      C.pass.base - C.pass.distancePenalty * dist + 0.012 * (quality - 12)
        - passerPressure + behindBonus
        - 0.07 * (this.pressure(def, tz) - 0.8)
        - C.pass.forwardPenalty * Math.max(0, dr) + 0.004 * (this.attr(att, receiver, 'firstTouch') - 12)
        - (tf.r === ROWS - 1 && f.r < ROWS - 1 ? C.pass.boxEntryPenalty : 0)
        // 裏へのボールは、GKの飛び出しで処理される
        - (tf.r === ROWS - 1 && dr >= 2 ? C.keeper.sweepOnThroughBall * this.keeperSweep(def, false) : 0),
      0.35, 0.97,
    );

    if (this.rng.chance(success)) {
      passer.stats.passesCompleted++;
      passer.stats.rating += 0.01;
      state.stats.passesCompleted++;
      this.holder = target;
      this.zone = tz;
      this.lastPasser = passerIndex;
      const runChance = clamp((paceEdge * space + 0.1 * lineHeight) * C.behind.breakawayRate, 0, C.behind.breakawayMax);
      if (behind && tf.r === ROWS - 1 && runChance > 0 && this.rng.chance(runChance)) {
        this.breakaway = true;
        this.say('breakaway', att, 2, { p: passer.player.name, q: receiver.player.name });
      } else if (dr >= 2 && tf.r >= 3) {
        this.say('throughBall', att, 1, { p: passer.player.name, q: receiver.player.name });
      }
      return;
    }

    // パスカット：強く寄せられていると出し手のマスで、そうでなければ受け手のマスか途中のマスで奪われる
    const roll = this.rng.next();
    const atPasser = clamp(0.5 * (presHere - 0.5), 0, 0.5);
    const cutZone = roll < atPasser ? this.zone
      : roll < atPasser + (1 - atPasser) * 0.6 ? tz
        : this.toZone(att, Math.round((f.r + tf.r) / 2), Math.round((f.c + tf.c) / 2));
    const interceptor = this.pickDefender(def, cutZone, false);
    const cutter = this.op(def, interceptor);
    passer.stats.rating -= 0.03;
    // 失敗したパスの一部だけを「パスカット」として記録する（残りはボールがラインを割る、こぼれるなど）
    if (this.rng.chance(C.pass.interceptedShare)) {
      cutter.stats.interceptions++;
      cutter.stats.rating += 0.04;
      this.sides[def].stats.interceptions++;
      this.say('interception', def, 1, { q: cutter.player.name });
    }
    this.turnover(def, interceptor, cutZone, true);
  }

  private doDribble(att: Side, def: Side, f: Frame): void {
    const carrierIndex = this.holder;
    const carrier = this.op(att, carrierIndex);
    const towardCenter = f.c < 2 ? [0, 1] : f.c > 2 ? [0, -1] : [-1, 0, 1];
    const tr = Math.min(ROWS - 1, f.r + 1);
    const tc = clamp(f.c + this.rng.pick(towardCenter), 0, COLS - 1);
    const tz = this.toZone(att, tr, tc);

    const defenderIndex = this.pickDefender(def, tz, tr === ROWS - 1);
    const defender = this.op(def, defenderIndex);
    const a = (k: AttributeKey) => this.attr(att, carrier, k);
    const d = (k: AttributeKey) => this.attr(def, defender, k);
    const attackScore = 0.45 * a('dribbling') + 0.3 * a('acceleration') + 0.25 * a('pace');
    const defendScore = 0.45 * d('tackling') + 0.3 * d('positioning') + 0.25 * d('pace');
    const success = clamp(C.dribble.base + 0.035 * (attackScore - defendScore) - 0.1 * (this.pressure(def, tz) - 1)
      - (tr === ROWS - 1 && f.r < ROWS - 1 ? C.dribble.boxEntryPenalty : 0), 0.15, 0.85);

    carrier.stats.dribbles++;
    const foulZone = this.rng.chance(0.5) ? tz : this.zone;
    const foulChance = C.fouls.onDribble * (1 + 0.15 * this.sides[def].ins.pressing)
      * (1.4 - 0.8 * defender.player.attributes.tackling / 20)
      * (this.inBox(att, foulZone) ? C.fouls.inBoxMultiplier : 1);
    if (this.rng.chance(foulChance)) {
      this.commitFoul(def, defenderIndex, att, carrierIndex, foulZone);
      return;
    }

    if (this.rng.chance(success)) {
      carrier.stats.dribblesWon++;
      carrier.stats.rating += 0.05;
      this.say('dribble', att, 1, { p: carrier.player.name });
      this.zone = tz;
      this.lastPasser = null;
      return;
    }
    defender.stats.tackles++;
    defender.stats.rating += 0.05;
    this.sides[def].stats.tackles++;
    carrier.stats.rating -= 0.03;
    this.say('tackle', def, 1, { p: carrier.player.name, q: defender.player.name });
    this.maybeInjure(att, carrier, C.injury.onTackle);
    this.turnover(def, defenderIndex, tz, true);
  }

  private doShot(att: Side, def: Side, f: Frame, kind: ShotKind, shooterIndex: number,
    xgOverride: number | null, pressure: number): void {
    const state = this.sides[att];
    const shooter = this.op(att, shooterIndex);
    const a = (k: AttributeKey) => this.attr(att, shooter, k);

    let xg = xgOverride ?? 0;
    if (kind === 'open') {
      const row = C.xg[f.r] ?? [0];
      xg = (row[Math.min(2, Math.abs(f.c - 2))] ?? 0) * clamp(1 - 0.25 * (pressure - 0.8), 0.5, 1.15);
    }
    const finishing = kind === 'header'
      ? 0.6 * a('heading') + 0.4 * a('jumping')
      : 0.6 * a('shooting') + 0.4 * a('composure');

    const keeperIndex = this.goalkeeper(def);
    const keeper = keeperIndex === null ? null : this.op(def, keeperIndex);
    // GKの力はシュートの種類で変わる：近くからは1対1と飛び出し（間合いを詰める）、遠くからはキャッチ
    const k = (key: AttributeKey) => (keeper ? this.attr(def, keeper, key) : 5);
    const closeRange = kind === 'open' && f.r === ROWS - 1;
    const keeperQuality = !keeper ? 5
      : closeRange ? 0.4 * k('reflexes') + 0.35 * k('oneOnOne') + 0.15 * k('rushingOut') + 0.1 * k('handling')
        : kind === 'header' ? 0.6 * k('reflexes') + 0.25 * k('handling') + 0.15 * k('jumping')
          : 0.6 * k('reflexes') + 0.3 * k('handling') + 0.1 * k('oneOnOne');

    const pGoal = clamp(xg * (0.7 + 0.6 * finishing / 20) * (1.3 - 0.6 * keeperQuality / 20), 0.001, 0.95);
    const pSaved = clamp(0.24 + 0.1 * (finishing - 12) / 8, 0.12, 0.4);
    const pBlocked = kind === 'open' ? 0.12 + 0.12 * Math.min(pressure, 2) : 0.05;

    shooter.stats.shots++;
    state.stats.shots++;
    state.stats.xg += xg;
    this.creditKeyPass(att, shooterIndex);

    const names: CommentaryNames = { p: shooter.player.name, gk: keeper?.player.name ?? '' };
    const u = this.rng.next();
    if (u < pGoal) {
      const key: CommentaryKey = kind === 'header' ? 'headerGoal' : kind === 'freeKick' ? 'freeKickGoal' : 'goal';
      this.scoreGoal(att, shooterIndex, key);
      return;
    }

    if (u < pGoal + pSaved) {
      shooter.stats.shotsOnTarget++;
      shooter.stats.rating += 0.1;
      state.stats.shotsOnTarget++;
      if (keeper) {
        keeper.stats.saves++;
        keeper.stats.rating += 0.25;
      }
      this.say(kind === 'header' ? 'headerSaved' : 'shotSaved', att, 2, names);
      if (this.rng.chance(0.35)) {
        this.corner(att, def);
      } else {
        this.turnover(def, keeperIndex ?? 0, this.toZone(def, 0, 2), false);
      }
      return;
    }

    if (u < pGoal + pSaved + pBlocked) {
      const blockerIndex = this.pickDefender(def, this.zone, false);
      this.op(def, blockerIndex).stats.rating += 0.05;
      this.say('shotBlocked', att, 2, names);
      const roll = this.rng.next();
      if (roll < 0.3) this.corner(att, def);
      else if (roll < 0.75) this.turnover(def, blockerIndex, this.zone, false);
      else this.lastPasser = null;
      return;
    }

    shooter.stats.rating -= 0.05;
    this.say(kind === 'header' ? 'headerOff' : 'shotOff', att, 2, names);
    this.stoppage += 15;
    this.turnover(def, keeperIndex ?? 0, this.toZone(def, 0, 2), false);
  }

  private aerial(side: Side, op: OnPitch): number {
    return 0.5 * this.attr(side, op, 'heading') + 0.5 * this.attr(side, op, 'jumping');
  }

  private doCross(att: Side, def: Side): void {
    const crosserIndex = this.holder;
    const crosser = this.op(att, crosserIndex);
    const tz = this.toZone(att, ROWS - 1, this.rng.weighted([1, 2, 3], (c) => (c === 2 ? 2 : 1)));
    this.say('cross', att, 1, { p: crosser.player.name });

    const state = this.sides[att];
    const targets = this.active(att, (op, i) => i !== crosserIndex && op.position !== 'GK');
    const targetIndex = this.rng.weighted(targets, (i) => {
      const op = this.op(att, i);
      return ((state.attackInfluence[i]?.[tz] ?? 0) + 0.05) * this.aerial(att, op) * op.profile.aerialTarget;
    });
    const target = this.op(att, targetIndex);
    const defenderIndex = this.pickDefender(def, tz, false);
    const duel = this.aerial(att, target) - this.aerial(def, this.op(def, defenderIndex));

    const reach = clamp(C.cross.base + 0.02 * (this.attr(att, crosser, 'crossing') - 12)
      + 0.025 * duel - 0.08 * (this.pressure(def, tz) - 1) - C.keeper.claimCross * this.keeperSweep(def, true), 0.1, 0.55);
    if (this.rng.chance(reach)) {
      this.lastPasser = crosserIndex;
      this.holder = targetIndex;
      this.zone = tz;
      const xg = C.headerXg * clamp(1 + 0.04 * duel, 0.6, 1.5);
      this.doShot(att, def, this.frame(att, tz), 'header', targetIndex, xg, this.pressure(def, tz));
      return;
    }
    crosser.stats.rating -= 0.02;
    if (this.rng.chance(C.cross.cornerOnClearance)) this.corner(att, def);
    else this.turnover(def, defenderIndex, tz, false);
  }

  private doClear(att: Side, def: Side): void {
    const tz = this.toZone(att, this.rng.int(2, 3), this.rng.int(0, COLS - 1));
    this.stoppage += 3;
    this.lastPasser = null;
    if (this.rng.chance(0.4)) {
      const state = this.sides[att];
      this.holder = this.rng.weighted(this.active(att, (op) => op.position !== 'GK'),
        (i) => (state.attackInfluence[i]?.[tz] ?? 0) + 0.02);
      this.zone = tz;
      return;
    }
    this.turnover(def, this.pickDefender(def, tz, false), tz, false);
  }

  private corner(att: Side, def: Side): void {
    const state = this.sides[att];
    state.stats.corners++;
    this.stoppage += 25;
    this.say('corner', att, 1, { team: state.team.name });

    const field = this.active(att, (op) => op.position !== 'GK');
    const takerIndex = this.setPieceTaker(att, 'corner');
    if (this.rng.chance(C.cornerShotChance)) {
      const headerIndex = this.rng.weighted(field.filter((i) => i !== takerIndex), (i) => {
        const op = this.op(att, i);
        return this.aerial(att, op) ** 2 * op.profile.aerialTarget;
      });
      const tz = this.toZone(att, ROWS - 1, 2);
      const defender = this.op(def, this.pickDefender(def, tz, false));
      const duel = this.aerial(att, this.op(att, headerIndex)) - this.aerial(def, defender);
      this.lastPasser = takerIndex;
      this.holder = headerIndex;
      this.zone = tz;
      this.doShot(att, def, this.frame(att, tz), 'header', headerIndex,
        C.cornerHeaderXg * clamp(1 + 0.04 * duel, 0.6, 1.5), this.pressure(def, tz));
      return;
    }
    if (this.rng.chance(0.6)) {
      const tz = this.toZone(def, 1, 2);
      this.turnover(def, this.pickDefender(def, tz, false), tz, false);
    } else {
      const tz = this.toZone(att, 3, this.rng.int(1, 3));
      this.holder = this.rng.weighted(field, (i) => (state.attackInfluence[i]?.[tz] ?? 0) + 0.02);
      this.zone = tz;
      this.lastPasser = null;
    }
  }

  private commitFoul(def: Side, foulerIndex: number, att: Side, victimIndex: number, zone: number): void {
    const fouler = this.op(def, foulerIndex);
    const victim = this.op(att, victimIndex);
    const defState = this.sides[def];
    fouler.stats.fouls++;
    fouler.stats.rating -= 0.05;
    defState.stats.fouls++;
    this.stoppage += 20;
    const names: CommentaryNames = { p: victim.player.name, q: fouler.player.name };
    this.say('foul', def, 1, names);
    this.maybeInjure(att, victim, C.injury.onFoul);

    const f = this.frame(att, zone);
    if (this.rng.chance(C.fouls.straightRed)) {
      this.sendOff(def, foulerIndex, 'redCard');
    } else if (this.rng.chance((f.r >= 3 ? C.fouls.yellowOnCounter : C.fouls.yellow)
      * (fouler.stats.yellowCards > 0 ? C.fouls.cautionedMultiplier : 1))) {
      if (fouler.stats.yellowCards > 0) {
        fouler.stats.yellowCards++;
        defState.stats.yellowCards++;
        this.sendOff(def, foulerIndex, 'secondYellow');
      } else {
        fouler.stats.yellowCards++;
        fouler.stats.rating -= 0.3;
        defState.stats.yellowCards++;
        this.say('yellowCard', def, 2, names);
      }
    }

    const central = f.c >= 1 && f.c <= 3;
    if (f.r === ROWS - 1 && central) {
      this.penalty(att, def, victimIndex);
      return;
    }
    this.side = att;
    this.holder = victimIndex;
    this.zone = zone;
    this.lastPasser = null;
    if (f.r === ROWS - 2 && central) {
      this.say('freeKick', att, 2, { team: this.sides[att].team.name });
      if (this.rng.chance(0.5)) {
        this.doShot(att, def, f, 'freeKick', this.setPieceTaker(att, 'freeKick'), C.freeKickXg, 0.8);
      } else {
        this.holder = this.setPieceTaker(att, 'corner');
        this.doCross(att, def);
      }
    }
  }

  private sendOff(side: Side, index: number, key: 'redCard' | 'secondYellow'): void {
    const op = this.op(side, index);
    op.sentOff = true;
    op.stats.redCards++;
    op.stats.rating -= 1.5;
    this.sides[side].stats.redCards++;
    this.say(key, side, 3, { q: op.player.name });
    this.updateInfluence(this.sides[side], side);
    this.stepId++;
  }

  private penalty(att: Side, def: Side, victimIndex: number): void {
    const state = this.sides[att];
    this.stoppage += 60;
    this.say('penalty', att, 3, { p: this.op(att, victimIndex).player.name });
    const takerIndex = this.setPieceTaker(att, 'penalty');
    const taker = this.op(att, takerIndex);
    const keeperIndex = this.goalkeeper(def);
    const keeper = keeperIndex === null ? null : this.op(def, keeperIndex);
    const pGoal = clamp(C.penaltyXg
      + 0.01 * (this.attr(att, taker, 'composure') - 12) + 0.008 * (this.attr(att, taker, 'shooting') - 12)
      - (keeper ? 0.01 * (this.attr(def, keeper, 'reflexes') - 12) : -0.1), 0.5, 0.92);

    taker.stats.shots++;
    state.stats.shots++;
    state.stats.xg += C.penaltyXg;
    this.lastPasser = null;
    if (this.rng.chance(pGoal)) {
      this.scoreGoal(att, takerIndex, 'penaltyGoal');
      return;
    }
    const saved = keeper !== null && this.rng.chance(0.7);
    if (keeper && saved) {
      taker.stats.shotsOnTarget++;
      state.stats.shotsOnTarget++;
      keeper.stats.saves++;
      keeper.stats.rating += 0.8;
    }
    taker.stats.rating -= 0.5;
    this.say(saved ? 'penaltyMissed' : 'penaltyWide', att, 3, { p: taker.player.name, gk: keeper?.player.name ?? '' });
    this.turnover(def, keeperIndex ?? 0, this.toZone(def, 0, 2), false);
  }

  private scoreGoal(att: Side, scorerIndex: number, key: CommentaryKey): void {
    const def = other(att);
    const state = this.sides[att];
    const scorer = this.op(att, scorerIndex);
    this.goals[att]++;
    state.stats.goals++;
    state.stats.shotsOnTarget++;
    scorer.stats.goals++;
    scorer.stats.shotsOnTarget++;
    scorer.stats.rating += 1.0;

    let text = commentary(this.rng, key, { p: scorer.player.name });
    if (this.lastPasser !== null && this.lastPasser !== scorerIndex) {
      const assister = this.op(att, this.lastPasser);
      assister.stats.assists++;
      assister.stats.rating += 0.5;
      text += `（アシスト：${assister.player.name}）`;
    }
    text += `　${this.goals[0]}-${this.goals[1]}`;
    this.pushEvent(EVENT_TYPE[key], att, 3, text);

    for (const op of this.sides[def].players) {
      if (op.position === 'GK') op.stats.rating -= 0.3;
      if (op.position === 'CB' || op.position === 'SB') op.stats.rating -= 0.15;
    }
    this.stoppage += 60;
    this.kickoff(def, null);
  }

  private creditKeyPass(att: Side, shooterIndex: number): void {
    if (this.lastPasser === null || this.lastPasser === shooterIndex) return;
    const passer = this.op(att, this.lastPasser);
    passer.stats.keyPasses++;
    passer.stats.rating += 0.1;
  }

  // ---- ボールの移動と時間 ----

  private kickoff(side: Side, key: 'kickoff' | 'secondHalf' | null): void {
    const forwards = this.active(side, (op) => op.position === 'FW' || op.position === 'AM' || op.position === 'CM');
    this.side = side;
    this.holder = forwards[0] ?? this.active(side)[0] ?? 0;
    this.zone = this.toZone(side, 2, 2);
    this.lastPasser = null;
    if (key) this.say(key, side, 2, { team: this.sides[side].team.name });
  }

  /** ボールが相手に渡る */
  private turnover(newSide: Side, holderIndex: number, zone: number, wonInPlay: boolean): void {
    this.side = newSide;
    this.holder = holderIndex;
    this.zone = zone;
    this.lastPasser = null;
    this.breakaway = false;
    if (wonInPlay) this.transitionUntil[other(newSide)] = this.time + C.transition.seconds;
    if (wonInPlay && this.frame(newSide, zone).r >= 3) {
      this.sides[newSide].stats.highRecoveries++;
    }
  }

  private tick(seconds: number, possessing: Side): void {
    this.time += seconds;
    this.sides[possessing].stats.possessionSeconds += seconds;
    for (const state of this.sides) {
      const ins = state.ins;
      const intensity = 1 + C.pressing.staminaCost * ins.pressing + 0.04 * ins.tempo;
      for (const op of state.players) {
        if (op.sentOff) continue;
        const { stamina, workRate } = op.player.attributes;
        const drain = C.staminaDrainPerMinute * (1.3 - 0.6 * stamina / 20) * (0.8 + 0.4 * workRate / 20) * intensity * op.profile.stamina;
        op.stamina = Math.max(0, op.stamina - drain * seconds / 60);
      }
    }
    // 接触のないケガ（肉離れなど）。疲れているほど起きやすい
    this.sides.forEach((state, sideIndex) => {
      for (const op of state.players) {
        if (op.sentOff || op.injured) continue;
        const chance = C.injury.nonContactPerMinute * (seconds / 60) * (1 + (100 - op.stamina) / 60);
        this.maybeInjure(sideIndex as Side, op, chance);
      }
    });
  }

  // ---- 実況 ----

  /** 今が何分目か（後半のアディショナルタイムも 90 以上の数で返す） */
  private currentMinute(): number {
    return Math.floor(this.time / 60) + 1;
  }

  private minuteLabel(): string {
    if (this.half === 1 && this.time >= HALF) return `45+${Math.floor((this.time - HALF) / 60) + 1}'`;
    if (this.half === 2 && this.time >= 2 * HALF) return `90+${Math.floor((this.time - 2 * HALF) / 60) + 1}'`;
    return `${Math.floor(this.time / 60) + 1}'`;
  }

  private say(key: CommentaryKey, side: Side | null, importance: 1 | 2 | 3, names: CommentaryNames): void {
    if (importance === 1 && !this.detailed) return;
    this.pushEvent(EVENT_TYPE[key], side, importance, commentary(this.rng, key, names));
  }

  private pushEvent(type: MatchEventType, side: Side | null, importance: 1 | 2 | 3, text: string): void {
    this.eventList.push({ clock: this.time, minute: this.minuteLabel(), side, type, importance, text });
  }

  // ---- 試合終了 ----

  private finish(): MatchResult {
    const result = (side: Side) => Math.sign(this.goals[side] - this.goals[other(side)]);
    const lines: MatchPlayerLine[] = [];
    this.sides.forEach((state, sideIndex) => {
      const side = sideIndex as Side;
      const onPitch = state.players.filter((op) => !op.sentOff);
      state.stats.staminaAtEnd = onPitch.reduce((sum, op) => sum + op.stamina, 0) / Math.max(1, onPitch.length);
      state.stats.xg = Math.round(state.stats.xg * 100) / 100;
      const cleanSheet = this.goals[other(side)] === 0;
      // 先発（途中で退いた選手を含む）を枠の順に、そのあと途中出場を出た順に並べる
      const everyone = [...state.players, ...state.subbedOff].sort((a, b) => a.order - b.order);
      for (const op of everyone) {
        if (cleanSheet && op.position === 'GK') op.stats.rating += 0.4;
        if (cleanSheet && (op.position === 'CB' || op.position === 'SB')) op.stats.rating += 0.25;
        op.stats.rating += 0.2 * result(side);
        op.stats.rating = Math.round(clamp(op.stats.rating, 3, 10) * 10) / 10;
        lines.push({
          side, player: op.player, position: op.position, role: op.role, stats: op.stats,
          started: op.started, minuteOn: op.minuteOn, minuteOff: op.minuteOff,
          injured: op.injured, staminaEnd: Math.round(op.stamina),
        });
      }
    });
    const [home, away] = this.sides;
    return {
      seed: this.seed,
      teams: [home.team, away.team],
      score: [this.goals[0], this.goals[1]],
      stats: [home.stats, away.stats],
      players: lines,
      events: this.eventList,
    };
  }
}
