// 記者会見：記者の質問に、1つずつ答える（会話画面）。答え方で、選手のモラル、ファンの反応、相手監督との関係が変わる（要件定義書「面談と声かけ」）

import { useState } from 'react';
import { answerPress, pressQuestions } from '../../game/talks';
import { Panel } from '../components/bits';
import { Conversation, type ConversationLine } from '../components/Conversation';
import { store, useGame } from '../store';

const spoken = (label: string): string => label.match(/「(.+?)」/)?.[1] ?? label;

export function Press({ fixtureId }: { fixtureId: string }) {
  const game = useGame();
  const fixture = game.fixtures.find((f) => f.id === fixtureId);
  const message = game.inbox.find((m) => m.action?.kind === 'press' && m.action.fixtureId === fixtureId);
  const [questions] = useState(() => pressQuestions(game, fixtureId));
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<ConversationLine[]>(() => [
    { who: 'note', text: '会見場には、たくさんの記者が集まっている。' },
    ...(questions[0] ? [{ who: 'them' as const, text: questions[0].text }] : []),
  ]);
  const [finished, setFinished] = useState(false);
  const closed = !fixture || fixture.result !== null || (message?.resolved && !finished);
  const current = questions[Object.keys(answers).length];

  const choose = (id: string) => {
    if (!current) return;
    const answer = current.answers.find((a) => a.id === id);
    const next = { ...answers, [current.id]: id };
    setAnswers(next);
    const following = questions[Object.keys(next).length];
    const added: ConversationLine[] = [{ who: 'me', text: spoken(answer?.label ?? '') }];
    if (following) {
      added.push({ who: 'them', text: following.text });
    } else {
      let notes: string[] = [];
      store.update((g) => {
        notes = answerPress(g, fixtureId, next);
      });
      added.push({ who: 'them', text: 'ありがとうございました。' });
      added.push(...(notes.length > 0 ? notes : ['特に話題にはならなかった。']).map((text) => ({ who: 'note' as const, text })));
      setFinished(true);
    }
    setLines([...lines, ...added]);
  };

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="secondary" onClick={() => store.back()}>← 戻る</button>
        <h1>記者会見</h1>
      </header>
      {closed ? (
        <Panel><p className="muted">この記者会見は終わっています。</p></Panel>
      ) : (
        <Conversation speaker={{ name: '記者', role: '試合前の記者会見', kind: 'press' }} me={game.manager.name} lines={lines}
          choices={finished || !current ? undefined : current.answers.map((a) => ({ id: a.id, label: a.label }))}
          onChoose={choose}
          footer={finished ? <div className="button-row"><button type="button" className="primary" onClick={() => store.back()}>戻る</button></div> : undefined} />
      )}
    </div>
  );
}
