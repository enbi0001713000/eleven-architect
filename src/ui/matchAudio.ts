// 観戦の音（要件定義書「観戦の強化（1.2〜）」）。録音は使わず、ブラウザの中で作る（Web Audio）。
// 歓声のうねり（チャンスで高まり、ゴールで爆発、外すとため息）、プレーの音（蹴る、ネットが揺れる、ポスト）、審判の笛、
// 自分のクラブのゴールのジングル、ホームの応援のリズム（太鼓と手拍子。押しているときやリードしているときに大きくなる）。
// 音はブラウザの決まりで、人が画面を押したあとでないと鳴らせない（キックオフのボタンなどで始める）。

import type { LiveSnapshot } from '../engine/match';
import type { MatchEvent, Side } from '../engine/types';

type Ctx = AudioContext;

const SHOT_TYPES = new Set<MatchEvent['type']>(['goal', 'penaltyGoal', 'shotSaved', 'shotOff', 'shotBlocked', 'penaltyMissed']);
const WHISTLE_TYPES = new Set<MatchEvent['type']>(['foul', 'yellowCard', 'redCard', 'offside', 'penalty', 'freeKick', 'injury']);

/** 応援のリズム（8分音符8つで1回り）。太鼓「ドン・ドン・ドドドン」と手拍子 */
const DRUM = [true, false, true, false, true, true, true, false];
const CLAP = [false, true, false, true, false, false, false, true];
const BEAT = 0.25;

export interface AudioOptions {
  /** スタンドの埋まり具合（0〜1）。歓声の大きさが変わる */
  crowdFill: number;
  /** 自分のクラブの側（ゴールのジングル） */
  mySide: Side;
}

export class MatchAudio {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private crowd: GainNode | null = null;
  private crowdFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBeat = 0;
  private beat = 0;
  private chant = 0.15;
  private lastKick = 0;
  private volume = 0.6;
  private muted = false;
  private holderId: string | null = null;
  private readonly options: AudioOptions;

  constructor(options: AudioOptions) {
    this.options = options;
  }

  /** 音を出せるようにする（人の操作のあとに呼ぶ）。出せない環境では何もしない */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    try {
      const ctx = new AudioCtor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(ctx.destination);
      this.noiseBuffer = this.makeNoise(ctx);
      this.startCrowd(ctx);
      this.nextBeat = ctx.currentTime + 0.2;
      this.timer = setInterval(() => this.schedule(), 60);
    } catch {
      this.ctx = null;
    }
  }

  /** 一時停止のあいだは、すべての音を止める */
  pause(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : volume, this.ctx.currentTime, 0.05);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.ctx?.close();
    this.ctx = null;
  }

  // ---- 手ごとの音 ----

  /** 1手ぶんの出来事と状態から、音を鳴らす */
  step(snapshot: LiveSnapshot, events: readonly MatchEvent[]): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') {
      this.holderId = snapshot.ball.holderId;
      return;
    }
    const now = ctx.currentTime;
    for (const e of events) {
      if (e.type === 'kickoff') this.whistle(now, [0.45]);
      else if (e.type === 'halftime') this.whistle(now, [0.25, 0.25, 0.9]);
      else if (e.type === 'fulltime') {
        this.whistle(now, [0.25, 0.25, 1.1]);
        const mine = snapshot.score[this.options.mySide];
        const theirs = snapshot.score[this.options.mySide === 0 ? 1 : 0];
        if (mine > theirs) this.roar(now + 1.6, 0.7, 3.5);
      } else if (WHISTLE_TYPES.has(e.type)) this.whistle(now, [0.22]);
      else if (e.type === 'corner') this.swell(0.55, 1.5);
    }
    const shot = events.find((e) => SHOT_TYPES.has(e.type));
    if (shot) {
      this.kick(now, 1);
      const arrive = now + 0.32;
      switch (shot.type) {
        case 'goal':
        case 'penaltyGoal':
          this.net(arrive);
          this.roar(arrive, 1, 4.5);
          if (shot.side === this.options.mySide) this.jingle(arrive + 0.45);
          break;
        case 'shotSaved':
        case 'penaltyMissed':
          this.thud(arrive);
          this.sigh(arrive + 0.1, 0.55);
          break;
        case 'shotOff':
          if (/ポスト|バー/.test(shot.text)) this.post(arrive);
          this.sigh(arrive + 0.05, 0.7);
          break;
        case 'shotBlocked':
          this.thud(now + 0.12);
          this.sigh(now + 0.2, 0.3);
          break;
      }
    } else if (snapshot.ball.holderId !== this.holderId && snapshot.ball.holderId !== null) {
      this.kick(now, 0.55);
    }
    this.holderId = snapshot.ball.holderId;

    // 歓声のうねり：相手ゴールに近い場面で高まる
    const forward = snapshot.ball.side === 0 ? snapshot.ball.x : 6 - snapshot.ball.x;
    if (!shot && snapshot.phase !== 'halftime' && snapshot.phase !== 'finished') this.swell(forward >= 5 ? 0.6 : forward >= 4 ? 0.42 : 0.28, 0.8);
    // 応援：ホームが押しているとき（相手陣でボールを持つ）やリードしているときに大きく
    const homeAhead = snapshot.score[0] > snapshot.score[1];
    const homePush = snapshot.ball.side === 0 && snapshot.ball.x >= 3.5;
    this.chant = snapshot.phase === 'halftime' || snapshot.phase === 'finished' ? 0.06 : 0.14 + (homePush ? 0.16 : 0) + (homeAhead ? 0.12 : 0);
  }

  // ---- 音の材料 ----

  private makeNoise(ctx: Ctx): AudioBuffer {
    const length = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // 少し低めのざわめき（茶色のノイズ寄り）
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.04 * white) / 1.04;
      data[i] = last * 3.2 + white * 0.25;
    }
    return buffer;
  }

  private startCrowd(ctx: Ctx): void {
    if (!this.noiseBuffer || !this.master) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 650;
    band.Q.value = 0.55;
    const gain = ctx.createGain();
    gain.gain.value = this.baseCrowd();
    source.connect(band).connect(gain).connect(this.master);
    source.start();
    this.crowd = gain;
    this.crowdFilter = band;
  }

  private baseCrowd(): number {
    return 0.1 + 0.18 * Math.max(0, Math.min(1, this.options.crowdFill));
  }

  /** 歓声の大きさを level へ（0〜1） */
  private swell(level: number, seconds: number): void {
    if (!this.ctx || !this.crowd || !this.crowdFilter) return;
    const now = this.ctx.currentTime;
    this.crowd.gain.setTargetAtTime(this.baseCrowd() * (0.6 + level * 1.4), now, seconds / 3);
    this.crowdFilter.frequency.setTargetAtTime(500 + level * 600, now, seconds / 3);
  }

  private noise(at: number, duration: number, filter: BiquadFilterType, frequency: number, gain: number, q = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuffer || !this.master) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = frequency;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(f).connect(g).connect(this.master);
    source.start(at, Math.random() * 2);
    source.stop(at + duration + 0.05);
  }

  private tone(at: number, duration: number, type: OscillatorType, from: number, to: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, at + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(g).connect(this.master);
    osc.start(at);
    osc.stop(at + duration + 0.05);
  }

  /** ボールを蹴る音（低い「ドッ」と、短い「パッ」） */
  private kick(at: number, strength: number): void {
    if (at - this.lastKick < 0.09) return;
    this.lastKick = at;
    this.tone(at, 0.1, 'sine', 150, 55, 0.35 * strength);
    this.noise(at, 0.03, 'highpass', 1600, 0.12 * strength);
  }

  /** ネットが揺れる音 */
  private net(at: number): void {
    this.noise(at, 0.45, 'highpass', 2200, 0.35);
    this.noise(at + 0.03, 0.3, 'bandpass', 900, 0.2, 0.8);
  }

  /** ポストやバーに当たる音（金属の「カーン」） */
  private post(at: number): void {
    this.tone(at, 0.7, 'sine', 1040, 1000, 0.22);
    this.tone(at, 0.55, 'sine', 1560, 1520, 0.12);
    this.tone(at, 0.4, 'triangle', 2490, 2450, 0.05);
  }

  /** GKが止める、体に当たる鈍い音 */
  private thud(at: number): void {
    this.tone(at, 0.08, 'sine', 220, 90, 0.25);
    this.noise(at, 0.05, 'lowpass', 900, 0.15);
  }

  /** 審判の笛。lengths は1回ずつの長さ（秒） */
  private whistle(at: number, lengths: number[]): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    let t = at;
    for (const length of lengths) {
      for (const [freq, level] of [[2950, 0.1], [3240, 0.06]] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        // 笛の中の玉が回る揺れ
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 32;
        const depth = ctx.createGain();
        depth.gain.value = level * 0.5;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(level, t + 0.02);
        g.gain.setValueAtTime(level, t + length - 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t + length);
        lfo.connect(depth).connect(g.gain);
        osc.connect(g).connect(this.master);
        osc.start(t);
        lfo.start(t);
        osc.stop(t + length + 0.05);
        lfo.stop(t + length + 0.05);
      }
      t += length + 0.16;
    }
  }

  /** ゴールの歓声の爆発 */
  private roar(at: number, level: number, seconds: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.crowd || !this.crowdFilter) return;
    this.crowd.gain.cancelScheduledValues(at);
    this.crowd.gain.setTargetAtTime(this.baseCrowd() * 3.4 * level, at, 0.08);
    this.crowd.gain.setTargetAtTime(this.baseCrowd() * 1.1, at + seconds * 0.6, seconds / 3);
    this.crowdFilter.frequency.setTargetAtTime(1300, at, 0.1);
    this.crowdFilter.frequency.setTargetAtTime(650, at + seconds * 0.6, seconds / 3);
    this.noise(at, seconds * 0.8, 'bandpass', 1100, 0.3 * level, 0.5);
  }

  /** 外したときのため息（高いところから下がる） */
  private sigh(at: number, level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuffer || !this.master || !this.crowd) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(950, at);
    f.frequency.exponentialRampToValueAtTime(260, at + 1.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.3 * level, at + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.4);
    source.connect(f).connect(g).connect(this.master);
    source.start(at, Math.random() * 1.5);
    source.stop(at + 1.5);
    this.crowd.gain.setTargetAtTime(this.baseCrowd() * 0.8, at + 0.4, 0.4);
  }

  /** 自分のクラブのゴールのジングル（短いファンファーレ） */
  private jingle(at: number): void {
    const notes = [392, 523.25, 659.25, 783.99];
    notes.forEach((freq, i) => this.tone(at + i * 0.11, 0.16, 'square', freq, freq, 0.07));
    const chordAt = at + notes.length * 0.11;
    for (const freq of [523.25, 659.25, 783.99, 1046.5]) this.tone(chordAt, 0.75, 'square', freq, freq, 0.045);
  }

  /** 応援のリズムを少し先まで予約する */
  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (this.nextBeat < ctx.currentTime - 0.5) this.nextBeat = ctx.currentTime + 0.05;
    while (this.nextBeat < ctx.currentTime + 0.18) {
      const i = this.beat % DRUM.length;
      const level = this.chant;
      if (DRUM[i]) this.tone(this.nextBeat, 0.16, 'sine', 95, 48, 0.55 * level);
      if (CLAP[i]) {
        for (let k = 0; k < 3; k++) this.noise(this.nextBeat + k * 0.012, 0.06, 'bandpass', 1300, 0.22 * level, 1.4);
      }
      this.nextBeat += BEAT;
      this.beat++;
    }
  }
}
