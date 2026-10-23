// 会話画面の部品。相手のセリフが1文ずつ流れ、最後に返事を選ぶ。
// 押すと、今の文をすぐに出し終える（もう一度押すと次の文へ）。自分の返事は、選んだらすぐに出る。

import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface ConversationLine {
  /** them：相手、me：監督（自分）、note：地の文（様子や結果） */
  who: 'them' | 'me' | 'note';
  text: string;
}

export interface Speaker {
  name: string;
  /** 肩書き（オーナー、営業担当、FW など） */
  role: string;
  kind: 'owner' | 'staff' | 'player' | 'press';
  /** 丸い顔の色（選手はクラブの色） */
  color?: string;
  /** 顔のイラスト（あれば丸い顔の代わりに出す） */
  portrait?: (size: number) => ReactNode;
}

export interface ConversationChoice {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** 1文字ずつ出す間隔（ミリ秒）と、1回に出す文字数 */
const TICK = 28;
const STEP = 2;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** 明るい色の上では黒い文字にする */
function inkFor(hex: string): string {
  const v = Number.parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111' : '#fff';
}

export function Avatar({ speaker, size = 44 }: { speaker: Pick<Speaker, 'name' | 'kind' | 'color' | 'portrait'>; size?: number }) {
  if (speaker.portrait) {
    return <span className={`avatar avatar-face avatar-${speaker.kind}`} style={{ width: size, height: size }} aria-hidden="true">{speaker.portrait(size)}</span>;
  }
  const colors = speaker.color ? { background: speaker.color, color: inkFor(speaker.color) } : {};
  return (
    <span className={`avatar avatar-${speaker.kind}`} style={{ width: size, height: size, fontSize: size * 0.42, ...colors }}
      aria-hidden="true">
      {speaker.name.slice(0, 1)}
    </span>
  );
}

export function Conversation({ speaker, me, lines, choices, onChoose, footer }: {
  speaker: Speaker;
  /** 監督の名前 */
  me: string;
  lines: ConversationLine[];
  /** すべての文が出たあとに見せる返事 */
  choices?: ConversationChoice[];
  onChoose?: (id: string) => void;
  /** 返事のかわりに、または返事の下に出すもの（ボタンなど） */
  footer?: ReactNode;
}) {
  const instant = prefersReducedMotion();
  const [shown, setShown] = useState(instant ? lines.length : 0);
  const [chars, setChars] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const current = lines[shown];

  useEffect(() => {
    if (!current) return;
    if (instant) {
      setShown(lines.length);
      return;
    }
    if (current.who !== 'me' && chars < current.text.length) {
      const t = setTimeout(() => setChars((c) => Math.min(current.text.length, c + STEP)), TICK);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setShown((s) => s + 1);
      setChars(0);
    }, current.who === 'me' ? 250 : 420);
    return () => clearTimeout(t);
  }, [current, chars, instant, lines.length]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [shown, chars, lines.length]);

  const done = shown >= lines.length;
  /** 押したら、今の文を出し終える。出し終えていたら次の文へ */
  const advance = () => {
    if (!current) return;
    if (current.who !== 'me' && chars < current.text.length) setChars(current.text.length);
    else {
      setShown((s) => s + 1);
      setChars(0);
    }
  };

  const renderLine = (line: ConversationLine, i: number, partial?: number) => {
    const text = partial === undefined ? line.text : line.text.slice(0, partial);
    if (line.who === 'note') return <p key={i} className="conv-note">{text}</p>;
    const mine = line.who === 'me';
    // 同じ人が続けて話すときは、顔と名前を省く
    const continued = lines[i - 1]?.who === line.who;
    return (
      <div key={i} className={`conv-line ${mine ? 'conv-me' : 'conv-them'}${continued ? ' conv-continued' : ''}`}>
        {!mine && (continued ? <span className="avatar-space" /> : <Avatar speaker={speaker} size={32} />)}
        <div className="conv-bubble">
          {!continued && <span className="conv-name">{mine ? `${me}（あなた）` : speaker.name}</span>}
          <span>{text}{partial !== undefined && partial < line.text.length ? <span className="conv-caret">▍</span> : null}</span>
        </div>
      </div>
    );
  };

  return (
    <section className="conversation">
      <header className="conv-header">
        <Avatar speaker={speaker} />
        <div>
          <strong>{speaker.name}</strong>
          <div className="muted small">{speaker.role}</div>
        </div>
        {!done && (
          <button type="button" className="link small conv-skip" onClick={() => setShown(lines.length)}>すべて表示</button>
        )}
      </header>
      <div className="conv-log" ref={logRef} onClick={advance} role="log" aria-live="polite">
        {lines.slice(0, shown).map((line, i) => renderLine(line, i))}
        {current && renderLine(current, shown, current.who === 'me' ? undefined : chars)}
        {!done && <p className="conv-hint muted small">クリックで次へ</p>}
      </div>
      {done && choices && choices.length > 0 && (
        <div className="option-cards conv-choices">
          {choices.map((c) => (
            <button key={c.id} type="button" className="option-card" disabled={c.disabled} onClick={() => onChoose?.(c.id)}>
              <strong>{c.label}</strong>
              {c.description && <span className="muted small">{c.description}</span>}
            </button>
          ))}
        </div>
      )}
      {done && footer}
    </section>
  );
}
