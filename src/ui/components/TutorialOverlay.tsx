// チュートリアルの表示：案内役のアシスタントコーチが、会話と同じ見た目で説明する。
// 説明している部品を光らせ、ほかの部分を少し暗くする（光っている部品も、ほかの部品も押せる）。

import { useEffect, useState } from 'react';
import { coachName } from '../coach';
import { store, useStore } from '../store';
import { TUTORIALS } from '../tutorials';
import { Avatar } from './Conversation';
import { StaffFace } from './Face';

interface Rect { top: number; left: number; width: number; height: number }

const PAD = 6;

function measure(selector: string | undefined): Rect | null {
  if (!selector || typeof document === 'undefined') return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

export function TutorialOverlay() {
  const s = useStore();
  const current = s.tutorial;
  const tutorial = current ? TUTORIALS[current.id] : null;
  const game = s.game;
  const club = game ? game.clubs[game.manager.clubId] : undefined;
  const step = tutorial && current ? tutorial.steps[current.step] : undefined;
  const [rect, setRect] = useState<Rect | null>(null);

  // 光らせる部品を画面に入れてから、位置を測る。スクロールや画面の大きさが変わったら測り直す
  useEffect(() => {
    if (!step) return;
    const el = step.target ? document.querySelector(step.target) : null;
    el?.scrollIntoView({ block: 'center', inline: 'nearest' });
    const update = () => setRect(measure(step.target));
    update();
    const late = setTimeout(update, 120);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      clearTimeout(late);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [step, current?.id, current?.step]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.closeTutorial();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current]);

  if (!current || !tutorial || !step) return null;
  const last = current.step === tutorial.steps.length - 1;
  // 光らせる部品が画面の下のほうにあるときは、説明を上に出す
  const atTop = rect !== null && rect.top + rect.height > window.innerHeight - 260;

  return (
    <div className="tutorial" role="dialog" aria-modal="false" aria-label={`チュートリアル：${tutorial.title}`}>
      {rect
        ? <div className="tutorial-spotlight" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />
        : <div className="tutorial-dim" />}
      <div className={`tutorial-card${atTop ? ' top' : ''}`}>
        <div className="tutorial-head">
          <Avatar speaker={{
            name: 'アシスタントコーチ', kind: 'staff',
            portrait: club && game ? (size) => <StaffFace seed={`${club.id}:coach`} age={38} tie={club.colors.primary} size={size} /> : undefined,
          }} size={40} />
          <div>
            <div className="conv-name">アシスタントコーチ{club && game ? ` ${coachName(game, club.id)}` : ''}</div>
            <strong>{tutorial.title}</strong>
          </div>
          <span className="muted small tutorial-count">{current.step + 1} / {tutorial.steps.length}</span>
        </div>
        <p className="tutorial-text">{step.text}</p>
        <div className="tutorial-actions">
          <button type="button" className="link small" onClick={() => store.disableTutorials()}>チュートリアルをすべて切る</button>
          <button type="button" className="link small" onClick={() => store.closeTutorial()}>この説明を閉じる</button>
          <span className="tutorial-spacer" />
          {current.step > 0 && <button type="button" className="secondary" onClick={() => store.tutorialStep(-1)}>戻る</button>}
          <button type="button" className="primary" autoFocus onClick={() => store.tutorialStep(1)}>{last ? '終わる' : '次へ'}</button>
        </div>
      </div>
    </div>
  );
}
