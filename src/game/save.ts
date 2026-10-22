// セーブデータの形と、ファイルへの書き出し・読み込み。要件定義書「非機能要件」の「セーブの互換性」に対応する。
// セーブデータには版番号を持たせ、古い形のデータは新しい形に直してから読み込む。

import { overallRating } from '../engine/ratings';
import { createRng } from '../engine/rng';
import { newManager } from './career';
import { CAREER } from './careerBalance';
import { CONTRACT } from './contractBalance';
import { clauseFor, contractDeadline, createAgents } from './contracts';
import { addDays, monthDay, yearOf } from './dates';
import { assignSquadRoles, defaultClubTraining, defaultFamiliarity, playerPhase2Fields } from './defaults';
import { potentialFor } from './development';
import { initFinances } from './finance';
import { createFanClub, totalMembers } from './fanClub';
import { addMessage } from './inbox';
import { goalLabel, initialOwner } from './owner';
import type { Difficulty, GameState, OwnerStrictness } from './types';
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
    if (v === 5) current = migrateV5toV6(current);
    if (v === 6) current = migrateV6toV7(current);
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
/**
 * 版5（フェーズ3.5）→ 版6（フェーズ3-C）：監督の経歴・評判・キャリアと、AIクラブの監督の評判を足す。
 * 経歴は「指導者の経験あり」、難易度はオーナーの厳しさから決める。解任されていたセーブは、無職から続けられる
 */
function migrateV5toV6(state: GameState): GameState {
  const old = state.manager as unknown as { name: string; clubId: string };
  const club = state.clubs[old.clubId];
  const start = state.history[0] ? `${state.history[0].year}-02-20` : state.date;
  const manager = newManager(old.name, club ?? Object.values(state.clubs)[0]!, 'coach', DIFFICULTY_OF[state.owner.strictness], start);
  const stint = manager.career[0]!;
  for (const e of state.owner.evaluations) stint.seasons.push({ year: e.year, position: e.position, goal: e.goal, verdict: e.verdict });
  // これまでの評価で、評判を決めておく
  manager.reputation = Math.max(1, Math.min(100, manager.reputation + state.owner.evaluations.reduce((n, e) => n + CAREER.verdictReputation[e.verdict], 0)));
  manager.reputationHistory = [{ date: state.date, value: manager.reputation }];
  state.manager = manager;
  const rng = createRng(state.seed ^ 0x3c3c);
  for (const c of Object.values(state.clubs)) {
    c.managerReputation ??= Math.max(20, Math.min(90, c.reputation + rng.int(-12, 6)));
    c.managerSince ??= c.id === manager.clubId ? start : addDays(state.date, -rng.int(100, 1200));
    c.vacancy ??= null;
  }
  addMessage(state, {
    category: 'club', from: 'あなたの代理人', important: false,
    subject: '監督のキャリアの機能が使えるようになりました',
    body: `監督の評判は${Math.round(manager.reputation)}です。評判が上がると、評判の高いクラブからオファーが届きます。`
      + '\n解任されても、ほかのクラブのオファーで監督を続けられます。監督の画面で、評判と経歴を見られます。',
  });
  return state;
}

/**
 * 版6（フェーズ3-C）→ 版7（フェーズ4-A）：代理人、違約金と出来高ボーナス、所属なしの選手、契約の交渉を足す。
 * 12月1日を過ぎたセーブは、締め切りをすぐに済ませる（前の版は12月20日に自動で更新していたため）
 */
function migrateV6toV7(state: GameState): GameState {
  state.agents ??= createAgents(createRng(state.seed ^ 0xa6e7));
  state.freeAgents ??= [];
  state.contractTalks ??= {};
  state.contractDelegation ??= {};
  for (const player of Object.values(state.players)) {
    player.joining ??= null;
    if (!player.contract) continue;
    player.contract.releaseClause ??= clauseFor(player, state.season.year, CONTRACT.defaultClause);
    player.contract.bonus ??= null;
  }
  const md = monthDay(state.date);
  const expired = Object.values(state.players).some((p) => p.clubId && p.contract && p.contract.endYear <= yearOf(state.date) && !p.leaving && !p.retiring);
  if (md >= CONTRACT.deadline && yearOf(state.date) === state.season.year && expired) contractDeadline(state, createRng(state.seed ^ 0x7c7c));
  addMessage(state, {
    category: 'transfer', from: '強化部', important: false,
    subject: '契約の交渉の機能が使えるようになりました',
    body: '今年で契約が切れる選手とは、7月1日から11月30日まで、更新の交渉ができます。主力とローテーションの選手は自分で交渉し、控えと若手は強化部に任せられます。'
      + '\n12月からは、他クラブの契約満了の選手とも話ができます。移籍の画面を見てください。',
  });
  return state;
}

const DIFFICULTY_OF: Record<OwnerStrictness, Difficulty> = { lenient: 'easy', normal: 'normal', strict: 'hard' };

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
