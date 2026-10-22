// 移籍の交渉の状況と、返事のボタン（受信箱と、移籍の画面の「交渉」で使う）。フェーズ4-B。

import { useState } from 'react';
import { createRng } from '../../engine/rng';
import { salaryText } from '../../game/contracts';
import { daySeed } from '../../game/dates';
import { yenText } from '../../game/finance';
import { acceptCounter, acceptIncoming, counterIncoming, OVERSEAS, rejectIncoming, withdrawBid } from '../../game/transfers';
import type { BidKind, BidStatus, GameState, TransferBid } from '../../game/types';
import { formatDate } from '../format';
import { store } from '../store';

export const BID_KIND_LABEL: Record<BidKind, string> = { transfer: '移籍金', clause: '違約金', loan: 'レンタル', overseas: '海外への移籍' };

export function bidStatusLabel(bid: TransferBid, myId: string): string {
  const mine = bid.buyerId === myId;
  const labels: Record<BidStatus, string> = {
    waiting: mine ? '返事を待っています' : '返事が必要です',
    countered: '額を返してきました',
    accepted: 'クラブ間で合意（選手と契約の話をする）',
    agreed: '移籍期間に成立',
    done: '成立',
    rejected: mine ? '断られました' : '断りました',
    withdrawn: '流れました',
    failed: '流れました',
  };
  return labels[bid.status];
}

const rngFor = (game: GameState, bidId: string) => createRng(daySeed(game.seed, game.date, `bid-${bidId}`));

/** 交渉に対してできること（なければ何も出さない） */
export function BidActions({ game, bid }: { game: GameState; bid: TransferBid }) {
  const myId = game.manager.clubId;
  const [amount, setAmount] = useState(() => Math.round(bid.fee * 1.25 / 1e6));
  const [note, setNote] = useState('');
  const buying = bid.buyerId === myId;
  const selling = bid.sellerId === myId;
  const run = (change: (g: GameState) => string | null | void) => {
    let result: string | null | void = null;
    store.update((g) => { result = change(g); });
    if (typeof result === 'string' && result) setNote(result);
  };

  if (buying && bid.status === 'countered' && bid.counter !== null) {
    return (
      <div className="button-row">
        <button type="button" className="primary" onClick={() => run((g) => acceptCounter(g, bid.id))}>{salaryText(bid.counter)}で出す</button>
        <button type="button" className="secondary" onClick={() => run((g) => withdrawBid(g, bid.id))}>あきらめる</button>
        {note && <span className="tone-low small">{note}</span>}
      </div>
    );
  }
  if (buying && bid.status === 'accepted') {
    return (
      <div className="button-row">
        <button type="button" className="primary" onClick={() => store.navigate({ name: 'contract', playerId: bid.playerId })}>選手と契約の話をする（{formatDate(bid.due, false)}まで）</button>
        <button type="button" className="secondary" onClick={() => run((g) => withdrawBid(g, bid.id))}>取り下げる</button>
      </div>
    );
  }
  if (buying && bid.status === 'waiting') {
    return (
      <div className="button-row">
        <span className="muted small">{formatDate(bid.due, false)}ごろに返事が届きます</span>
        <button type="button" className="secondary small" onClick={() => run((g) => withdrawBid(g, bid.id))}>取り下げる</button>
      </div>
    );
  }
  if (selling && bid.status === 'waiting') {
    return (
      <div className="button-row wrap">
        <button type="button" className="primary" onClick={() => run((g) => acceptIncoming(g, bid.id, rngFor(g, bid.id)))}>受ける</button>
        <button type="button" className="secondary" onClick={() => run((g) => rejectIncoming(g, bid.id))}>断る</button>
        {bid.kind === 'transfer' && bid.buyerId !== OVERSEAS && (
          <span className="inline-form">
            <input type="number" min={1} step={10} value={amount} aria-label="返す額（百万円）" onChange={(e) => setAmount(Number(e.target.value) || 0)} />
            <span className="small">百万円なら売る</span>
            <button type="button" className="secondary" onClick={() => run((g) => counterIncoming(g, bid.id, amount * 1e6, rngFor(g, bid.id)))}>額を返す</button>
          </span>
        )}
        <span className="muted small">{formatDate(bid.due, false)}までに返事をしないと、断ったことになります</span>
        {note && <span className="small">{note}</span>}
      </div>
    );
  }
  if (bid.status === 'agreed') return <p className="muted small">次の移籍期間の初日に成立します。</p>;
  if (bid.note) return <p className="muted small">{bid.note}</p>;
  return null;
}

/** 交渉の1行の説明 */
export function bidSummary(game: GameState, bid: TransferBid): string {
  const other = bid.buyerId === game.manager.clubId ? bid.sellerId : bid.buyerId;
  const otherName = other === OVERSEAS ? '海外のクラブ' : game.clubs[other]?.name ?? '';
  const money = bid.kind === 'loan' ? `年俸の${Math.round(bid.wageShare * 100)}%を借りる側が払う` : yenText(bid.fee);
  return `${otherName}　${BID_KIND_LABEL[bid.kind]}　${money}`;
}
