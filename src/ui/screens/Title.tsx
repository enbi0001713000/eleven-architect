// タイトル画面：新しいゲーム、続きから、ファイルから読み込む、設定

import { useEffect, useRef, useState } from 'react';
import { formatDate } from '../format';
import { deleteSave, downloadSave, importSave, listSaves, loadSave, type SaveRecord } from '../storage';
import { store } from '../store';

export function Title() {
  const [saves, setSaves] = useState<SaveRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => {
    listSaves().then(setSaves).catch(() => {
      setSaves([]);
      setError('この環境ではブラウザに保存できません。遊べますが、セーブはファイルへの書き出しを使ってください');
    });
  };
  useEffect(refresh, []);

  const open = async (id: string) => {
    try {
      const state = await loadSave(id);
      store.setGame(state, id);
      store.open({ name: 'home' });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { id, state } = await importSave(file);
      store.setGame(state, id);
      store.open({ name: 'home' });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="title-screen">
      <div className="title-card">
        <h1>サッカークラブ経営ゲーム</h1>
        <p className="muted">日本風の架空の国で、クラブの監督とGMを兼ねる</p>
        <div className="title-buttons">
          <button type="button" className="primary large" onClick={() => store.open({ name: 'newGame' })}>新しいゲーム</button>
          <button type="button" className="secondary" onClick={() => fileInput.current?.click()}>ファイルから読み込む</button>
          <button type="button" className="secondary" onClick={() => store.navigate({ name: 'settings' })}>設定</button>
          <button type="button" className="secondary" disabled title="フェーズ4以降で追加">エディタ（準備中）</button>
        </div>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden
          onChange={(e) => void onImport(e.target.files?.[0])} />
        {error && <p className="error">{error}</p>}

        <h2>続きから</h2>
        {saves === null && <p className="muted">読み込み中…</p>}
        {saves?.length === 0 && <p className="muted">セーブデータはまだありません</p>}
        <ul className="save-list">
          {saves?.map((save) => (
            <li key={save.id}>
              <button type="button" className="save-open" onClick={() => void open(save.id)}>
                <strong>{save.clubName}</strong>
                <span>監督 {save.managerName}</span>
                <span className="muted">{formatDate(save.date)}　{save.round > 34 ? '全日程終了' : `第${save.round}節の前`}</span>
                <span className="muted small">保存 {new Date(save.updatedAt).toLocaleString('ja-JP')}</span>
              </button>
              <div className="save-actions">
                <button type="button" className="secondary small" onClick={() => void loadSave(save.id).then(downloadSave)}>書き出す</button>
                <button type="button" className="danger small" onClick={() => {
                  if (window.confirm(`${save.clubName}（監督 ${save.managerName}）のセーブデータを削除します。元に戻せません。よろしいですか？`)) {
                    void deleteSave(save.id).then(refresh);
                  }
                }}>削除</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
