// セーブデータの形と、ファイルへの書き出し・読み込み。要件定義書「非機能要件」の「セーブの互換性」に対応する。
// セーブデータには版番号を持たせ、古い形のデータは新しい形に直してから読み込む。

import { assignSquadRoles, defaultClubTraining, defaultFamiliarity, playerPhase2Fields } from './defaults';
import { addMessage } from './inbox';
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
    if (v === 1) current = migrateV1toV2(current);
    current = { ...current, version: v + 1 };
  }
  return current;
}

/** フェーズ1（版1）→ フェーズ2（版2）：選手の状態、練習、熟成度、受信箱などを足す */
function migrateV1toV2(state: GameState): GameState {
  for (const player of Object.values(state.players)) {
    const fields = playerPhase2Fields();
    player.status ??= fields.status;
    player.trainingFocus ??= null;
    player.injuryHistory ??= [];
    player.career ??= [];
    player.lastTalk ??= null;
    if (player.contract && !player.contract.role) player.contract.role = 'backup';
  }
  for (const club of Object.values(state.clubs)) {
    club.training ??= defaultClubTraining();
    club.familiarity ??= defaultFamiliarity(club.tactics.formation, club.tactics.instructions);
  }
  const next: GameState = {
    ...state,
    inbox: state.inbox ?? [],
    nextMessageNumber: state.nextMessageNumber ?? 1,
    requests: state.requests ?? [],
    promises: state.promises ?? [],
    history: state.history ?? [],
    fanMood: state.fanMood ?? 50,
    managerRelations: state.managerRelations ?? {},
    lastTeamMeeting: state.lastTeamMeeting ?? null,
  };
  for (const id of Object.keys(next.clubs)) assignSquadRoles(next, id);
  addMessage(next, {
    category: 'club', from: 'アシスタントコーチ', important: false,
    subject: 'フェーズ2の機能が使えるようになりました',
    body: '受信箱、練習、選手の状態（コンディション、疲労、モラル、ケガ）、面談、記者会見、試合の声かけが加わりました。\n'
      + 'これからは「次の出来事まで進める」で1日ずつ時間が進みます。',
  });
  return next;
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
