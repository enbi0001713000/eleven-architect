// セーブデータの保存先（ブラウザの中の IndexedDB）。要件定義書「非機能要件」の「セーブ」「バックアップ」に対応する。

import Dexie, { type Table } from 'dexie';
import { parseSaveFile, toSaveFile, type SaveFile } from '../game/save';
import type { GameState } from '../game/types';

export interface SaveRecord {
  id: string;
  managerName: string;
  clubName: string;
  round: number;
  date: string;
  updatedAt: string;
  file: SaveFile;
}

class SaveDatabase extends Dexie {
  saves!: Table<SaveRecord, string>;

  constructor() {
    super('soccer-manager');
    this.version(1).stores({ saves: 'id, updatedAt' });
  }
}

const db = new SaveDatabase();

export function newSlotId(): string {
  return `save-${Date.now().toString(36)}`;
}

export async function writeSave(id: string, state: GameState): Promise<void> {
  const club = state.clubs[state.manager.clubId];
  await db.saves.put({
    id,
    managerName: state.manager.name,
    clubName: club?.name ?? '無職',
    round: state.season.round,
    date: state.date,
    updatedAt: new Date().toISOString(),
    file: toSaveFile(state),
  });
}

export async function listSaves(): Promise<SaveRecord[]> {
  return db.saves.orderBy('updatedAt').reverse().toArray();
}

export async function loadSave(id: string): Promise<GameState> {
  const record = await db.saves.get(id);
  if (!record) throw new Error('セーブデータが見つかりません');
  return parseSaveFile(JSON.stringify(record.file));
}

export async function deleteSave(id: string): Promise<void> {
  await db.saves.delete(id);
}

/** セーブデータをファイルとしてダウンロードする */
export function downloadSave(state: GameState): void {
  const club = state.clubs[state.manager.clubId];
  const blob = new Blob([JSON.stringify(toSaveFile(state))], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `xi-architect_${club?.shortName ?? 'save'}_${state.date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // すぐに消すと、ブラウザによってはファイル名が付かずにダウンロードされるので、少し待つ
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** ファイルから読み込んで、新しいセーブ枠に入れる */
export async function importSave(file: File): Promise<{ id: string; state: GameState }> {
  const state = parseSaveFile(await file.text());
  const id = newSlotId();
  await writeSave(id, state);
  return { id, state };
}
