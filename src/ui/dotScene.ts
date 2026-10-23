// ドット絵のピッチ（要件定義書「観戦の強化（1.2〜）」）。メインスタンドから見下ろす斜めの角度で、低い解像度の絵を描き、
// 画面では整数倍に拡大してドットを見せる。試合の計算（エンジン）は変えず、1手ごとの状態（スナップショット）と出来事から描く。
// 1手の間は、選手は次の立ち位置へ走り、ボールはパスやシュートの軌道で飛ぶ。持ち主が変われば、パスか奪い合いとみなす。
// 文字（背番号、ボールを持つ選手の名前）は、読みやすいように重ねたもう1枚のキャンバスに、画面の解像度で描く。

import type { LiveSnapshot } from '../engine/match';
import type { MatchEvent, Side } from '../engine/types';
import { pitchSpots, noise } from './pitchModel';
import { RUN_FRAMES, SPRITE_H, SPRITE_W, spritePixels, type Facing, type Pose, type SpriteLook } from './sprites';
import type { CameraMode } from './settings';

const PITCH_L = 105;
const PITCH_W = 68;
const GOAL_HALF = 3.66;
const GOAL_H = 2.44;

export interface DotPlayerInfo {
  side: Side;
  name: string;
  look: SpriteLook;
}

export interface DotSceneOptions {
  /** スタンドの埋まり具合（0〜1） */
  crowdFill: number;
  /** ホームとアウェイのクラブの色（スタンド、看板） */
  homeColors: [string, string];
  awayColors: [string, string];
  seed: number;
}

/** 0〜1の時間を、なめらかに加速・減速する形に */
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** エンジンの座標（縦0〜6、横0〜5）をメートルに */
const toMeters = (x: number, y: number) => ({ x: (x / 6) * PITCH_L, y: (y / 5) * PITCH_W });

interface Actor {
  id: string;
  side: Side;
  /** GKの枠にいる */
  keeper: boolean;
  fromX: number; fromY: number;
  toX: number; toY: number;
  x: number; y: number;
  facing: Facing;
  flip: boolean;
  runDistance: number;
  moving: boolean;
}

interface BallState {
  fromX: number; fromY: number;
  toX: number; toY: number;
  peak: number;
  t0: number;
  duration: number;
  /** 飛び終わったあと足元に付く選手（null なら転がったまま） */
  holderId: string | null;
  x: number; y: number; h: number;
}

interface Geometry {
  bw: number; bh: number;
  /** 手前のタッチラインでのピッチの幅、奥行き、上下の位置 */
  width: number; top: number; bottom: number;
  /** 1メートルあたりのドット（手前） */
  unit: number;
}

/** 決まった値の乱数（スタンドの客の並びを毎回同じにする） */
function seeded(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const spriteCache = new Map<string, HTMLCanvasElement>();

function spriteCanvas(look: SpriteLook, facing: Facing, pose: Pose): HTMLCanvasElement {
  const key = `${JSON.stringify(look)}|${facing}|${pose.kind}|${pose.kind === 'stand' ? 0 : pose.frame}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_W;
  canvas.height = SPRITE_H;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    spritePixels(look, facing, pose).forEach((color, i) => {
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(i % SPRITE_W, Math.floor(i / SPRITE_W), 1, 1);
    });
  }
  if (spriteCache.size > 4000) spriteCache.clear();
  spriteCache.set(key, canvas);
  return canvas;
}

const SHOTS = new Set<MatchEvent['type']>(['goal', 'penaltyGoal', 'shotSaved', 'shotOff', 'shotBlocked', 'penaltyMissed']);

export class DotScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLCanvasElement;
  private readonly options: DotSceneOptions;
  private readonly infoOf: (id: string) => DotPlayerInfo | undefined;
  private geometry: Geometry = { bw: 640, bh: 360, width: 560, top: 90, bottom: 340, unit: 5.3 };
  private scale = 1;
  private dpr = 1;
  private backgrounds: HTMLCanvasElement[] = [];
  private actors = new Map<string, Actor>();
  private ball: BallState = { fromX: 52.5, fromY: 34, toX: 52.5, toY: 34, peak: 0, t0: 0, duration: 1, holderId: null, x: 52.5, y: 34, h: 0 };
  private holderId: string | null = null;
  private holderSide: Side = 0;
  private camera: CameraMode = 'whole';
  private cam = { x: 320, y: 200, zoom: 1 };
  private lastFrame = 0;
  private raf = 0;
  private celebration: { side: Side; until: number } | null = null;
  private shotAt = 0;
  private attacking = false;
  /** 描いたコマの数（なめらかさを確かめるのに使う） */
  frames = 0;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, options: DotSceneOptions, infoOf: (id: string) => DotPlayerInfo | undefined) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.options = options;
    this.infoOf = infoOf;
  }

  // ---- 大きさと映し方 ----

  /** 画面の大きさ（CSSピクセル）に合わせて、低い解像度の絵の大きさと拡大の倍率を決める */
  resize(width: number, height: number, dpr: number): void {
    const scale = Math.max(1, Math.round(width / 640));
    const bw = Math.max(160, Math.ceil(width / scale));
    const bh = Math.max(100, Math.ceil(height / scale));
    this.scale = scale;
    this.dpr = dpr;
    this.canvas.width = bw;
    this.canvas.height = bh;
    this.overlay.width = Math.round(width * dpr);
    this.overlay.height = Math.round(height * dpr);
    // 奥行きは手前の幅の0.43倍ほど。横に長い画面では高さで、縦に長い画面では幅で決める
    const depth = Math.min(bh * 0.7, (bw * 0.88) * 0.43);
    const pitchWidth = depth / 0.43;
    const bottom = bh - Math.max(8, bh * 0.06);
    this.geometry = { bw, bh, width: pitchWidth, top: bottom - depth, bottom, unit: pitchWidth / PITCH_L };
    this.backgrounds = [this.paintBackground(false), this.paintBackground(true)];
    this.cam = { x: bw / 2, y: (this.geometry.top + bottom) / 2, zoom: 1 };
  }

  setCamera(mode: CameraMode): void {
    this.camera = mode;
  }

  /** 手前ほど大きく見せる倍率（奥 0.78、手前 1） */
  private depthScale(y: number): number {
    return 0.78 + 0.22 * clamp(y / PITCH_W, -0.2, 1.2);
  }

  /** ピッチの上の点（メートル、高さ）を、絵の上の点（倍率1のとき）に */
  private project(x: number, y: number, h = 0): { x: number; y: number; s: number } {
    const g = this.geometry;
    const t = y / PITCH_W;
    const s = this.depthScale(y);
    const px = g.bw / 2 + (x - PITCH_L / 2) * g.unit * s;
    const py = g.top + (g.bottom - g.top) * (t * (0.8 + 0.2 * t)) - h * g.unit * s * 0.9;
    return { x: px, y: py, s };
  }

  /** カメラを通した画面の上の点 */
  private view(p: { x: number; y: number }): { x: number; y: number } {
    const g = this.geometry;
    return { x: (p.x - this.cam.x) * this.cam.zoom + g.bw / 2, y: (p.y - this.cam.y) * this.cam.zoom + g.bh / 2 };
  }

  // ---- 背景（芝生、ライン、ゴール、スタンド、看板） ----

  private paintBackground(jump: boolean): HTMLCanvasElement {
    const g = this.geometry;
    const bg = document.createElement('canvas');
    bg.width = g.bw;
    bg.height = g.bh;
    const ctx = bg.getContext('2d');
    if (!ctx) return bg;
    ctx.imageSmoothingEnabled = false;
    const rand = seeded(this.options.seed);
    const [home1, home2] = this.options.homeColors;
    const [away1, away2] = this.options.awayColors;

    // 空と屋根、スタンドの地
    ctx.fillStyle = '#1d2433';
    ctx.fillRect(0, 0, g.bw, g.bh);
    const farLeft = this.project(-6, -3);
    const farRight = this.project(PITCH_L + 6, -3);
    const standTop = Math.max(4, Math.round(g.top * 0.12));
    ctx.fillStyle = '#3a4357';
    ctx.fillRect(0, standTop, g.bw, Math.round(farLeft.y) - standTop);
    ctx.fillStyle = '#2b3243';
    ctx.fillRect(0, standTop - 3, g.bw, 3);

    // 客席：奥のスタンドは段ごとに並べる。埋まり具合で客の数が変わり、ホームのゴール裏はクラブの色が多い
    const fill = clamp(this.options.crowdFill, 0.05, 1);
    const crowdColors = ['#d9d4c7', '#2f3a52', '#7a2f2f', '#e0b04a', '#3b6e47', '#1f1f24', '#c9c3d6', '#5a4a3a'];
    const seat = (x: number, y: number, homeBias: number, awayBias: number) => {
      const r = rand();
      if (r > fill) {
        ctx.fillStyle = '#56607a';
        ctx.fillRect(x, y, 2, 2);
        return;
      }
      const pick = rand();
      const color = pick < homeBias ? (rand() < 0.6 ? home1 : home2) : pick < homeBias + awayBias ? (rand() < 0.6 ? away1 : away2) : crowdColors[Math.floor(rand() * crowdColors.length)] as string;
      const lift = jump && rand() < 0.7 ? 1 : 0;
      ctx.fillStyle = '#e3b48c';
      ctx.fillRect(x, y - lift, 2, 1);
      ctx.fillStyle = color;
      ctx.fillRect(x, y + 1 - lift, 2, 1);
    };
    for (let y = standTop + 2; y < farLeft.y - 4; y += 3) {
      for (let x = 1; x < g.bw - 1; x += 3) {
        // 左のゴール裏はホーム、右の端はアウェイの応援席
        const along = x / g.bw;
        seat(x, y, along < 0.22 ? 0.75 : 0.18, along > 0.84 ? 0.55 : 0.04);
      }
    }
    // 屋根の影の線
    ctx.fillStyle = '#141925';
    ctx.fillRect(0, standTop, g.bw, 1);

    // ゴール裏のスタンド（左右の端）
    const sideStand = (left: boolean) => {
      const near = this.project(left ? -4 : PITCH_L + 4, PITCH_W + 4);
      const far = this.project(left ? -4 : PITCH_L + 4, -3);
      const edge = left ? 0 : g.bw;
      ctx.fillStyle = '#323b4f';
      ctx.beginPath();
      ctx.moveTo(edge, far.y);
      ctx.lineTo(far.x, far.y);
      ctx.lineTo(near.x, near.y);
      ctx.lineTo(edge, near.y);
      ctx.closePath();
      ctx.fill();
      for (let y = Math.round(far.y) + 2; y < near.y - 2; y += 3) {
        const t = (y - far.y) / Math.max(1, near.y - far.y);
        const inner = far.x + (near.x - far.x) * t;
        const from = left ? 1 : Math.round(inner) + 2;
        const to = left ? Math.round(inner) - 3 : g.bw - 2;
        for (let x = from; x < to; x += 3) seat(x, y, left ? 0.8 : 0.1, left ? 0.02 : 0.6);
      }
    };
    sideStand(true);
    sideStand(false);

    // 芝生：横に縞を入れる（遠近に合わせた台形）
    const stripes = 14;
    for (let i = 0; i < stripes; i++) {
      const x0 = (PITCH_L / stripes) * i;
      const x1 = (PITCH_L / stripes) * (i + 1);
      const a = this.project(x0 - (i === 0 ? 4 : 0), -3);
      const b = this.project(x1 + (i === stripes - 1 ? 4 : 0), -3);
      const c = this.project(x1 + (i === stripes - 1 ? 4 : 0), PITCH_W + 4);
      const d = this.project(x0 - (i === 0 ? 4 : 0), PITCH_W + 4);
      ctx.fillStyle = i % 2 === 0 ? '#3f8f3a' : '#479c41';
      ctx.beginPath();
      ctx.moveTo(Math.round(a.x), Math.round(a.y));
      ctx.lineTo(Math.round(b.x), Math.round(b.y));
      ctx.lineTo(Math.round(c.x), Math.round(c.y));
      ctx.lineTo(Math.round(d.x), Math.round(d.y));
      ctx.closePath();
      ctx.fill();
    }

    // 看板（奥と手前）
    const boards = (y: number, height: number) => {
      const left = this.project(-4, y);
      const right = this.project(PITCH_L + 4, y);
      const segments = 10;
      for (let i = 0; i < segments; i++) {
        const x0 = Math.round(left.x + ((right.x - left.x) * i) / segments);
        const x1 = Math.round(left.x + ((right.x - left.x) * (i + 1)) / segments);
        ctx.fillStyle = i % 3 === 0 ? home1 : i % 3 === 1 ? '#f2f2f2' : home2;
        ctx.fillRect(x0, Math.round(left.y) - height, x1 - x0, height);
        ctx.fillStyle = i % 3 === 1 ? home1 : '#f2f2f2';
        ctx.fillRect(x0 + 3, Math.round(left.y) - height + Math.floor(height / 2) - 1, Math.max(1, x1 - x0 - 6), 2);
      }
    };
    boards(-2.5, 4);

    // ライン
    ctx.strokeStyle = '#f4f7f2';
    ctx.lineWidth = 1;
    const line = (points: [number, number][], close = false) => {
      ctx.beginPath();
      points.forEach(([x, y], i) => {
        const p = this.project(x, y);
        const px = Math.round(p.x) + 0.5;
        const py = Math.round(p.y) + 0.5;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      if (close) ctx.closePath();
      ctx.stroke();
    };
    line([[0, 0], [PITCH_L, 0], [PITCH_L, PITCH_W], [0, PITCH_W]], true);
    line([[PITCH_L / 2, 0], [PITCH_L / 2, PITCH_W]]);
    const circle = (cx: number, cy: number, r: number, from = 0, to = Math.PI * 2) => {
      const points: [number, number][] = [];
      for (let i = 0; i <= 40; i++) {
        const a = from + ((to - from) * i) / 40;
        points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      line(points);
    };
    circle(PITCH_L / 2, PITCH_W / 2, 9.15);
    for (const end of [0, PITCH_L]) {
      const dir = end === 0 ? 1 : -1;
      line([[end, PITCH_W / 2 - 20.15], [end + dir * 16.5, PITCH_W / 2 - 20.15], [end + dir * 16.5, PITCH_W / 2 + 20.15], [end, PITCH_W / 2 + 20.15]]);
      line([[end, PITCH_W / 2 - 9.15], [end + dir * 5.5, PITCH_W / 2 - 9.15], [end + dir * 5.5, PITCH_W / 2 + 9.15], [end, PITCH_W / 2 + 9.15]]);
      const spot = this.project(end + dir * 11, PITCH_W / 2);
      ctx.fillStyle = '#f4f7f2';
      ctx.fillRect(Math.round(spot.x), Math.round(spot.y), 1, 1);
      // ペナルティアーク
      circle(end + dir * 11, PITCH_W / 2, 9.15, dir > 0 ? -0.93 : Math.PI - 0.93, dir > 0 ? 0.93 : Math.PI + 0.93);
    }
    const center = this.project(PITCH_L / 2, PITCH_W / 2);
    ctx.fillStyle = '#f4f7f2';
    ctx.fillRect(Math.round(center.x), Math.round(center.y), 1, 1);

    // ゴール（ネットとポスト）
    for (const end of [0, PITCH_L]) {
      const back = end === 0 ? -2 : PITCH_L + 2;
      ctx.strokeStyle = 'rgba(235, 240, 245, 0.55)';
      for (let i = 0; i <= 6; i++) {
        const y = PITCH_W / 2 - GOAL_HALF + (GOAL_HALF * 2 * i) / 6;
        const top = this.project(back, y, GOAL_H * 0.8);
        const bottomPoint = this.project(back, y, 0);
        ctx.beginPath();
        ctx.moveTo(Math.round(top.x) + 0.5, Math.round(top.y) + 0.5);
        ctx.lineTo(Math.round(bottomPoint.x) + 0.5, Math.round(bottomPoint.y) + 0.5);
        ctx.stroke();
      }
      for (let h = 0; h <= 3; h++) {
        const a = this.project(back, PITCH_W / 2 - GOAL_HALF, (GOAL_H * 0.8 * h) / 3);
        const b = this.project(back, PITCH_W / 2 + GOAL_HALF, (GOAL_H * 0.8 * h) / 3);
        ctx.beginPath();
        ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5);
        ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5);
        ctx.stroke();
      }
      ctx.strokeStyle = '#ffffff';
      const post = (y: number) => {
        const foot = this.project(end, y, 0);
        const head = this.project(end, y, GOAL_H);
        ctx.beginPath();
        ctx.moveTo(Math.round(foot.x) + 0.5, Math.round(foot.y) + 0.5);
        ctx.lineTo(Math.round(head.x) + 0.5, Math.round(head.y) + 0.5);
        ctx.stroke();
        return head;
      };
      const a = post(PITCH_W / 2 - GOAL_HALF);
      const b = post(PITCH_W / 2 + GOAL_HALF);
      ctx.beginPath();
      ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5);
      ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5);
      ctx.stroke();
    }

    // 手前の看板（タッチラインの外）
    const nearBoard = this.project(-4, PITCH_W + 3.5);
    const nearRight = this.project(PITCH_L + 4, PITCH_W + 3.5);
    const height = Math.max(3, Math.round(g.unit * 1.1));
    for (let i = 0; i < 12; i++) {
      const x0 = Math.round(nearBoard.x + ((nearRight.x - nearBoard.x) * i) / 12);
      const x1 = Math.round(nearBoard.x + ((nearRight.x - nearBoard.x) * (i + 1)) / 12);
      ctx.fillStyle = i % 2 === 0 ? home1 : '#20263a';
      ctx.fillRect(x0, Math.round(nearBoard.y), x1 - x0, height);
      ctx.fillStyle = i % 2 === 0 ? '#f2f2f2' : home2;
      ctx.fillRect(x0 + 4, Math.round(nearBoard.y) + Math.floor(height / 2) - 1, Math.max(1, x1 - x0 - 8), 2);
    }
    ctx.fillStyle = '#141925';
    ctx.fillRect(0, Math.round(nearBoard.y) + height, g.bw, g.bh);
    return bg;
  }

  // ---- 1手ごとの更新 ----

  /** 次の手の状態を受け取り、選手とボールの動きを決める。duration はその手を見せる時間（ミリ秒） */
  step(snapshot: LiveSnapshot, newEvents: readonly MatchEvent[], duration: number): void {
    const now = performance.now();
    this.updatePositions(now);
    const { spots, ball } = pitchSpots(snapshot, 0.22);
    const seen = new Set<string>();
    for (const spot of spots) {
      const target = toMeters(spot.x, spot.y);
      seen.add(spot.id);
      let actor = this.actors.get(spot.id);
      if (!actor) {
        // 途中出場の選手は、手前のタッチラインから入ってくる
        const start = this.actors.size === 0 ? target : { x: PITCH_L / 2, y: PITCH_W + 2 };
        actor = { id: spot.id, side: spot.side, keeper: spot.goalkeeper, fromX: start.x, fromY: start.y, toX: start.x, toY: start.y, x: start.x, y: start.y, facing: 'down', flip: false, runDistance: 0, moving: false };
        this.actors.set(spot.id, actor);
      }
      actor.keeper = spot.goalkeeper;
      actor.fromX = actor.x;
      actor.fromY = actor.y;
      actor.toX = target.x;
      actor.toY = target.y;
    }
    for (const id of [...this.actors.keys()]) if (!seen.has(id)) this.actors.delete(id);
    this.moveStart = now;
    this.moveDuration = Math.max(80, duration);

    // ボール
    const shot = newEvents.find((e) => SHOTS.has(e.type) && e.side !== null);
    const groundBall = { x: this.ball.x, y: this.ball.y };
    const holderTarget = snapshot.ball.holderId ? this.actors.get(snapshot.ball.holderId) : undefined;
    const ballTarget = toMeters(ball.x, ball.y);
    if (shot && shot.side !== null) {
      this.shotAt = now;
      const shooter = shot.playerId ? this.actors.get(shot.playerId) : undefined;
      const from = shooter ? { x: shooter.fromX, y: shooter.fromY } : groundBall;
      const goalX = shot.side === 0 ? PITCH_L : 0;
      const into = shot.side === 0 ? 1.2 : -1.2;
      const offsetY = (noise(`${shot.clock}:shot`) - 0.5) * GOAL_HALF * 1.6;
      let to = { x: goalX + into, y: PITCH_W / 2 + offsetY };
      let peak = 1.4;
      if (shot.type === 'shotSaved' || shot.type === 'penaltyMissed') {
        const keeper = [...this.actors.values()].find((a) => a.side !== shot.side && a.keeper);
        to = keeper ? { x: keeper.toX, y: keeper.toY } : { x: goalX - into * 2, y: PITCH_W / 2 };
        peak = 1.1;
      } else if (shot.type === 'shotOff') {
        const post = /ポスト|バー/.test(shot.text);
        to = post ? { x: goalX, y: PITCH_W / 2 + (offsetY >= 0 ? GOAL_HALF : -GOAL_HALF) } : { x: goalX + into * 2.5, y: PITCH_W / 2 + Math.sign(offsetY || 1) * (GOAL_HALF + 2 + Math.abs(offsetY)) };
        peak = /ゴールの上|バー/.test(shot.text) ? 3.2 : 1.6;
      } else if (shot.type === 'shotBlocked') {
        to = { x: from.x + (goalX - from.x) * 0.25, y: from.y + (PITCH_W / 2 - from.y) * 0.2 };
        peak = 0.4;
      } else if (shot.type === 'goal' || shot.type === 'penaltyGoal') {
        this.celebration = { side: shot.side, until: now + 2600 };
      }
      this.launch(from, to, peak, Math.min(Math.max(260, duration * 0.8), 700), null, now);
    } else if (snapshot.ball.holderId !== this.holderId) {
      // 持ち主が変わった：同じチームならパス、違えば奪い合い
      const to = holderTarget ? { x: holderTarget.toX, y: holderTarget.toY } : ballTarget;
      const distance = Math.hypot(to.x - groundBall.x, to.y - groundBall.y);
      const pass = snapshot.ball.side === this.holderSide && this.holderId !== null;
      const peak = pass ? (distance > 32 ? 5 : distance > 18 ? 1.6 : 0.15) : 0.3;
      this.launch(groundBall, to, peak, Math.max(120, duration * 0.85), snapshot.ball.holderId, now);
    } else if (this.ball.holderId === null && snapshot.ball.holderId) {
      this.launch(groundBall, holderTarget ? { x: holderTarget.toX, y: holderTarget.toY } : ballTarget, 0.2, Math.max(120, duration * 0.85), snapshot.ball.holderId, now);
    }
    this.holderId = snapshot.ball.holderId;
    this.holderSide = snapshot.ball.side;
    const forward = snapshot.ball.side === 0 ? ball.x : 6 - ball.x;
    this.attacking = forward >= 4.5;
    if (snapshot.phase === 'halftime' || snapshot.phase === 'finished') this.attacking = false;
  }

  private moveStart = 0;
  private moveDuration = 400;

  private launch(from: { x: number; y: number }, to: { x: number; y: number }, peak: number, duration: number, holderId: string | null, now: number): void {
    this.ball = { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, peak, t0: now, duration, holderId, x: from.x, y: from.y, h: 0 };
  }

  private updatePositions(now: number): void {
    const t = ease((now - this.moveStart) / this.moveDuration);
    for (const actor of this.actors.values()) {
      const x = actor.fromX + (actor.toX - actor.fromX) * t;
      const y = actor.fromY + (actor.toY - actor.fromY) * t;
      const dx = x - actor.x;
      const dy = y - actor.y;
      const moved = Math.hypot(dx, dy);
      actor.moving = moved > 0.02;
      if (actor.moving) {
        actor.runDistance += moved;
        if (Math.abs(dx) >= Math.abs(dy) * 0.9) {
          actor.facing = 'side';
          actor.flip = dx < 0;
        } else {
          actor.facing = dy < 0 ? 'up' : 'down';
        }
      }
      actor.x = x;
      actor.y = y;
    }
    // ボール
    const b = this.ball;
    const p = clamp((now - b.t0) / b.duration, 0, 1);
    const holder = b.holderId ? this.actors.get(b.holderId) : undefined;
    if (p < 1 || !holder) {
      const e = p;
      b.x = b.fromX + (b.toX - b.fromX) * e;
      b.y = b.fromY + (b.toY - b.fromY) * e;
      b.h = 4 * b.peak * e * (1 - e);
    } else {
      // 足元に付く（向いている方へ少し前）
      const ahead = holder.facing === 'side' ? (holder.flip ? -0.9 : 0.9) : 0;
      b.x = holder.x + ahead;
      b.y = holder.y + (holder.facing === 'down' ? 0.7 : holder.facing === 'up' ? -0.5 : 0.3);
      b.h = 0;
    }
    // 止まっている選手はボールの方を向く
    for (const actor of this.actors.values()) {
      if (actor.moving || actor.id === b.holderId) continue;
      const dx = b.x - actor.x;
      const dy = b.y - actor.y;
      if (Math.abs(dx) >= Math.abs(dy)) {
        actor.facing = 'side';
        actor.flip = dx < 0;
      } else actor.facing = dy < 0 ? 'up' : 'down';
    }
  }

  // ---- 描く ----

  start(): void {
    const loop = (now: number) => {
      this.draw(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private updateCamera(now: number, dt: number): void {
    const g = this.geometry;
    const ballPoint = this.project(this.ball.x, this.ball.y);
    const center = { x: g.bw / 2, y: (g.top + g.bottom) / 2 };
    let target = { x: center.x, y: center.y, zoom: 1 };
    if (this.camera === 'follow') {
      target = { x: ballPoint.x, y: ballPoint.y - 6, zoom: 2 };
    } else if (this.attacking || now - this.shotAt < 1600 || (this.celebration && now < this.celebration.until)) {
      // 全体のときも、見せ場（相手ゴールに近い場面、シュート、ゴール）では寄る
      target = { x: center.x + (ballPoint.x - center.x) * 0.65, y: center.y + (ballPoint.y - center.y) * 0.5, zoom: 1.35 };
    }
    const k = 1 - Math.exp(-dt * 2.6);
    this.cam.zoom += (target.zoom - this.cam.zoom) * k;
    this.cam.x += (target.x - this.cam.x) * k;
    this.cam.y += (target.y - this.cam.y) * k;
    // 画面の外（何もないところ）を映さない
    const halfW = g.bw / 2 / this.cam.zoom;
    const halfH = g.bh / 2 / this.cam.zoom;
    this.cam.x = clamp(this.cam.x, halfW, g.bw - halfW);
    this.cam.y = clamp(this.cam.y, halfH, g.bh - halfH);
  }

  private draw(now: number): void {
    const ctx = this.canvas.getContext('2d');
    const octx = this.overlay.getContext('2d');
    if (!ctx || !octx) return;
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0.016;
    this.lastFrame = now;
    this.frames++;
    this.updatePositions(now);
    this.updateCamera(now, dt);
    const g = this.geometry;
    const z = this.cam.zoom;
    ctx.imageSmoothingEnabled = false;

    // 背景（ゴールのあとは、客が跳ねる絵と交互に）
    const celebrating = this.celebration !== null && now < this.celebration.until;
    const bg = this.backgrounds[celebrating && Math.floor(now / 160) % 2 === 1 ? 1 : 0];
    if (bg) {
      const sw = g.bw / z;
      const sh = g.bh / z;
      ctx.drawImage(bg, this.cam.x - sw / 2, this.cam.y - sh / 2, sw, sh, 0, 0, g.bw, g.bh);
    }

    // 選手とボールを、奥から順に描く
    const holderId = this.ball.holderId && clamp((now - this.ball.t0) / this.ball.duration, 0, 1) >= 1 ? this.ball.holderId : null;
    const items = [...this.actors.values()].sort((a, b) => a.y - b.y);
    const ballGround = this.view(this.project(this.ball.x, this.ball.y));
    const ballAir = this.view(this.project(this.ball.x, this.ball.y, this.ball.h));
    const ballScale = this.depthScale(this.ball.y) * z;
    const labels: { x: number; y: number; text: string; name?: string; color: string }[] = [];
    let ballDrawn = false;
    const drawBall = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      const r = Math.max(1, Math.round(1.3 * ballScale));
      ctx.fillRect(Math.round(ballGround.x - r), Math.round(ballGround.y), r * 2, Math.max(1, Math.round(r * 0.7)));
      const size = Math.max(2, Math.round(2.4 * ballScale));
      const bx = Math.round(ballAir.x - size / 2);
      const by = Math.round(ballAir.y - size);
      ctx.fillStyle = '#14201a';
      ctx.fillRect(bx - 1, by, size + 2, size);
      ctx.fillRect(bx, by - 1, size, size + 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bx, by, size, size);
      ctx.fillStyle = '#9aa3ad';
      ctx.fillRect(bx + size - 1, by + size - 1, 1, 1);
      ballDrawn = true;
    };
    for (const actor of items) {
      if (!ballDrawn && this.ball.y < actor.y) drawBall();
      const info = this.infoOf(actor.id);
      if (!info) continue;
      const ground = this.view(this.project(actor.x, actor.y));
      const scale = this.depthScale(actor.y) * z * (g.bw / 640) * 1.05;
      const cheering = celebrating && this.celebration?.side === actor.side && Math.hypot(actor.x - this.ball.x, actor.y - this.ball.y) < 40;
      let pose: Pose = { kind: 'stand' };
      let facing = actor.facing;
      if (cheering) {
        pose = { kind: 'cheer', frame: Math.floor(now / 200) % 2 };
        facing = 'down';
      } else if (actor.moving) {
        pose = { kind: 'run', frame: Math.floor(actor.runDistance / 0.75) % RUN_FRAMES };
      }
      const sprite = spriteCanvas(info.look, facing, pose);
      const w = Math.max(4, Math.round(SPRITE_W * scale));
      const h = Math.max(6, Math.round(SPRITE_H * scale));
      const jump = cheering && pose.kind === 'cheer' && pose.frame === 1 ? Math.round(2 * scale) : 0;
      // 影
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(Math.round(ground.x - w * 0.3), Math.round(ground.y - 1), Math.round(w * 0.6), Math.max(1, Math.round(2 * scale)));
      const left = Math.round(ground.x - w / 2);
      const top = Math.round(ground.y - h) - jump;
      if (facing === 'side' && actor.flip) {
        ctx.save();
        ctx.translate(left + w, top);
        ctx.scale(-1, 1);
        ctx.drawImage(sprite, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(sprite, left, top, w, h);
      }
      if (actor.id === holderId) {
        // 持っている選手の足元に印
        ctx.fillStyle = '#ffe14d';
        ctx.fillRect(Math.round(ground.x - w * 0.35), Math.round(ground.y), Math.round(w * 0.7), 1);
      }
      labels.push({
        x: ground.x, y: top - 1, text: info.look.number === null ? '' : String(info.look.number),
        name: actor.id === (this.ball.holderId ?? '') ? info.name : undefined, color: info.side === 0 ? this.options.homeColors[0] : this.options.awayColors[0],
      });
    }
    if (!ballDrawn) drawBall();

    // 文字（画面の解像度で）
    const unit = this.scale * this.dpr;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    octx.textAlign = 'center';
    octx.textBaseline = 'bottom';
    const numberSize = Math.round(Math.max(10, Math.min(15, 9 + z * 2.5)) * this.dpr);
    octx.font = `700 ${numberSize}px system-ui, sans-serif`;
    octx.lineWidth = Math.max(2, Math.round(2.5 * this.dpr));
    octx.strokeStyle = 'rgba(10, 16, 12, 0.85)';
    for (const label of labels) {
      const x = label.x * unit;
      const y = label.y * unit;
      if (label.text) {
        octx.strokeText(label.text, x, y);
        octx.fillStyle = '#ffffff';
        octx.fillText(label.text, x, y);
      }
      if (label.name) {
        const size = Math.round(13 * this.dpr);
        octx.font = `700 ${size}px system-ui, sans-serif`;
        const width = octx.measureText(label.name).width + 10 * this.dpr;
        const top = y - numberSize - size - 6 * this.dpr;
        octx.fillStyle = 'rgba(12, 18, 28, 0.82)';
        octx.fillRect(x - width / 2, top, width, size + 6 * this.dpr);
        octx.fillStyle = '#ffe14d';
        octx.fillText(label.name, x, top + size + 3 * this.dpr);
        octx.font = `700 ${numberSize}px system-ui, sans-serif`;
      }
    }
    if (this.frames % 30 === 0) this.canvas.dataset.frames = String(this.frames);
  }
}
