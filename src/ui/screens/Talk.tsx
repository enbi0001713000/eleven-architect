// 選手との面談：選手からの申し出への返事と、監督からの個人面談（要件定義書「面談と声かけ」）

import { useState } from 'react';
import { overallRating } from '../../engine/ratings';
import { moraleLabel } from '../../game/condition';
import { expectedPlayingTime, isUnhappyWithPlayingTime, promiseProgress, SQUAD_ROLE_LABEL } from '../../game/morale';
import {
  answerRequest, canPromise, MANAGER_TALKS, managerTalk, recentForm, REQUEST_REPLIES, talkCooldownLeft,
  type ManagerTalk, type RequestReply, type TalkOutcome,
} from '../../game/talks';
import { Morale, Panel } from '../components/bits';
import { POSITION_NAME } from '../format';
import { store, useGame } from '../store';

export function Talk({ playerId, requestId }: { playerId: string; requestId?: string }) {
  const game = useGame();
  const [outcome, setOutcome] = useState<TalkOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const player = game.players[playerId];
  if (!player) return <div className="page"><p>選手が見つかりません。</p></div>;
  const request = requestId ? game.requests.find((r) => r.id === requestId) : undefined;
  const promise = game.promises.find((p) => p.playerId === playerId);
  const form = recentForm(player);
  const cooldown = talkCooldownLeft(game, player);
  const role = player.contract?.role ?? 'backup';

  const run = (action: () => TalkOutcome) => {
    setError(null);
    try {
      let result: TalkOutcome | null = null;
      store.update(() => {
        result = action();
      });
      setOutcome(result);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="secondary" onClick={() => store.back()}>← 戻る</button>
        <h1>{player.name}との面談</h1>
      </header>
      <div className="grid-2">
        <Panel title="選手の様子">
          <dl className="facts">
            <dt>ポジション</dt><dd>{POSITION_NAME[player.position]}（{player.age}歳、総合力 {overallRating(player).toFixed(1)}）</dd>
            <dt>モラル</dt><dd><Morale value={player.status.morale} /></dd>
            <dt>約束した役割</dt><dd>{SQUAD_ROLE_LABEL[role]}</dd>
            <dt>出場機会</dt>
            <dd>
              最近の出場 {Math.round(player.status.playingTime * 100)}%（役割の目安 {Math.round(expectedPlayingTime(player) * 100)}%）
              {isUnhappyWithPlayingTime(player) && <span className="tag tag-warn" style={{ marginLeft: 6 }}>不満</span>}
            </dd>
            <dt>最近の出来</dt><dd>{form === null ? '最近は試合に出ていない' : `平均評価点 ${form.toFixed(2)}`}</dd>
            <dt>今季の出場</dt><dd>{player.season.appearances}試合（先発{player.season.starts}）</dd>
            {promise && <><dt>約束</dt><dd>第{promise.untilRound}節までに先発{promise.target}試合（いま {promiseProgress(game, promise)}試合）</dd></>}
          </dl>
        </Panel>

        <Panel title={request ? '出場機会についての申し出' : '個人面談'}>
          {outcome ? (
            <>
              <div className={`outcome ${outcome.tone}`}>{outcome.text}</div>
              <p className="muted small">モラル：{moraleLabel(player.status.morale)}（{outcome.morale >= 0 ? '+' : ''}{outcome.morale}）</p>
              <div className="button-row"><button type="button" className="primary" onClick={() => store.back()}>戻る</button></div>
            </>
          ) : request ? (
            <>
              <p>「{SQUAD_ROLE_LABEL[role]}として契約したのに、最近はほとんど試合に出られていません。」</p>
              <div className="option-cards">
                {REQUEST_REPLIES.map((r) => (
                  <button key={r.id} type="button" className="option-card" disabled={r.id === 'promise' && !canPromise(game)}
                    onClick={() => run(() => answerRequest(store.game!, request.id, r.id as RequestReply))}>
                    <strong>{r.label}</strong>
                    <span className="muted small">{r.id === 'promise' && !canPromise(game) ? '今シーズンの残り試合では約束できません' : r.description}</span>
                  </button>
                ))}
              </div>
            </>
          ) : player.clubId !== game.manager.clubId ? (
            <p className="muted">自分のクラブの選手とだけ面談できます。</p>
          ) : cooldown > 0 ? (
            <p className="muted">最近話をしたばかりです。あと{cooldown}日たつと、また面談できます。</p>
          ) : (
            <div className="option-cards">
              {MANAGER_TALKS.map((t) => (
                <button key={t.id} type="button" className="option-card" onClick={() => run(() => managerTalk(store.game!, player.id, t.id as ManagerTalk))}>
                  <strong>{t.label}</strong>
                  <span className="muted small">{t.description}</span>
                </button>
              ))}
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </Panel>
      </div>
    </div>
  );
}
