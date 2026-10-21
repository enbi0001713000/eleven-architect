// 選手の役割。要件定義書「戦術と観戦」の「役割」に対応する。
// 役割は、立ち位置（どこまで上がるか、内に絞るか）と、プレーの選びやすさを変える。

import type { Position, Role, Tactics } from './types';

export interface RoleProfile {
  label: string;
  description: string;
  /** 攻撃時に前へ出る量（マス） */
  attackX: number;
  /** 攻撃時の横の動き（＋はサイドへ開く、−は中へ絞る） */
  attackY: number;
  /** 守備時に前へ出る量（マス） */
  defendX: number;
  /** 前へのパスの選びやすさ */
  forward: number;
  dribble: number;
  shoot: number;
  cross: number;
  /** 味方からパスを受ける回数 */
  target: number;
  /** クロスの的になる回数 */
  aerialTarget: number;
  /** 守備での貢献 */
  defend: number;
  /** スタミナの減り方 */
  stamina: number;
  /** オフサイドになりやすさ */
  offside: number;
}

const base = {
  attackX: 0, attackY: 0, defendX: 0, forward: 1, dribble: 1, shoot: 1, cross: 1,
  target: 1, aerialTarget: 1, defend: 1, stamina: 1, offside: 1,
};

export const ROLE_PROFILES: Record<Role, RoleProfile> = {
  goalkeeper: { ...base, label: '通常', description: 'ゴールを守ることに集中する' },
  sweeperKeeper: { ...base, label: '前に出て守る型', description: '高い位置まで出て、裏へのボールを処理する', attackX: 0.4, defendX: 0.3 },
  stopper: { ...base, label: '潰し役', description: '前に出て相手のFWに強く当たる', defendX: 0.15, defend: 1.1, forward: 0.9 },
  ballPlayingDefender: { ...base, label: 'ボールを運べる型', description: 'ドリブルや縦パスで攻撃の起点になる', dribble: 1.6, forward: 1.25, defend: 0.97 },
  defensiveFullback: { ...base, label: '守備重視', description: 'あまり上がらず、守備を優先する', attackX: -0.5, cross: 0.7, defend: 1.08, stamina: 0.95 },
  attackingFullback: { ...base, label: '攻撃参加', description: '積極的に上がってクロスを上げる', attackX: 0.2, cross: 1.1, defend: 0.97, stamina: 1.08 },
  anchor: { ...base, label: '守備に専念する型', description: '最終ラインの前に残って守る', attackX: -0.5, shoot: 0.5, dribble: 0.7, defend: 1.15 },
  playmaker: { ...base, label: 'ゲームを組み立てる型', description: 'ボールを集め、縦パスで攻撃を組み立てる', forward: 1.2, target: 1.15, defend: 0.95 },
  boxToBox: { ...base, label: '攻守に走る型', description: 'ゴール前からゴール前まで走り回る', attackX: 0.1, shoot: 1.05, defend: 1.03, stamina: 1.08 },
  advancedPlaymaker: { ...base, label: 'チャンスを作る型', description: '前線の近くでボールを受け、決定的なパスを出す', forward: 1.15, target: 1.1, shoot: 0.9 },
  shadowStriker: { ...base, label: 'ゴール前に飛び込む型', description: 'FWを追い越してゴール前に入る', attackX: 0.5, shoot: 1.35, target: 1.05, defend: 0.9 },
  wideMidfielder: { ...base, label: '攻守に走る型', description: 'サイドを上下して守備にも戻る', attackX: -0.2, defend: 1.1, stamina: 1.08 },
  winger: { ...base, label: '縦に突破する型', description: 'サイドに張って縦に仕掛け、クロスを上げる', attackY: 0.2, dribble: 1.1, cross: 1.15, shoot: 0.9 },
  insideForward: { ...base, label: '中に切り込む型', description: 'サイドから中へ切り込んでシュートを狙う', attackY: -0.8, dribble: 1.2, cross: 0.6, shoot: 1.4 },
  targetMan: { ...base, label: 'ポストプレーヤー', description: '前線でボールを収め、クロスの的になる', target: 1.1, aerialTarget: 1.4, dribble: 0.8 },
  runner: { ...base, label: '裏に抜ける型', description: '相手の最終ラインの裏を狙い続ける', attackX: 0.3, forward: 1.1, shoot: 1.1, offside: 1.4 },
  falseNine: { ...base, label: '偽9番', description: '中盤まで下がってボールを受け、組み立てに加わる', attackX: -0.8, forward: 1.2, dribble: 1.2, shoot: 0.8, target: 1.15 },
};

/** ポジションごとに選べる役割（先頭が初期値） */
export const ROLE_OPTIONS: Record<Position, Role[]> = {
  GK: ['goalkeeper', 'sweeperKeeper'],
  CB: ['stopper', 'ballPlayingDefender'],
  SB: ['attackingFullback', 'defensiveFullback'],
  DM: ['anchor', 'playmaker'],
  CM: ['boxToBox', 'playmaker', 'anchor'],
  AM: ['advancedPlaymaker', 'shadowStriker'],
  WM: ['wideMidfielder', 'winger'],
  W: ['winger', 'insideForward'],
  FW: ['targetMan', 'runner', 'falseNine'],
};

export function defaultRole(position: Position): Role {
  return ROLE_OPTIONS[position][0] ?? 'boxToBox';
}

/** 戦術で指定された役割が、そのポジションで選べるものならそれを、そうでなければ初期値を返す */
export function roleForSlot(tactics: Tactics, slotIndex: number, position: Position): Role {
  const chosen = tactics.roles?.[slotIndex];
  return chosen && ROLE_OPTIONS[position].includes(chosen) ? chosen : defaultRole(position);
}
