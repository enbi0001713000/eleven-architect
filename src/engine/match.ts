// 試合エンジン（ゾーン方式）。要件定義書「試合エンジン」の章に対応する。
//
// ピッチを縦6×横5の30マスに分け、ボールを持った選手のプレーを一手ずつ計算する。
// マスの番号は「ホームが攻める向き」で数える（行0 = ホームのゴール側、行5 = アウェイのゴール側）。
// 計算の中では、攻めている側から見た向き（行5 = 相手ゴール前）に直して考える。

import { commentary, type CommentaryKey, type CommentaryNames } from './commentary';
import { ENGINE_CONFIG as C } from './config';
import { FORMATIONS, shapePoint, type Slot } from './formations';
import { createRng, type Rng } from './rng';
import type {
  AttributeKey, MatchEvent, MatchEventType, MatchResult, Player, PlayerMatchStats,
  Position, Side, Team, TeamInstructions, TeamStats,
} from './types';

const ROWS = 6;
const COLS = 5;
const ZONES = ROWS * COLS;
const HALF = 45 * 60;

export interface SimulateOptions {
  seed: number;
  /** false にすると細かい実況（重要度1）を作らない。大量に試合を回すとき用。 */
  detailedCommentary?: boolean;
}

export function simulateMatch(home: Team, away: Team, options: SimulateOptions): MatchResult {
  return new MatchSimulator(home, away, options).run();
}

interface OnPitch {
  player: Player;
  position: Position;
  slot: Slot;
  /** 0〜100 */
  stamina: number;
  /** その日の出来（1.0 が普段どおり） */
  form: number;
  sentOff: boolean;
  stats: PlayerMatchStats;
}

interface SideState {
  team: Team;
  ins: TeamInstructions;
  players: OnPitch[];
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

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const other = (side: Side): Side => (side === 0 ? 1 : 0);

const EVENT_TYPE: Record<CommentaryKey, MatchEventType> = {
  kickoff: 'kickoff', secondHalf: 'kickoff', halftime: 'halftime', fulltime: 'fulltime',
  goal: 'goal', headerGoal: 'goal', freeKickGoal: 'goal', penaltyGoal: 'penaltyGoal',
  shotSaved: 'shotSaved', headerSaved: 'shotSaved', shotOff: 'shotOff', headerOff: 'shotOff',
  shotBlocked: 'shotBlocked', penalty: 'penalty', penaltyMissed: 'penaltyMissed', penaltyWide: 'penaltyMissed',
  corner: 'corner', freeKick: 'freeKick', foul: 'foul', yellowCard: 'yellowCard',
  secondYellow: 'redCard', redCard: 'redCard', offside: 'offside',
  throughBall: 'buildUp', dribble: 'buildUp', tackle: 'buildUp', interception: 'buildUp', cross: 'buildUp',
};

function emptyPlayerStats(): PlayerMatchStats {
  return {
    rating: 6, passes: 0, passesCompleted: 0, keyPasses: 0, dribbles: 0, dribblesWon: 0,
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

class MatchSimulator {
  private readonly rng: Rng;
  private readonly seed: number;
  private readonly detailed: boolean;
  private readonly sides: [SideState, SideState];
  private readonly events: MatchEvent[] = [];
  private readonly score: [number, number] = [0, 0];
  private clock = 0;
  private half: 1 | 2 = 1;
  private halfEnd = HALF;
  /** プレー以外で止まった時間（ファウル、ゴールなど） */
  private stoppage = 0;

  // ボールの状態
  private side: Side = 0;
  private holder = 0;
  private zone = 0;
  /** 直前にパス（やクロス）を出した選手。アシストとキーパスの記録に使う。 */
  private lastPasser: number | null = null;

  // 1手の間は守備の圧力を使い回すためのキャッシュ
  private stepId = 0;
  private readonly pressureCache: [Float64Array, Float64Array] = [new Float64Array(ZONES), new Float64Array(ZONES)];
  private readonly pressureStamp: [Int32Array, Int32Array] = [new Int32Array(ZONES).fill(-1), new Int32Array(ZONES).fill(-1)];
  private readonly defendScoreCache: [number[], number[]] = [[], []];
  private readonly defendScoreStamp: [number, number] = [-1, -1];
  private readonly pressingUnitCache: [number, number] = [1, 1];
  private readonly pressingUnitStamp: [number, number] = [-1, -1];

  constructor(home: Team, away: Team, options: SimulateOptions) {
    this.seed = options.seed;
    this.detailed = options.detailedCommentary ?? true;
    this.rng = createRng(options.seed);
    this.sides = [this.createSide(home, 0), this.createSide(away, 1)];
  }

  run(): MatchResult {
    this.kickoff(0, 'kickoff');
    this.halfEnd = HALF + this.rng.int(1, 4) * 60;
    for (;;) {
      this.step();
      if (this.clock < this.halfEnd) continue;
      if (this.half === 2) break;
      this.say('halftime', null, 2, {});
      this.half = 2;
      this.clock = HALF;
      this.halfEnd = 2 * HALF + this.rng.int(2, 6) * 60;
      this.kickoff(1, 'secondHalf');
    }
    this.say('fulltime', null, 2, {});
    return this.finish();
  }

  // ---- 準備 ----

  private createSide(team: Team, side: Side): SideState {
    const slots = FORMATIONS[team.tactics.formation];
    if (team.lineup.length !== slots.length) {
      throw new Error(`${team.name}: 先発は${slots.length}人必要です（今は${team.lineup.length}人）`);
    }
    const players = team.lineup.map((id, i): OnPitch => {
      const player = team.players.find((p) => p.id === id);
      const slot = slots[i];
      if (!player || !slot) throw new Error(`${team.name}: 先発の選手 ${id} が見つかりません`);
      // 安定感が低いほど、その日の出来のブレが大きい
      const spread = 0.02 + 0.08 * (1 - player.hidden.consistency / 20);
      return {
        player, position: slot.position, slot, stamina: 100,
        form: clamp(this.rng.normal(1, spread), 0.8, 1.2), sentOff: false, stats: emptyPlayerStats(),
      };
    });
    const state: SideState = {
      team, ins: team.tactics.instructions, players,
      attackInfluence: [], defendInfluence: [], attackZone: [], stats: emptyTeamStats(),
    };
    this.updateInfluence(state, side);
    return state;
  }

  /** 立ち位置から、各選手が各マスに与える影響を計算し直す（開始時と退場者が出たとき） */
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
      const attack = toAbsolute(shapePoint(op.slot, state.ins, 'attack'));
      const defend = toAbsolute(shapePoint(op.slot, state.ins, 'defend'));
      state.attackInfluence.push(influenceRow(attack, op.sentOff));
      state.defendInfluence.push(influenceRow(defend, op.sentOff));
      state.attackZone.push(clamp(Math.floor(attack.x), 0, ROWS - 1) * COLS + clamp(Math.floor(attack.y), 0, COLS - 1));
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

  /** スタミナ、その日の出来、ホームの後押しを反映した能力値 */
  private attr(side: Side, op: OnPitch, key: AttributeKey): number {
    const home = side === 0 ? C.homeAdvantage : 1;
    // 能力の差がそのまま出すぎないよう、平均からの差を少し縮める（番狂わせが起きる余地を残す）
    const raw = op.player.attributes[key];
    const value = C.attributeCenter + (raw - C.attributeCenter) * C.attributeSpread;
    return value * home * op.form * (0.72 + 0.28 * (op.stamina / 100));
  }

  private defendScore(side: Side, op: OnPitch): number {
    const a = (k: AttributeKey) => this.attr(side, op, k);
    return 0.35 * a('tackling') + 0.3 * a('positioning') + 0.15 * a('concentration') + 0.1 * a('pace') + 0.1 * a('strength');
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
    let sum = 0;
    for (let i = 0; i < scores.length; i++) {
      sum += (state.defendInfluence[i]?.[zone] ?? 0) * (scores[i] ?? 0);
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
    if (carrier.position !== 'GK' && this.tryDispossess(att, def, f, presHere)) {
      this.tick(Math.max(1.5, C.secondsPerAction + this.rng.next() * 2 - 1), att);
      return;
    }
    const action = carrier.position === 'GK' ? 'pass' : this.chooseAction(att, carrier, f, presHere);

    switch (action) {
      case 'pass': this.doPass(att, def, f, presHere); break;
      case 'dribble': this.doDribble(att, def, f); break;
      case 'shoot': this.doShot(att, def, f, 'open', this.holder, null, presHere); break;
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
    const chance = C.dispossession.base * Math.max(0, pressure - 0.4)
      * (f.r === ROWS - 1 ? C.dispossession.boxMultiplier : 1) * (1.5 - keep / 20);
    if (!this.rng.chance(chance)) return false;
    const defenderIndex = this.pickDefender(def, this.zone, f.r === ROWS - 1);
    const defender = this.op(def, defenderIndex);
    defender.stats.tackles++;
    defender.stats.rating += 0.05;
    this.sides[def].stats.tackles++;
    carrier.stats.rating -= 0.03;
    this.say('tackle', def, 1, { p: carrier.player.name, q: defender.player.name });
    this.turnover(def, defenderIndex, this.zone, true);
    return true;
  }

  private chooseAction(att: Side, op: OnPitch, f: Frame, pressure: number): Action {
    const W = C.weights;
    const ins = this.sides[att].ins;
    const a = (k: AttributeKey) => this.attr(att, op, k);
    const central = f.c >= 1 && f.c <= 3;
    const wide = f.c === 0 || f.c === COLS - 1;

    const shootBias = SHOOT_TENDENCY[op.position] * (a('shooting') / 12) * (1 + 0.12 * ins.mentality);
    let shoot = 0;
    if (f.r === 5) shoot = (central ? W.shotInBox : W.shotInBoxWide) * shootBias;
    else if (f.r === 4) shoot = (central ? W.shotOutsideBox : W.shotOutsideBoxWide) * shootBias;

    const cross = wide && f.r >= 3
      ? (f.r >= 4 ? W.cross : W.earlyCross) * (a('crossing') / 12) * (1 + 0.12 * ins.width)
      : 0;
    const dribble = W.dribble * DRIBBLE_TENDENCY[op.position] * (a('dribbling') / 12)
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
      let forward = dr > 0 ? 1 + 0.45 * dr * (1 + 0.15 * ins.tempo + 0.1 * ins.mentality)
        : dr === 0 ? 0.75 : 0.4 * (1 - 0.12 * ins.tempo);
      if (dr >= 2) forward *= vision / 12;
      const receiver = this.op(att, j);
      const sup = (state.attackInfluence[j]?.[tz] ?? 0) * this.supportScore(att, receiver) / C.zoneStrengthScale;
      const open = sup / (sup + this.pressure(def, tz) + 0.1);
      const boxWeight = this.frame(att, tz).r === ROWS - 1 && f.r < ROWS - 1 ? C.pass.boxTargetWeight : 1;
      return Math.exp(-dist * C.pass.distanceDecay * lengthPreference) * forward * open * boxWeight;
    });
    const { tz, tf, dr, dist } = targetInfo(target);
    const receiver = this.op(att, target);

    passer.stats.passes++;
    state.stats.passes++;

    // オフサイド（相手のラインが高いほど起きやすい）
    if (tf.r >= 4 && dr >= 2 &&
      this.rng.chance(Math.max(0.01, C.offside.base + C.offside.perLineStep * defIns.defensiveLine))) {
      state.stats.offsides++;
      this.say('offside', att, 1, { p: receiver.player.name });
      this.stoppage += 15;
      this.turnover(def, this.pickDefender(def, tz, false), tz, false);
      return;
    }

    const a = (k: AttributeKey) => this.attr(att, passer, k);
    const quality = 0.5 * a('passing') + 0.25 * a('vision') + 0.25 * a('decisions');
    const success = clamp(
      C.pass.base - C.pass.distancePenalty * dist + 0.012 * (quality - 12)
        - C.pass.pressurePenalty * presHere - C.pass.pressureDistancePenalty * presHere * dist
        - 0.07 * (this.pressure(def, tz) - 0.8)
        - C.pass.forwardPenalty * Math.max(0, dr) + 0.004 * (this.attr(att, receiver, 'firstTouch') - 12)
        - (tf.r === ROWS - 1 && f.r < ROWS - 1 ? C.pass.boxEntryPenalty : 0),
      0.35, 0.97,
    );

    if (this.rng.chance(success)) {
      passer.stats.passesCompleted++;
      passer.stats.rating += 0.01;
      state.stats.passesCompleted++;
      if (dr >= 2 && tf.r >= 3) {
        this.say('throughBall', att, 1, { p: passer.player.name, q: receiver.player.name });
      }
      this.holder = target;
      this.zone = tz;
      this.lastPasser = passerIndex;
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
    const keeperQuality = keeper
      ? 0.6 * this.attr(def, keeper, 'reflexes') + 0.2 * this.attr(def, keeper, 'oneOnOne') + 0.2 * this.attr(def, keeper, 'handling')
      : 5;

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

  private doCross(att: Side, def: Side): void {
    const crosserIndex = this.holder;
    const crosser = this.op(att, crosserIndex);
    const tz = this.toZone(att, ROWS - 1, this.rng.weighted([1, 2, 3], (c) => (c === 2 ? 2 : 1)));
    this.say('cross', att, 1, { p: crosser.player.name });

    const state = this.sides[att];
    const aerial = (side: Side, op: OnPitch) => 0.5 * this.attr(side, op, 'heading') + 0.5 * this.attr(side, op, 'jumping');
    const targets = this.active(att, (op, i) => i !== crosserIndex && op.position !== 'GK');
    const targetIndex = this.rng.weighted(targets, (i) =>
      ((state.attackInfluence[i]?.[tz] ?? 0) + 0.05) * aerial(att, this.op(att, i)));
    const target = this.op(att, targetIndex);
    const defenderIndex = this.pickDefender(def, tz, false);
    const duel = aerial(att, target) - aerial(def, this.op(def, defenderIndex));

    const reach = clamp(C.cross.base + 0.02 * (this.attr(att, crosser, 'crossing') - 12)
      + 0.025 * duel - 0.08 * (this.pressure(def, tz) - 1), 0.1, 0.55);
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
    const takerIndex = field.reduce((best, i) =>
      this.op(att, i).player.attributes.crossing > this.op(att, best).player.attributes.crossing ? i : best);
    if (this.rng.chance(C.cornerShotChance)) {
      const aerial = (side: Side, op: OnPitch) => 0.5 * this.attr(side, op, 'heading') + 0.5 * this.attr(side, op, 'jumping');
      const headerIndex = this.rng.weighted(field.filter((i) => i !== takerIndex), (i) => aerial(att, this.op(att, i)) ** 2);
      const tz = this.toZone(att, ROWS - 1, 2);
      const defender = this.op(def, this.pickDefender(def, tz, false));
      const duel = aerial(att, this.op(att, headerIndex)) - aerial(def, defender);
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
      const field = this.active(att, (op) => op.position !== 'GK');
      const takerIndex = field.reduce((best, i) =>
        this.op(att, i).player.attributes.shooting > this.op(att, best).player.attributes.shooting ? i : best);
      if (this.rng.chance(0.5)) {
        this.doShot(att, def, f, 'freeKick', takerIndex, C.freeKickXg, 0.8);
      } else {
        this.holder = takerIndex;
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
    const takerIndex = this.active(att, (op) => op.position !== 'GK').reduce((best, i) => {
      const score = (op: OnPitch) => op.player.attributes.shooting + op.player.attributes.composure;
      return score(this.op(att, i)) > score(this.op(att, best)) ? i : best;
    });
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
    this.score[att]++;
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
    text += `　${this.score[0]}-${this.score[1]}`;
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
    if (wonInPlay && this.frame(newSide, zone).r >= 3) {
      this.sides[newSide].stats.highRecoveries++;
    }
  }

  private tick(seconds: number, possessing: Side): void {
    this.clock += seconds;
    this.sides[possessing].stats.possessionSeconds += seconds;
    for (const state of this.sides) {
      const ins = state.ins;
      const intensity = 1 + 0.12 * ins.pressing + 0.04 * ins.tempo;
      for (const op of state.players) {
        if (op.sentOff) continue;
        const { stamina, workRate } = op.player.attributes;
        const drain = C.staminaDrainPerMinute * (1.3 - 0.6 * stamina / 20) * (0.8 + 0.4 * workRate / 20) * intensity;
        op.stamina = Math.max(0, op.stamina - drain * seconds / 60);
      }
    }
  }

  // ---- 実況 ----

  private minuteLabel(): string {
    if (this.half === 1 && this.clock >= HALF) return `45+${Math.floor((this.clock - HALF) / 60) + 1}'`;
    if (this.half === 2 && this.clock >= 2 * HALF) return `90+${Math.floor((this.clock - 2 * HALF) / 60) + 1}'`;
    return `${Math.floor(this.clock / 60) + 1}'`;
  }

  private say(key: CommentaryKey, side: Side | null, importance: 1 | 2 | 3, names: CommentaryNames): void {
    if (importance === 1 && !this.detailed) return;
    this.pushEvent(EVENT_TYPE[key], side, importance, commentary(this.rng, key, names));
  }

  private pushEvent(type: MatchEventType, side: Side | null, importance: 1 | 2 | 3, text: string): void {
    this.events.push({ clock: this.clock, minute: this.minuteLabel(), side, type, importance, text });
  }

  // ---- 試合終了 ----

  private finish(): MatchResult {
    const result = (side: Side) => Math.sign(this.score[side] - this.score[other(side)]);
    this.sides.forEach((state, sideIndex) => {
      const side = sideIndex as Side;
      const onPitch = state.players.filter((op) => !op.sentOff);
      state.stats.staminaAtEnd = onPitch.reduce((sum, op) => sum + op.stamina, 0) / Math.max(1, onPitch.length);
      state.stats.xg = Math.round(state.stats.xg * 100) / 100;
      const cleanSheet = this.score[other(side)] === 0;
      for (const op of state.players) {
        if (cleanSheet && op.position === 'GK') op.stats.rating += 0.4;
        if (cleanSheet && (op.position === 'CB' || op.position === 'SB')) op.stats.rating += 0.25;
        op.stats.rating += 0.2 * result(side);
        op.stats.rating = Math.round(clamp(op.stats.rating, 3, 10) * 10) / 10;
      }
    });
    const [home, away] = this.sides;
    return {
      seed: this.seed,
      teams: [home.team, away.team],
      score: [this.score[0], this.score[1]],
      stats: [home.stats, away.stats],
      players: this.sides.flatMap((state, side) =>
        state.players.map((op) => ({ side: side as Side, player: op.player, position: op.position, stats: op.stats }))),
      events: this.events,
    };
  }
}
