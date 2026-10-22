// 他クラブの選手の能力の見え方。要件定義書「選手データ」の「能力の見え方」に対応する。
// 知識度（0〜100%）が低いほど、能力値は「12〜16」のような幅でしか分からない。
// 自分のクラブの選手は100%。同じリーグの選手は50%、海外の選手と新人の候補は20%から始まり、
// スカウトで調べると上がる（下がらない。フェーズ4-C）。

import { SCOUTING } from './scoutingBalance';
import type { GameState, PlayerRecord } from './types';

export const LEAGUE_KNOWLEDGE = SCOUTING.base.league;

/** 調べる前の知識度（所属で決まる） */
export function baseKnowledge(state: GameState, player: PlayerRecord): number {
  if (player.prospect) return SCOUTING.base.prospect;
  if (!player.clubId && (state.overseasPool ?? []).includes(player.id)) return SCOUTING.base.overseas;
  return LEAGUE_KNOWLEDGE;
}

export function knowledgeOf(state: GameState, player: PlayerRecord): number {
  const myId = state.manager.clubId;
  if (myId && (player.clubId === myId || player.loan?.fromClubId === myId)) return 100;
  return Math.max(baseKnowledge(state, player), state.scouting?.knowledge[player.id] ?? 0);
}

/** 文字列から決まった数を作る（同じ選手・同じ能力なら毎回同じ幅になるように） */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface AttributeView {
  low: number;
  high: number;
  exact: boolean;
}

/** 画面に出す能力値。知識度100%なら正確な値、それ以外は本当の値を含む幅 */
export function viewAttribute(value: number, knowledge: number, key: string): AttributeView {
  const rounded = Math.round(value);
  if (knowledge >= 100) return { low: rounded, high: rounded, exact: true };
  const width = Math.max(1, Math.round(((100 - knowledge) / 100) * 7));
  const offset = hash(key) % (width + 1);
  const low = Math.max(1, Math.min(20 - width, rounded - offset));
  return { low, high: low + width, exact: false };
}

export function formatView(view: AttributeView): string {
  return view.exact ? `${view.low}` : `${view.low}〜${view.high}`;
}

/** コーチによる伸びしろの評価（星1〜5）。自分のクラブの選手だけに見せる目安 */
export function potentialStars(player: PlayerRecord): number {
  const p = player.hidden.potential;
  if (p >= 17.5) return 5;
  if (p >= 16) return 4;
  if (p >= 14.5) return 3;
  if (p >= 13) return 2;
  return 1;
}
