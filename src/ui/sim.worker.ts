// 他会場の試合を、画面とは別の処理（Web Worker）で計算する。要件定義書「非機能要件」の「構成」に対応する。

import { simulateMatch } from '../engine/match';
import type { MatchResult, Team } from '../engine/types';

export interface SimJob {
  id: string;
  home: Team;
  away: Team;
  seed: number;
  important: boolean;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SimJob[]>) => void) | null;
  postMessage: (data: Record<string, MatchResult>) => void;
};

scope.onmessage = (event) => {
  const results: Record<string, MatchResult> = {};
  for (const job of event.data) {
    results[job.id] = simulateMatch(job.home, job.away, { seed: job.seed, important: job.important, detailedCommentary: false });
  }
  scope.postMessage(results);
};
