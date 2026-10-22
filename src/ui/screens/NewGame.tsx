// 新しいゲーム：監督の名前と、就任するクラブを選ぶ（要件定義書「新しいゲームの始め方」）

import { useMemo, useState } from 'react';
import type { GameState } from '../../game/types';
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
  const world: GameState = useMemo(() => createWorld(seed), [seed]);
  const clubs = Object.values(world.clubs).sort((a, b) => SIZE_ORDER[a.size] - SIZE_ORDER[b.size] || b.level - a.level);

  const start = async () => {
    if (!clubId || !name.trim()) return;
    setBusy(true);
    const state = startNewGame(createWorld(seed), name.trim(), clubId);
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

      <h2>就任するクラブを選ぶ</h2>
      <div className="club-grid">
        {clubs.map((club) => (
          <button key={club.id} type="button" className={`club-card${clubId === club.id ? ' selected' : ''}`}
            onClick={() => setClubId(club.id)}>
            <Emblem spec={club.emblem} size={44} />
            <div className="club-card-text">
              <strong>{club.name}</strong>
              <span className="muted small">{club.hometown}　規模：{SIZE_LABEL[club.size]}</span>
              <span className="small">オーナーの目標：{goalLabel(positionGoalFor(world, club.id))}</span>
              <span className="muted small">{club.stadium.name}（{club.stadium.capacity.toLocaleString('ja-JP')}人）</span>
            </div>
          </button>
        ))}
      </div>

      <div className="page-footer">
        {!name.trim() && <span className="muted">監督の名前を入れてください</span>}
        {name.trim() && !clubId && <span className="muted">クラブを選んでください</span>}
        <button type="button" className="primary large" disabled={!clubId || !name.trim() || busy} onClick={() => void start()}>
          この内容で始める
        </button>
      </div>
    </div>
  );
}
