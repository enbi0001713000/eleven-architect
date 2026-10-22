// 獲得の申し込み：他クラブの選手に、移籍金、違約金の支払い、レンタルを申し込む（要件定義書 フェーズ4「移籍交渉」「レンタル移籍」、フェーズ4-B）。
// クラブ間で合意したら、選手（の代理人）と契約の話をする（契約の交渉の画面）。

import { useState } from 'react';
import { overallRating } from '../../engine/ratings';
import { formatValueRange, marketValueRange } from '../../game/contracts';
import { yenText } from '../../game/finance';
import { knowledgeOf, viewAttribute } from '../../game/knowledge';
import { SQUAD_ROLE_LABEL } from '../../game/morale';
import { isFoundOverseas } from '../../game/scouting';
import { TRANSFER } from '../../game/transferBalance';
import { bidProblem, loanable, nextWindowStart, openBidFor, placeBid, transferBudgetLeft, windowOpen, type BidRequest } from '../../game/transfers';
import { BidActions, bidStatusLabel } from '../components/BidActions';
import { AttributeValue, ClubLink, Panel } from '../components/bits';
import { formatDate, POSITION_NAME } from '../format';
import { store, useGame } from '../store';
import { useTutorial } from '../useTutorial';

type Kind = BidRequest['kind'];

/** 売る側の考えの目安（正確な額は見せない） */
function stanceHint(role: string | undefined, listed: string | null | undefined, abroad: boolean): string {
  if (abroad) return `海外のクラブは、市場価値の${Math.round(TRANSFER.poolFee * 10)}割ほどで手放してくれそうです。`;
  if (listed === 'sale') return '移籍リストに載っている選手です。市場価値より安く手放してくれそうです。';
  if (listed === 'loan') return 'レンタルに出したい選手です。レンタルなら受けてもらいやすいです。';
  if (role === 'key') return '主力の選手です。市場価値よりかなり高い額でないと、手放さないでしょう。';
  if (role === 'rotation') return 'ローテーションの選手です。市場価値くらいの額なら、話になりそうです。';
  return '出番の少ない選手です。市場価値より少し安くても、手放してくれそうです。';
}

export function TransferBid({ playerId }: { playerId: string }) {
  useTutorial('bid');
  const game = useGame();
  const player = game.players[playerId];
  const myId = game.manager.clubId;
  const club = game.clubs[myId];
  const [kind, setKind] = useState<Kind>('transfer');
  // 最初の額は、見えている市場価値の幅の真ん中（本当の額は見せない）
  const [fee, setFee] = useState(() => {
    if (!player) return 0;
    const range = marketValueRange(game, player);
    return Math.round((range.low + range.high) / 2 / 1e6);
  });
  const [wageShare, setWageShare] = useState(1);
  const [result, setResult] = useState('');
  const abroad = !!player && isFoundOverseas(game, player);
  if (!player || !club || (!player.clubId && !abroad)) return <div className="page"><p>選手が見つかりません。</p></div>;

  const request: BidRequest = { kind, fee: fee * 1e6, wageShare };
  const problem = bidProblem(game, playerId, request);
  const open = openBidFor(game, playerId);
  const left = transferBudgetLeft(club);
  const clause = player.contract?.releaseClause ?? null;
  const start = nextWindowStart(game.date);

  const submit = () => {
    let message = '';
    store.update((g) => { message = placeBid(g, playerId, request).message; });
    setResult(message);
  };

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="secondary" onClick={() => store.back()}>← 戻る</button>
        <div>
          <h1>{player.name}の獲得</h1>
          <div className="muted">
            {POSITION_NAME[player.position]}　{player.age}歳　{player.clubId ? <ClubLink game={game} clubId={player.clubId} short /> : `海外のクラブ（${player.nationality}）`}
          </div>
        </div>
      </header>

      <div className="notice-box">
        {windowOpen(game.date)
          ? '今は移籍期間です。クラブと選手の両方と合意すれば、すぐに加入します。'
          : `今は移籍期間の外です。合意した移籍は、次の移籍期間（${formatDate(start, false)}）に成立します。`}
      </div>

      <div className="grid-2">
        <Panel title="選手と相手のクラブ" tutorial="bid-player">
          <dl className="facts">
            <dt>総合力</dt><dd><AttributeValue view={viewAttribute(overallRating(player), knowledgeOf(game, player), `${player.id}:overall`)} /></dd>
            <dt>市場価値</dt><dd>{formatValueRange(marketValueRange(game, player))}</dd>
            <dt>契約</dt><dd>{player.contract ? `${player.contract.endYear}年まで（${SQUAD_ROLE_LABEL[player.contract.role]}）` : 'なし'}</dd>
            <dt>違約金</dt><dd>{clause === null ? 'なし' : yenText(clause)}</dd>
            <dt>相手の考え</dt><dd className="small">{stanceHint(player.contract?.role, player.listed, abroad)}</dd>
            <dt>移籍予算の残り</dt><dd className={left < 0 ? 'tone-low' : ''}>{yenText(left)}</dd>
          </dl>
        </Panel>

        <Panel title="申し込む" tutorial="bid-offer">
          {open ? (
            <>
              <p>この選手とは交渉中です：{bidStatusLabel(open, myId)}</p>
              <BidActions game={game} bid={open} />
            </>
          ) : (
            <>
              <div className="segmented" style={{ marginBottom: 12 }}>
                <button type="button" className={kind === 'transfer' ? 'active' : ''} onClick={() => setKind('transfer')}>移籍金を出す</button>
                <button type="button" className={kind === 'clause' ? 'active' : ''} disabled={clause === null || abroad} onClick={() => setKind('clause')}>違約金を払う</button>
                <button type="button" className={kind === 'loan' ? 'active' : ''} disabled={abroad || !loanable(game, player)} onClick={() => setKind('loan')}>レンタル</button>
              </div>
              <div className="offer-form">
                {kind === 'transfer' && (
                  <>
                    <label htmlFor="fee">移籍金（百万円）</label>
                    <input id="fee" type="number" min={1} step={10} value={fee} onChange={(e) => setFee(Math.max(0, Number(e.target.value) || 0))} />
                    <span className="hint muted small">数日後に、受ける・額を返す・断るのどれかの返事が届きます。安すぎると断られます。</span>
                  </>
                )}
                {kind === 'clause' && (
                  <span className="hint muted small" style={{ gridColumn: '1 / -1' }}>
                    違約金{clause !== null ? yenText(clause) : ''}を払えば、{game.clubs[player.clubId ?? '']?.name}は断れません。すぐに選手と契約の話ができます。
                  </span>
                )}
                {kind === 'loan' && (
                  <>
                    <label htmlFor="share">年俸の負担</label>
                    <select id="share" value={wageShare} onChange={(e) => setWageShare(Number(e.target.value))}>
                      <option value={1}>全額をこちらが払う</option>
                      <option value={0.5}>半分をこちらが払う</option>
                    </select>
                    <span className="hint muted small">11月30日まで借ります。移籍金はかかりません。全額を払うほうが受けてもらいやすいです。</span>
                  </>
                )}
              </div>
              {problem && <p className="warning">{problem}</p>}
              <div className="button-row">
                <button type="button" className="primary" disabled={!!problem} onClick={submit}>申し込む</button>
              </div>
            </>
          )}
          {result && <p className="notice-box">{result}</p>}
        </Panel>
      </div>
    </div>
  );
}
