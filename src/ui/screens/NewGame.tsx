// 新しいゲーム：監督の名前と経歴、難易度、就任するクラブを選ぶ（要件定義書「新しいゲームの始め方」「難易度」）

import { useMemo, useState } from 'react';
import { startTrustFor } from '../../game/career';
import { BACKGROUND_ORDER, BACKGROUNDS, DIFFICULTIES, DIFFICULTY_ORDER } from '../../game/careerBalance';
import { OWNER } from '../../game/ownerBalance';
import type { Difficulty, GameState, ManagerBackground } from '../../game/types';
import { goalLabel, positionGoalFor } from '../../game/owner';
import { createWorld, startNewGame } from '../../game/world';
import { Emblem } from '../components/Emblem';
import { SIZE_LABEL } from '../format';
import { newSlotId, writeSave } from '../storage';
import { store } from '../store';

const randomSeed = () => Math.floor(Math.random() * 1_000_000);
const SIZE_ORDER = { large: 0, medium: 1, small: 2 } as const;

export function NewGame() {
  const [seed, setSeed] = useState(randomSeed);
  const [name, setName] = useState('');
  const [clubId, setClubId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [background, setBackground] = useState<ManagerBackground>('coach');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const reputation = BACKGROUNDS[background].reputation;
  // 初めて遊ぶ人は、チュートリアルを最初から見る
  const [tutorial, setTutorial] = useState(() => store.settings.tutorialSeen.length === 0 || !store.settings.tutorials);
  const world: GameState = useMemo(() => createWorld(seed), [seed]);
  const clubs = Object.values(world.clubs).sort((a, b) => SIZE_ORDER[a.size] - SIZE_ORDER[b.size] || b.level - a.level);

  const start = async () => {
    if (!clubId || !name.trim()) return;
    setBusy(true);
    if (tutorial) store.updateSettings({ tutorials: true, tutorialSeen: [] });
    const state = startNewGame(createWorld(seed), name.trim(), clubId, { background, difficulty });
    const id = newSlotId();
    try {
      await writeSave(id, state);
    } catch {
      // 保存できない環境でも遊べるようにする
    }
    store.setGame(state, id);
    store.open({ name: 'home' });
    // 最初に、オーナーから今シーズンの予算の話を聞く
    const budget = state.inbox.find((m) => m.topic === 'budget');
    const talk = store.conversationFor(budget);
    if (talk) store.navigate(talk);
  };

  return (
    <div className="page new-game">
      <header className="page-header">
        <button type="button" className="secondary" onClick={() => store.open({ name: 'title' })}>← タイトルへ</button>
        <h1>新しいゲーム</h1>
      </header>

      <section className="panel">
        <div className="panel-body form-row">
          <label>
            監督の名前
            <input value={name} maxLength={20} placeholder="例：山田 太郎" onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            世界のシード
            <input type="number" value={seed} onChange={(e) => { setSeed(Number(e.target.value) || 0); setClubId(null); }} />
          </label>
          <button type="button" className="secondary" onClick={() => { setSeed(randomSeed()); setClubId(null); }}>別の世界を作る</button>
        </div>
      </section>

      <h2>監督の経歴</h2>
      <div className="option-grid">
        {BACKGROUND_ORDER.map((b) => (
          <button key={b} type="button" className={`option-card${background === b ? ' active' : ''}`} onClick={() => setBackground(b)} aria-pressed={background === b}>
            <strong>{BACKGROUNDS[b].label}</strong>
            <span className="small">最初の評判 {BACKGROUNDS[b].reputation}</span>
            <span className="muted small">{BACKGROUNDS[b].perk}</span>
          </button>
        ))}
      </div>
      <p className="muted small">評判が高いほど、大きいクラブで信頼され、オファーも届きやすくなります。評判は成績で上下します。</p>

      <h2>難易度</h2>
      <div className="option-grid three">
        {DIFFICULTY_ORDER.map((d) => (
          <button key={d} type="button" className={`option-card${difficulty === d ? ' active' : ''}`} onClick={() => setDifficulty(d)} aria-pressed={difficulty === d}>
            <strong>{DIFFICULTIES[d].label}</strong>
            <span className="muted small">{DIFFICULTIES[d].description}</span>
          </button>
        ))}
      </div>

      <h2>就任するクラブを選ぶ</h2>
      <p className="muted small">どのクラブも選べます。ただし、クラブの評判が監督の評判（{reputation}）より大きく上だと、オーナーの最初の信頼度が低くなります。</p>
      <div className="club-grid">
        {clubs.map((club) => (
          <button key={club.id} type="button" className={`club-card${clubId === club.id ? ' selected' : ''}`}
            onClick={() => setClubId(club.id)}>
            <Emblem spec={club.emblem} size={44} />
            <div className="club-card-text">
              <strong>{club.name}</strong>
              <span className="muted small">{club.hometown}　規模：{SIZE_LABEL[club.size]}</span>
              <span className="small">オーナーの目標：{goalLabel(positionGoalFor(world, club.id))}</span>
              <span className={`small${startTrustFor(club.reputation, reputation) < OWNER.startTrust ? ' tone-low' : ' muted'}`}>
                評判 {club.reputation}　最初の信頼度 {startTrustFor(club.reputation, reputation)}
              </span>
              <span className="muted small">{club.stadium.name}（{club.stadium.capacity.toLocaleString('ja-JP')}人）</span>
            </div>
          </button>
        ))}
      </div>

      <div className="page-footer">
        <label className="inline">
          <input type="checkbox" checked={tutorial} onChange={(e) => setTutorial(e.target.checked)} />
          チュートリアルを最初から見る
        </label>
        {!name.trim() && <span className="muted">監督の名前を入れてください</span>}
        {name.trim() && !clubId && <span className="muted">クラブを選んでください</span>}
        <button type="button" className="primary large" disabled={!clubId || !name.trim() || busy} onClick={() => void start()}>
          この内容で始める
        </button>
      </div>
    </div>
  );
}
