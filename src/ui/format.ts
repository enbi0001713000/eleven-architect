// 画面で使う表示の決まりごと（ポジション名、能力値の名前、金額、日付など）

import type { AttributeKey, FormationName, Position, TeamInstructions } from '../engine/types';
import type { ClubSize, InboxCategory } from '../game/types';

export const POSITION_LABEL: Record<Position, string> = {
  GK: 'GK', CB: 'CB', SB: 'SB', WB: 'WB', DM: 'DM', CM: 'CM', AM: 'AM', WM: 'SM', W: 'WG', FW: 'FW',
};

export const POSITION_NAME: Record<Position, string> = {
  GK: 'ゴールキーパー', CB: 'センターバック', SB: 'サイドバック', WB: 'ウイングバック', DM: '守備的MF', CM: 'センターMF',
  AM: '攻撃的MF', WM: 'サイドMF', W: 'ウイング', FW: 'フォワード',
};

/** 守備→中盤→前線の並び順 */
export const POSITION_ORDER: Position[] = ['GK', 'CB', 'SB', 'WB', 'DM', 'CM', 'WM', 'AM', 'W', 'FW'];

export const ATTRIBUTE_LABEL: Record<AttributeKey, string> = {
  shooting: 'シュート', passing: 'パス', dribbling: 'ドリブル', crossing: 'クロス', firstTouch: 'トラップ',
  tackling: 'タックル', heading: 'ヘディング', decisions: '判断力', vision: '視野', positioning: 'ポジショニング',
  offTheBall: 'オフ・ザ・ボール', concentration: '集中力', workRate: '運動量', composure: '冷静さ',
  pace: 'スピード', acceleration: '加速', stamina: 'スタミナ', strength: '筋力', jumping: 'ジャンプ',
  reflexes: '反応', handling: 'キャッチ', oneOnOne: '1対1', rushingOut: '飛び出し',
};

/** 表の見出し用の短い名前 */
export const ATTRIBUTE_SHORT: Record<AttributeKey, string> = {
  shooting: 'シュ', passing: 'パス', dribbling: 'ドリ', crossing: 'クロ', firstTouch: 'トラ',
  tackling: 'タッ', heading: 'ヘデ', decisions: '判断', vision: '視野', positioning: 'ポジ',
  offTheBall: 'オフ', concentration: '集中', workRate: '運動', composure: '冷静',
  pace: 'スピ', acceleration: '加速', stamina: 'スタ', strength: '筋力', jumping: 'ジャ',
  reflexes: '反応', handling: 'キャ', oneOnOne: '1対1', rushingOut: '飛出',
};

export const ATTRIBUTE_GROUPS: { label: string; keys: AttributeKey[] }[] = [
  { label: '技術', keys: ['shooting', 'passing', 'dribbling', 'crossing', 'firstTouch', 'tackling', 'heading'] },
  { label: 'メンタル', keys: ['decisions', 'vision', 'positioning', 'offTheBall', 'concentration', 'workRate', 'composure'] },
  { label: 'フィジカル', keys: ['pace', 'acceleration', 'stamina', 'strength', 'jumping'] },
  { label: 'GK', keys: ['reflexes', 'handling', 'oneOnOne', 'rushingOut'] },
];

export const INSTRUCTION_LABELS: { key: keyof TeamInstructions; label: string; low: string; high: string }[] = [
  { key: 'mentality', label: '攻撃と守備のバランス', low: '守備的', high: '攻撃的' },
  { key: 'defensiveLine', label: '守備ラインの高さ', low: '低い', high: '高い' },
  { key: 'pressing', label: 'プレスの強さ', low: '弱い', high: '強い' },
  { key: 'width', label: '攻撃の幅', low: '狭い', high: '広い' },
  { key: 'passingLength', label: 'パスの長さ', low: '短い', high: '長い' },
  { key: 'tempo', label: '攻めのテンポ', low: '遅い', high: '速い' },
];

export { FORMATION_NAMES as FORMATIONS_LIST } from '../engine/formations';

export const SIZE_LABEL: Record<ClubSize, string> = { large: '大', medium: '中', small: '小' };

export function formatYen(yen: number): string {
  if (yen >= 1e8) return `${(yen / 1e8).toFixed(yen >= 1e9 ? 0 : 1)}億円`;
  return `${Math.round(yen / 1e4).toLocaleString('ja-JP')}万円`;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function formatDate(iso: string, withYear = true): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const text = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEKDAYS[d.getUTCDay()]}）`;
  return withYear ? `${d.getUTCFullYear()}年${text}` : text;
}

/** 能力値の色分け（1〜20） */
export function attributeTone(value: number): string {
  if (value >= 16) return 'tone-top';
  if (value >= 13) return 'tone-good';
  if (value >= 9) return 'tone-mid';
  return 'tone-low';
}

export function ratingTone(rating: number | null): string {
  if (rating === null) return '';
  if (rating >= 7.5) return 'tone-top';
  if (rating >= 6.9) return 'tone-good';
  if (rating >= 6.2) return 'tone-mid';
  return 'tone-low';
}

export const INBOX_CATEGORY_LABEL: Record<InboxCategory, string> = {
  match: '試合', medical: 'メディカル', discipline: '規律', player: '選手', media: 'メディア',
  training: '練習', league: 'リーグ', club: 'クラブ', finance: '財務', transfer: '移籍',
};

export function fanMoodLabel(value: number): string {
  if (value >= 75) return '熱狂';
  if (value >= 60) return '好意的';
  if (value >= 40) return '普通';
  if (value >= 25) return '不満';
  return '怒り';
}
