// セーブデータの形と、ファイルへの書き出し・読み込み。要件定義書「非機能要件」の「セーブの互換性」に対応する。
// セーブデータには版番号を持たせ、古い形のデータは新しい形に直してから読み込む。

import { overallRating } from '../engine/ratings';
import { createRng } from '../engine/rng';
import { assignSquadRoles, defaultClubTraining, defaultFamiliarity, playerPhase2Fields } from './defaults';
import { potentialFor } from './development';
import { initFinances } from './finance';
import { createFanClub, totalMembers } from './fanClub';
import { addMessage } from './inbox';
import { goalLabel, initialOwner } from './owner';
import type { GameState } from './types';
import { salaryFor, SIZE_PROFILE, STATE_VERSION } from './world';

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
    if (v === 2) current = migrateV2toV3(current);
    if (v === 3) current = migrateV3toV4(current);
    if (v === 4) current = migrateV4toV5(current);
    current = { ...current, version: v + 1 };
  }
  return current;
}

/** フェーズ1（版1）→ フェーズ2（版2）：選手の状態、練習、熟成度、受信箱などを足す */
function migrateV1toV2(state: GameState): GameState {
  // 版1の潜在能力は総合力と目盛りが違ったので、今の総合力と年齢から決め直す
  const rng = createRng(state.seed ^ 0x5a17);
  for (const player of Object.values(state.players)) {
    player.hidden.potential = potentialFor(rng, overallRating(player), player.age);
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

/** フェーズ2（版2）→ フェーズ3-A（版3）：クラブのお金を足し、年俸を新しい水準で計算し直す */
function migrateV2toV3(state: GameState): GameState {
  for (const player of Object.values(state.players)) {
    const club = player.clubId ? state.clubs[player.clubId] : undefined;
    if (player.contract && club) player.contract.salary = salaryFor(overallRating(player), SIZE_PROFILE[club.size].salary);
  }
  // 年の途中から始めるので、今年の収支はこの日から数える
  initFinances(state, createRng(state.seed ^ 0x3f1a), state.season.year, false);
  addMessage(state, {
    category: 'finance', from: '経理担当', important: false,
    subject: 'フェーズ3-Aの機能（お金）が使えるようになりました',
    body: '入場料、スポンサー、グッズ、年俸などのお金の出入りと、予算、借り入れ、チケットの値段が加わりました。財務の画面で見られます。\n'
      + '年俸の水準を見直したため、全選手の年俸を計算し直しました。今年の収支は、今日から数えます。',
  });
  return state;
}

/** フェーズ3-A（版3）→ フェーズ3-B（版4）：オーナー（目標と信頼度）を足す */
/** 版4（フェーズ3-B）→ 版5（フェーズ3.5）：ファンクラブを足す。会員はファンの数から作る */
function migrateV4toV5(state: GameState): GameState {
  for (const club of Object.values(state.clubs)) club.fanClub ??= createFanClub(club);
  const mine = state.clubs[state.manager.clubId];
  addMessage(state, {
    category: 'club', from: 'ファンクラブ担当', important: false,
    subject: 'ファンクラブの機能が使えるようになりました',
    body: `ファンクラブの会員は今、約${(mine ? totalMembers(mine.fanClub.members) : 0).toLocaleString('ja-JP')}人です。`
      + '年会費は12月から2月に入ります。クラブの画面の「ファンクラブ」で、会費やイベントを決められます。',
  });
  return state;
}

function migrateV3toV4(state: GameState): GameState {
  state.owner = initialOwner(state);
  addMessage(state, {
    category: 'club', from: 'オーナー', important: false,
    subject: 'フェーズ3-Bの機能（オーナーの評価）が使えるようになりました',
    body: `今シーズンの目標は「${goalLabel(state.owner.goals.position)}」です。オーナーの信頼度は、成績とお金の状況で上下し、下がりすぎると解任されます。\n`
      + 'クラブの画面で、目標と信頼度を見られます。',
  });
  return state;
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
