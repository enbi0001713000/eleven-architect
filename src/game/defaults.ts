// 新しいゲームと、古いセーブデータの変換の両方で使う、フェーズ2の項目の初期値。

import { overallRating } from '../engine/ratings';
import type { FormationName, TeamInstructions } from '../engine/types';
import { BALANCE } from './balance';
import type { Club, GameState, PlayerRecord, PlayerStatus, SquadRole } from './types';

export function defaultStatus(integration = 100): PlayerStatus {
  return {
    condition: 100, fatigue: 10, morale: 60, injury: null, recurrence: null,
    playingTime: 0.5, integration, recentRatings: [], recentMinutes: 0,
  };
}

export function defaultClubTraining(): Club['training'] {
  return { focus: 'balanced', intensity: 'normal' };
}

/** 今使っている形はよく慣れていて、ほかの形はあまり慣れていない */
export function defaultFamiliarity(formation: FormationName, instructions: TeamInstructions): Club['familiarity'] {
  const formations: Partial<Record<FormationName, number>> = {
    '4-4-2': 45, '4-3-3': 45, '4-2-3-1': 45, '4-1-4-1': 40, '3-4-2-1': 35, '3-5-2': 35,
  };
  formations[formation] = 85;
  return { formations, instructions: 85, instructionsRef: { ...instructions } };
}

/** クラブの中の序列から、契約で約束した役割を決める */
export function roleByRank(rank: number, age: number): SquadRole {
  if (rank < 11) return 'key';
  if (rank < 18) return 'rotation';
  return age <= 21 ? 'youth' : 'backup';
}

/** クラブの全選手の役割を、総合力の順に決め直す */
export function assignSquadRoles(state: GameState, clubId: string, onlyIds?: Set<string>): void {
  const club = state.clubs[clubId];
  if (!club) return;
  const ranked = club.playerIds.map((id) => state.players[id]).filter((p): p is PlayerRecord => p !== undefined)
    .sort((a, b) => overallRating(b) - overallRating(a));
  ranked.forEach((player, rank) => {
    if (!player.contract || (onlyIds && !onlyIds.has(player.id))) return;
    player.contract.role = roleByRank(rank, player.age);
  });
}

export function playerPhase2Fields(): Pick<PlayerRecord, 'status' | 'trainingFocus' | 'injuryHistory' | 'career' | 'lastTalk'> {
  return { status: defaultStatus(), trainingFocus: null, injuryHistory: [], career: [], lastTalk: null };
}

export const EXPECTED_PLAYING_TIME = BALANCE.expectedPlayingTime;
