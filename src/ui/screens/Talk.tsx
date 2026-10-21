// 選手との面談：選手からの申し出への返事と、監督からの個人面談（要件定義書「面談と声かけ」）。会話画面で話す。

import { useState } from 'react';
import { overallRating } from '../../engine/ratings';
import { moraleLabel } from '../../game/condition';
import { expectedPlayingTime, isUnhappyWithPlayingTime, promiseProgress, SQUAD_ROLE_LABEL } from '../../game/morale';
import {
  answerRequest, canPromise, MANAGER_TALKS, managerTalk, recentForm, REQUEST_REPLIES, talkCooldownLeft,
  type ManagerTalk, type RequestReply, type TalkOutcome,
} from '../../game/talks';
import { Morale, Panel } from '../components/bits';
import { Conversation, type ConversationLine } from '../components/Conversation';
import { POSITION_NAME } from '../format';
import { store, useGame } from '../store';

/** 「…」の中だけを、監督のセリフとして使う */
const spoken = (label: string): string => label.match(/「(.+?)」/)?.[1] ?? label;

export function Talk({ playerId, requestId }: { playerId: string; requestId?: string }) {
  const game = useGame();
  const player = game.players[playerId];
  const request = requestId ? game.requests.find((r) => r.id === requestId) : undefined;
  const requestMessage = requestId ? game.inbox.find((m) => m.action?.kind === 'playerRequest' && m.action.requestId === requestId) : undefined;
  const morale = player?.status.morale ?? 60;
  const greeting = morale >= 60 ? 'はい、監督。何でしょうか。' : morale >= 40 ? '……はい。何でしょう。' : '……何ですか。';
  const [lines, setLines] = useState<ConversationLine[]>(() => {
    if (request && requestMessage) return requestMessage.body.split('\n').filter((l) => l.trim() !== '').map((text) => ({ who: 'them', text }));
    return [{ who: 'me', text: `${player?.name.split(' ')[0] ?? ''}、少しいいか。` }, { who: 'them', text: greeting }];
  });
  const [outcome, setOutcome] = useState<TalkOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!player) return <div className="page"><p>選手が見つかりません。</p></div>;
  const promise = game.promises.find((p) => p.playerId === playerId);
  const form = recentForm(player);
  const cooldown = talkCooldownLeft(game, player);
  const role = player.contract?.role ?? 'backup';
  const club = player.clubId ? game.clubs[player.clubId] : undefined;

  const run = (say: string, action: () => TalkOutcome) => {
    setError(null);
    try {
      let result: TalkOutcome | null = null;
      store.update(() => {
        result = action();
      });
      const done = result as TalkOutcome | null;
      setOutcome(done);
      if (done) {
        setLines([...lines, { who: 'me', text: say }, { who: 'note', text: done.text },
          { who: 'note', text: `モラル：${moraleLabel(store.game?.players[playerId]?.status.morale ?? morale)}（${done.morale >= 0 ? '+' : ''}${done.morale}）` }]);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const mine = player.clubId === game.manager.clubId;
  const choices = outcome ? undefined : request
    ? REQUEST_REPLIES.map((r) => ({
      id: r.id, label: r.label,
      description: r.id === 'promise' && !canPromise(game) ? '今シーズンの残り試合では約束できません' : r.description,
      disabled: r.id === 'promise' && !canPromise(game),
    }))
    : mine && cooldown === 0 ? MANAGER_TALKS.map((t) => ({ id: t.id, label: `「${t.say}」`, description: `${t.label}。${t.description}` })) : undefined;
  const choose = (id: string) => {
    if (request) {
      const reply = REQUEST_REPLIES.find((r) => r.id === id);
      if (reply) run(spoken(reply.label), () => answerRequest(store.game!, request.id, id as RequestReply));
    } else {
      const talk = MANAGER_TALKS.find((t) => t.id === id);
      if (talk) run(talk.say, () => managerTalk(store.game!, player.id, id as ManagerTalk));
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="secondary" onClick={() => store.back()}>← 戻る</button>
        <h1>{player.name}との面談{request ? '（出場機会についての申し出）' : ''}</h1>
      </header>
      <div className="grid-2">
        <div>
          {!request && !mine && <Panel><p className="muted">自分のクラブの選手とだけ面談できます。</p></Panel>}
          {!request && !outcome && mine && cooldown > 0 && <Panel><p className="muted">最近話をしたばかりです。あと{cooldown}日たつと、また面談できます。</p></Panel>}
          {(request || (mine && cooldown === 0) || outcome) && (
            <Conversation
              speaker={{ name: player.name, role: `${POSITION_NAME[player.position]}・${player.age}歳`, kind: 'player', color: club?.colors.primary }}
              me={game.manager.name} lines={lines} choices={choices} onChoose={choose}
              footer={outcome ? <div className="button-row"><button type="button" className="primary" onClick={() => store.back()}>戻る</button></div> : undefined} />
          )}
          {error && <p className="error">{error}</p>}
        </div>
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
      </div>
    </div>
  );
}
