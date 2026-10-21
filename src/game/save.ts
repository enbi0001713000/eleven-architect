// セーブデータの形と、ファイルへの書き出し・読み込み。要件定義書「非機能要件」の「セーブの互換性」に対応する。
// セーブデータには版番号を持たせ、古い形のデータは新しい形に直してから読み込む。

import type { GameState } from './types';
import { STATE_VERSION } from './world';

export interface SaveFile {
  app: 'soccer-manager';
  version: number;
  savedAt: string;
  state: GameState;
}

export function toSaveFile(state: GameState): SaveFile {
  return { app: 'soccer-manager', version: STATE_VERSION, savedAt: new Date().toISOString(), state };
}

/** 古い版のセーブデータを、今の版の形に直す。版を上げたら、ここに変換を足していく。 */
function migrate(state: GameState, fromVersion: number): GameState {
  let current = state;
  for (let v = fromVersion; v < STATE_VERSION; v++) {
    // 例：if (v === 1) current = migrateV1toV2(current);
    current = { ...current, version: v + 1 };
  }
  return current;
}

export function parseSaveFile(text: string): GameState {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('セーブデータの形式が正しくありません（JSONとして読めません）');
  }
  const file = data as Partial<SaveFile>;
  if (file.app !== 'soccer-manager' || typeof file.version !== 'number' || !file.state) {
    throw new Error('このゲームのセーブデータではありません');
  }
  if (file.version > STATE_VERSION) {
    throw new Error('新しいバージョンのゲームで作られたセーブデータです。ゲームを更新してください');
  }
  return migrate(file.state, file.version);
}
