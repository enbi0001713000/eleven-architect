// 記者会見：質問に答える。答え方で、選手のモラル、ファンの反応、相手監督との関係が変わる（要件定義書「面談と声かけ」）

import { useState } from 'react';
import { answerPress, pressQuestions } from '../../game/talks';
import { Panel } from '../components/bits';
import { store, useGame } from '../store';

export function Press({ fixtureId }: { fixtureId: string }) {
  const game = useGame();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<string[] | null>(null);
  const fixture = game.fixtures.find((f) => f.id === fixtureId);
  const message = game.inbox.find((m) => m.action?.kind === 'press' && m.action.fixtureId === fixtureId);
  const questions = pressQuestions(game, fixtureId);
  const closed = !fixture || fixture.result !== null || message?.resolved;

  const submit = () => {
    let result: string[] = [];
    store.update((g) => {
      result = answerPress(g, fixtureId, answers);
    });
    setNotes(result);
  };

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="secondary" onClick={() => store.back()}>← 戻る</button>
        <h1>記者会見</h1>
      </header>
      {notes ? (
        <Panel title="記者会見を終えて">
          <ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          {notes.length === 0 && <p className="muted">特に話題にはなりませんでした。</p>}
          <div className="button-row"><button type="button" className="primary" onClick={() => store.back()}>戻る</button></div>
        </Panel>
      ) : closed ? (
        <Panel><p className="muted">この記者会見は終わっています。</p></Panel>
      ) : (
        <>
          {questions.map((q) => (
            <Panel key={q.id} title={`記者：${q.text}`}>
              <div className="option-cards">
                {q.answers.map((a) => (
                  <button key={a.id} type="button" className={`option-card${answers[q.id] === a.id ? ' active' : ''}`}
                    onClick={() => setAnswers({ ...answers, [q.id]: a.id })}>
                    {a.label}
                  </button>
                ))}
              </div>
            </Panel>
          ))}
          <div className="button-row">
            <button type="button" className="primary" disabled={Object.keys(answers).length < questions.length} onClick={submit}>答える</button>
            <span className="muted small">すべての質問に答えを選んでください。</span>
          </div>
        </>
      )}
    </div>
  );
}
