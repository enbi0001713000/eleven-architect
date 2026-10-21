// 他会場の試合の計算を Web Worker に頼む。Worker が使えない環境では、そのまま計算する。

import { simulateMatch } from '../engine/match';
import type { MatchResult } from '../engine/types';
import type { SimJob } from './sim.worker';

export function simulateInBackground(jobs: SimJob[]): Promise<Record<string, MatchResult>> {
  if (typeof Worker === 'undefined') {
    const results: Record<string, MatchResult> = {};
    for (const job of jobs) {
      results[job.id] = simulateMatch(job.home, job.away, { seed: job.seed, important: job.important, detailedCommentary: false });
    }
    return Promise.resolve(results);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<Record<string, MatchResult>>) => {
      resolve(event.data);
      worker.terminate();
    };
    worker.onerror = (event) => {
      reject(new Error(event.message || '試合の計算に失敗しました'));
      worker.terminate();
    };
    worker.postMessage(jobs);
  });
}
