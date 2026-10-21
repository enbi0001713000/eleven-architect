// 実況テキスト。テンプレートの {p} {q} {gk} {team} を名前に置き換えて作る。

import type { Rng } from './rng';

export type CommentaryKey =
  | 'kickoff' | 'secondHalf' | 'halftime' | 'fulltime'
  | 'goal' | 'headerGoal' | 'penaltyGoal' | 'freeKickGoal'
  | 'shotSaved' | 'headerSaved' | 'shotOff' | 'headerOff' | 'shotBlocked'
  | 'penalty' | 'penaltyMissed' | 'penaltyWide' | 'corner' | 'freeKick'
  | 'foul' | 'yellowCard' | 'secondYellow' | 'redCard' | 'offside'
  | 'substitution' | 'tacticsAttack' | 'tacticsDefend' | 'tacticsChange' | 'injury'
  | 'throughBall' | 'breakaway' | 'dribble' | 'tackle' | 'interception' | 'cross';

const TEMPLATES: Record<CommentaryKey, readonly string[]> = {
  kickoff: ['{team}のキックオフで試合開始！'],
  secondHalf: ['{team}のキックオフで後半開始'],
  halftime: ['前半終了'],
  fulltime: ['試合終了！'],
  goal: [
    'ゴール！ {p}が決めた！',
    '{p}のシュートがネットを揺らす！ ゴール！',
    '{p}が冷静に流し込んだ！ ゴール！',
  ],
  headerGoal: ['{p}のヘディング！ ゴール！', '{p}が頭で合わせた！ ゴール！'],
  penaltyGoal: ['{p}がPKを決めた！'],
  freeKickGoal: ['{p}の直接フリーキックが決まった！'],
  shotSaved: [
    '{p}のシュート！ しかし{gk}が止める',
    '{p}が狙うが、{gk}の好セーブ',
    '{p}のシュートは{gk}の正面',
  ],
  headerSaved: ['{p}のヘディングは{gk}がキャッチ'],
  shotOff: ['{p}がシュート、枠の外', '{p}のシュートはゴールの上', '{p}が打つが、わずかに外れる'],
  headerOff: ['{p}のヘディングは枠を外れた'],
  shotBlocked: ['{p}のシュートは相手がブロック', '{p}が打つが、体を張った守備に阻まれる'],
  penalty: ['PK！ {p}が倒された'],
  penaltyMissed: ['{p}のPKを{gk}が止めた！'],
  penaltyWide: ['{p}のPKは枠を外れた！'],
  corner: ['{team}のコーナーキック'],
  freeKick: ['{team}がゴール前でフリーキックを得る'],
  foul: ['{q}が{p}を倒してファウル', '{q}のファウルで試合が止まる'],
  yellowCard: ['{q}にイエローカード'],
  secondYellow: ['{q}に2枚目のイエローカード、退場！'],
  redCard: ['{q}に一発レッド！ 退場！'],
  offside: ['{p}はオフサイド'],
  substitution: ['{team}の選手交代：{q} → {p}'],
  injury: ['{p}が倒れ込んだまま動けない…ケガのようだ', '{p}が足を押さえている。痛めたか', '{p}が負傷。プレーを続けられるか'],
  tacticsAttack: ['{team}が攻撃的な姿勢に切り替える', '{team}は前に人数をかけ始めた'],
  tacticsDefend: ['{team}は守りを固める', '{team}はリードを守る態勢に入った'],
  tacticsChange: ['{team}が戦術を変更'],
  throughBall: ['{p}から{q}へ縦パス', '{p}が前線の{q}へ通す'],
  breakaway: ['{p}のパスで{q}が裏へ抜け出した！', '{q}が最終ラインの裏を取った！ GKと1対1！', '{p}から裏へ！ {q}が抜け出す！'],
  dribble: ['{p}がドリブルで前へ運ぶ', '{p}が一人かわした'],
  tackle: ['{q}が{p}からボールを奪う'],
  interception: ['{q}がパスをカット'],
  cross: ['{p}がクロスを上げる'],
};

export interface CommentaryNames {
  p?: string;
  q?: string;
  gk?: string;
  team?: string;
}

export function commentary(rng: Rng, key: CommentaryKey, names: CommentaryNames): string {
  const template = rng.pick(TEMPLATES[key]);
  return template.replace(/\{(p|q|gk|team)\}/g, (_, k: keyof CommentaryNames) => names[k] ?? '');
}
