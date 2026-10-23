// 移籍の交渉の進み具合（要件定義書「画面の作り直し（1.1）」の「移籍とスカウト」）。今どの段階にいるかを、段階の並びと番号で返す。

import type { TransferBid } from '../game/types';

/** 交渉の進み具合の段階。買う側：申し込み→クラブの返事→選手との契約→加入。レンタルは選手との契約がない */
export function bidSteps(bid: TransferBid, myId: string): { steps: string[]; current: number } {
  const buying = bid.buyerId === myId;
  const steps = buying
    ? (bid.kind === 'loan' ? ['申し込み', 'クラブの返事', '加入'] : ['申し込み', 'クラブの返事', '選手との契約', '加入'])
    : ['申し込みが届く', 'こちらの返事', '移籍'];
  const last = steps.length - 1;
  const current = bid.status === 'done' ? steps.length
    : bid.status === 'agreed' ? last
    : bid.status === 'accepted' ? 2
    : 1;
  return { steps, current };
}

