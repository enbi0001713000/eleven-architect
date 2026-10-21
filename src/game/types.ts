// ゲーム全体の状態（セーブデータの中身）。要件定義書「リーグと日程」の章に対応する。

import type { MatchEvent, Player, Tactics, TeamStats } from '../engine/types';

export type ClubSize = 'large' | 'medium' | 'small';

export interface EmblemSpec {
  shape: 'shield' | 'round' | 'crest' | 'diamond';
  pattern: 'plain' | 'stripes' | 'halves' | 'band' | 'chevron' | 'hoops';
  symbol: 'star' | 'ball' | 'wave' | 'mountain' | 'bird' | 'flame';
  primary: string;
  secondary: string;
  accent: string;
  /** エンブレムに入れる英字（2〜3文字） */
  initials: string;
}

export interface Club {
  id: string;
  name: string;
  /** 順位表などで使う短い名前 */
  shortName: string;
  hometown: string;
  founded: number;
  size: ClubSize;
  /** 選手の能力の水準（1〜20） */
  level: number;
  /** クラブの評判（1〜100） */
  reputation: number;
  stadium: { name: string; capacity: number };
  fans: number;
  /** 年間の売上の目安（円） */
  revenue: number;
  colors: { primary: string; secondary: string };
  emblem: EmblemSpec;
  rivalId: string | null;
  managerName: string;
  playerIds: string[];
  tactics: Tactics;
  /** プレイヤーが選んだ先発と控え。AIのクラブは試合ごとに自動で選ぶので null。 */
  selection: { lineup: string[]; bench: string[] } | null;
}

export interface SeasonStats {
  appearances: number;
  starts: number;
  minutes: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  ratingTotal: number;
  ratingCount: number;
}

export interface PlayerRecord extends Player {
  clubId: string | null;
  squadNumber: number | null;
  /** 年俸（円）と契約が終わる年 */
  contract: { salary: number; endYear: number } | null;
  season: SeasonStats;
  discipline: {
    /** 出場停止につながる警告の累積 */
    yellowAccumulation: number;
    /** 残りの出場停止試合数 */
    suspendedMatches: number;
  };
}

export interface FixtureResult {
  homeGoals: number;
  awayGoals: number;
  /** 重要度2以上の出来事（ゴール、カード、交代など） */
  events: MatchEvent[];
  stats: [TeamStats, TeamStats];
  /** 出場した選手の評価点 */
  ratings: Record<string, number>;
  /** 先発の選手ID */
  lineups: [string[], string[]];
}

export interface Fixture {
  id: string;
  round: number;
  /** 'YYYY-MM-DD' */
  date: string;
  homeId: string;
  awayId: string;
  result: FixtureResult | null;
}

export interface GameState {
  version: number;
  seed: number;
  createdAt: string;
  manager: { name: string; clubId: string };
  season: {
    year: number;
    /** 次に行う節（1〜34）。全節が終わると 35 */
    round: number;
  };
  /** ゲーム内の今日の日付 'YYYY-MM-DD' */
  date: string;
  clubs: Record<string, Club>;
  players: Record<string, PlayerRecord>;
  /** 海外の選手プール（試合はしない。外国籍選手の獲得元。フェーズ4で使う） */
  overseasPool: string[];
  fixtures: Fixture[];
  nextPlayerNumber: number;
}
