// タイトル画面：新しいゲーム、続きから、ファイルから読み込む、設定

import { useEffect, useRef, useState } from 'react';
import { APP_VERSION, ISSUES_URL } from '../about';
import { Emblem } from '../components/Emblem';
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
      <div className="title-hero">
        <TitlePitch />
        <div className="title-hero-inner">
          <div className="title-brand">
            <LogoMark />
            <div>
              <div className="title-logo">XI ARCHITECT</div>
              <h1>イレブン・アーキテクト</h1>
              <p>采配と経営で、クラブを設計する。日本風の架空の国で、監督とGMを兼ねる</p>
            </div>
          </div>
          <div className="title-buttons">
            <button type="button" className="primary large" onClick={() => store.open({ name: 'newGame' })}>新しいゲーム</button>
            <button type="button" className="secondary" onClick={() => fileInput.current?.click()}>ファイルから読み込む</button>
            <button type="button" className="secondary" onClick={() => store.navigate({ name: 'settings' })}>設定</button>
            <button type="button" className="secondary" disabled title="1.1以降で追加">エディタ（準備中）</button>
          </div>
        </div>
      </div>
      <div className="title-card">
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
                <SaveEmblem save={save} />
                <span className="save-text">
                <strong>{save.clubName}</strong>
                <span>監督 {save.managerName}</span>
                <span className="muted">{formatDate(save.date)}　{save.round > 34 ? '全日程終了' : `第${save.round}節の前`}</span>
                <span className="muted small">保存 {new Date(save.updatedAt).toLocaleString('ja-JP')}</span>
                </span>
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

        <div className="title-notes muted small">
          <p>PCのブラウザ向けです（Chrome、Edge、Firefox、Safari の新しい版）。</p>
          <p>セーブはこのブラウザの中にだけ残ります。ブラウザのデータを消すと消えるので、ときどき「書き出す」でファイルに残してください。別のPCで続けるときも、書き出したファイルを読み込みます。</p>
          <p>舞台は日本風の架空の国のリーグです。クラブ、選手、人物は、実在のものとは関係ありません。</p>
          <p>版 {APP_VERSION}　<a href={ISSUES_URL} target="_blank" rel="noreferrer">不具合や要望を知らせる</a></p>
        </div>
      </div>
    </div>
  );
}

/** セーブしたクラブのエンブレム（無職なら出さない） */
function SaveEmblem({ save }: { save: SaveRecord }) {
  const state = save.file.state;
  const club = state.clubs[state.manager.clubId];
  return club ? <Emblem spec={club.emblem} size={44} /> : <span className="save-emblem-empty" />;
}

/** タイトルの印：盾の中に XI */
function LogoMark() {
  return (
    <svg className="logo-mark" viewBox="0 0 100 116" width={92} height={107} aria-hidden="true">
      <path d="M50 4 L94 18 V60 Q94 96 50 112 Q6 96 6 60 V18 Z" fill="#ffffff" />
      <path d="M50 12 L86 23.5 V60 Q86 89 50 103 Q14 89 14 60 V23.5 Z" fill="#14532d" />
      <path d="M14 60 H86" stroke="#ffffff" strokeWidth={2} opacity={0.35} />
      <circle cx={50} cy={60} r={12} fill="none" stroke="#ffffff" strokeWidth={2} opacity={0.35} />
      <text x={50} y={74} textAnchor="middle" fontSize={40} fontWeight={900} fill="#ffffff" fontFamily="Georgia, 'Times New Roman', serif">XI</text>
    </svg>
  );
}

/** タイトルの背景：上から見たピッチの線 */
function TitlePitch() {
  return (
    <svg className="title-pitch" viewBox="0 0 105 68" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => <rect key={i} x={(105 / 12) * i} y={0} width={105 / 12} height={68} fill={i % 2 ? '#1b6b3c' : '#186236'} />)}
      <g fill="none" stroke="#ffffff" strokeOpacity={0.13} strokeWidth={0.4}>
        <rect x={3} y={3} width={99} height={62} />
        <line x1={52.5} y1={3} x2={52.5} y2={65} />
        <circle cx={52.5} cy={34} r={9.15} />
        <rect x={3} y={13.85} width={16.5} height={40.3} />
        <rect x={85.5} y={13.85} width={16.5} height={40.3} />
        <rect x={3} y={24.85} width={5.5} height={18.3} />
        <rect x={96.5} y={24.85} width={5.5} height={18.3} />
      </g>
    </svg>
  );
}
