// 選手の役割。要件定義書「戦術と観戦」の「役割」と、フェーズ3.5の「役割の名前とフォーメーション」に対応する。
// 役割は、立ち位置（どこまで上がるか、内に絞るか）と、プレーの選びやすさを変える。

import { FORMATIONS } from './formations';
import type { AttributeKey, Position, Role, Tactics } from './types';

export interface RoleProfile {
  label: string;
  /** ポジションによって呼び方が変わるとき（例：組み立て役はDMならレジスタ） */
  labelAt?: Partial<Record<Position, string>>;
  description: string;
  /** この役割で大事な能力。向き不向き（◎○△）の目安に使う */
  keys: AttributeKey[];
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
  goalkeeper: { ...base, label: 'ゴールキーパー', description: 'ゴールを守ることに集中する',
    keys: ['reflexes', 'handling', 'positioning', 'concentration'] },
  sweeperKeeper: { ...base, label: 'スイーパーキーパー', description: '高い位置まで出て、裏へのボールを処理する', attackX: 0.4, defendX: 0.3,
    keys: ['rushingOut', 'oneOnOne', 'acceleration', 'decisions'] },
  stopper: { ...base, label: 'ストッパー', description: '前に出て相手のFWに強く当たる', defendX: 0.15, defend: 1.1, forward: 0.9,
    keys: ['tackling', 'strength', 'heading', 'jumping'] },
  coverDefender: { ...base, label: 'カバーリング', description: '少し下がって、味方の裏のスペースを守る', defendX: -0.15, defend: 1.02, forward: 0.92, dribble: 0.8,
    keys: ['positioning', 'concentration', 'pace', 'decisions'] },
  ballPlayingDefender: { ...base, label: 'ビルドアップ型', description: 'ドリブルや縦パスで攻撃の起点になる', dribble: 1.6, forward: 1.25, defend: 0.97,
    keys: ['passing', 'composure', 'firstTouch', 'vision'] },
  defensiveFullback: { ...base, label: '守備的SB', labelAt: { WB: '守備的WB' }, description: 'あまり上がらず、守備を優先する', attackX: -0.7, cross: 0.6, defend: 1.1, stamina: 0.95,
    keys: ['tackling', 'positioning', 'concentration', 'strength'] },
  attackingFullback: { ...base, label: '攻撃的SB', description: '積極的に上がってクロスを上げる。上がった裏を突かれやすい', attackX: 0.6, cross: 1.2, target: 1.1, defend: 0.95, stamina: 1.08,
    keys: ['crossing', 'pace', 'stamina', 'workRate'] },
  invertedFullback: { ...base, label: '偽SB', description: '攻撃のときは中へ入り、中盤でパスを回す', attackX: -0.1, attackY: -1.1, forward: 1.1, target: 1.1, cross: 0.4, dribble: 0.9,
    keys: ['passing', 'decisions', 'firstTouch', 'positioning'] },
  wingBack: { ...base, label: 'ウイングバック', description: '高い位置まで上がり、サイドの攻撃を一人で担う', attackX: 0.4, attackY: 0.15, cross: 1.25, target: 1.15, dribble: 1.1, defend: 0.94, stamina: 1.12,
    keys: ['crossing', 'stamina', 'pace', 'workRate', 'dribbling'] },
  anchor: { ...base, label: 'アンカー', description: '最終ラインの前に残って守る', attackX: -0.5, shoot: 0.5, dribble: 0.7, defend: 1.15,
    keys: ['positioning', 'tackling', 'concentration', 'strength'] },
  volante: { ...base, label: 'ボランチ', description: '攻守のバランスを取り、奪ったボールをパスで攻撃につなげる', attackX: -0.15, forward: 1.08, shoot: 0.8, defend: 1.07, stamina: 1.03,
    keys: ['tackling', 'passing', 'workRate', 'decisions'] },
  playmaker: { ...base, label: 'ゲームメーカー', labelAt: { DM: 'レジスタ' }, description: 'ボールを集め、縦パスで攻撃を組み立てる', forward: 1.2, target: 1.15, defend: 0.95,
    keys: ['passing', 'vision', 'decisions', 'composure', 'firstTouch'] },
  boxToBox: { ...base, label: 'ボックス・トゥ・ボックス', description: 'ゴール前からゴール前まで走り回る', attackX: 0.1, shoot: 1.05, defend: 1.03, stamina: 1.08,
    keys: ['stamina', 'workRate', 'tackling', 'passing', 'offTheBall'] },
  mezzala: { ...base, label: 'メッツァーラ', description: '中盤の外側から前へ出て、ゴール前に入っていく', attackX: 0.45, attackY: 0.45, dribble: 1.15, shoot: 1.15, cross: 1.05, target: 1.05, defend: 0.92, stamina: 1.06,
    keys: ['dribbling', 'offTheBall', 'passing', 'shooting'] },
  advancedPlaymaker: { ...base, label: 'トップ下', description: '前線の近くでボールを受け、決定的なパスを出す', forward: 1.15, target: 1.1, shoot: 0.9,
    keys: ['vision', 'passing', 'firstTouch', 'decisions'] },
  shadowStriker: { ...base, label: 'シャドー', description: 'FWの近くでプレーし、ゴール前に飛び込む', attackX: 0.5, shoot: 1.35, target: 1.05, defend: 0.9,
    keys: ['offTheBall', 'shooting', 'composure', 'acceleration'] },
  wideMidfielder: { ...base, label: 'サイドハーフ', description: 'サイドを上下して守備にも戻る', attackX: -0.2, defend: 1.1, stamina: 1.08,
    keys: ['workRate', 'stamina', 'crossing', 'tackling'] },
  winger: { ...base, label: 'ウインガー', description: 'サイドに張って縦に仕掛け、クロスを上げる', attackY: 0.2, dribble: 1.1, cross: 1.15, shoot: 0.9,
    keys: ['pace', 'dribbling', 'crossing', 'acceleration'] },
  insideForward: { ...base, label: 'インサイドフォワード', description: 'サイドから中へ切り込んでシュートを狙う', attackY: -0.8, dribble: 1.2, cross: 0.6, shoot: 1.4,
    keys: ['dribbling', 'shooting', 'acceleration', 'composure'] },
  poacher: { ...base, label: 'ストライカー', description: 'ゴール前に残って、シュートを狙い続ける', attackX: 0.1, forward: 0.9, dribble: 0.85, shoot: 1.12, target: 1.05, defend: 0.85, stamina: 0.95, offside: 1.2,
    keys: ['shooting', 'composure', 'offTheBall', 'acceleration'] },
  targetMan: { ...base, label: 'ポストプレーヤー', description: '前線でボールを収め、クロスの的になる', target: 1.1, aerialTarget: 1.4, dribble: 0.8,
    keys: ['strength', 'heading', 'jumping', 'firstTouch'] },
  runner: { ...base, label: '裏抜け', description: '相手の最終ラインの裏を狙い続ける', attackX: 0.3, forward: 1.1, shoot: 1.1, offside: 1.4,
    keys: ['pace', 'acceleration', 'offTheBall', 'shooting'] },
  falseNine: { ...base, label: '偽9番', description: '中盤まで下がってボールを受け、組み立てに加わる', attackX: -0.45, forward: 1.2, dribble: 1.2, shoot: 0.95, target: 1.15,
    keys: ['passing', 'vision', 'firstTouch', 'dribbling'] },
};

/** ポジションごとに選べる役割（先頭が初期値） */
export const ROLE_OPTIONS: Record<Position, Role[]> = {
  GK: ['goalkeeper', 'sweeperKeeper'],
  CB: ['stopper', 'coverDefender', 'ballPlayingDefender'],
  SB: ['attackingFullback', 'defensiveFullback', 'invertedFullback'],
  WB: ['wingBack', 'defensiveFullback'],
  DM: ['anchor', 'volante', 'playmaker'],
  CM: ['boxToBox', 'playmaker', 'volante', 'mezzala', 'anchor'],
  AM: ['advancedPlaymaker', 'shadowStriker'],
  WM: ['wideMidfielder', 'winger'],
  W: ['winger', 'insideForward'],
  FW: ['targetMan', 'poacher', 'runner', 'falseNine'],
};

/** その位置での役割の呼び方 */
export function roleLabel(role: Role, position: Position): string {
  const profile = ROLE_PROFILES[role];
  return profile.labelAt?.[position] ?? profile.label;
}

export function defaultRole(position: Position): Role {
  return ROLE_OPTIONS[position][0] ?? 'boxToBox';
}

/** フォーメーションの枠の初期の役割（枠で決めていなければ、ポジションの初期値） */
export function slotDefaultRole(tactics: Pick<Tactics, 'formation'>, slotIndex: number, position: Position): Role {
  const slotRole = FORMATIONS[tactics.formation]?.[slotIndex]?.role;
  return slotRole && ROLE_OPTIONS[position].includes(slotRole) ? slotRole : defaultRole(position);
}

/** 戦術で指定された役割が、そのポジションで選べるものならそれを、そうでなければ初期値を返す */
export function roleForSlot(tactics: Tactics, slotIndex: number, position: Position): Role {
  const chosen = tactics.roles?.[slotIndex];
  return chosen && ROLE_OPTIONS[position].includes(chosen) ? chosen : slotDefaultRole(tactics, slotIndex, position);
}
