// 遊ぶ人ごとの設定（ブラウザに保存）。使えない環境でも動くように、読み書きの失敗は無視する。

export type MatchSpeed = 1 | 2 | 4 | 8;
export type CommentaryMode = 'key' | 'all';
export type Theme = 'light' | 'dark';
/** 文字の大きさ（標準・大きめ） */
export type UiScale = 'normal' | 'large';
/** 観戦の見せ方（ゲームの画面の中で大きく見るか、今までの並びで見るか） */
export type MatchView = 'big' | 'normal';
/** 観戦のピッチの描き方（ドット絵か、上から見た今の図か） */
export type PitchStyle = 'dot' | 'classic';
/** ドット絵のピッチの映し方（全体か、ボールを追って寄るか） */
export type CameraMode = 'whole' | 'follow';

export interface Settings {
  matchSpeed: MatchSpeed;
  commentary: CommentaryMode;
  /** 選手一覧で自分で選んだ列 */
  squadColumns: string[] | null;
  /** 大事な出来事（オーナーの予算、スポンサーの提案、選手の申し出など）を会話画面で開く */
  conversations: boolean;
  /** 配色（初めて遊ぶときは明るい配色） */
  theme: Theme;
  /** チュートリアルを出す */
  tutorials: boolean;
  /** 見たチュートリアル（新しいゲームでも出さない） */
  tutorialSeen: string[];
  /** 観戦中にピッチの2D表示を出す */
  showPitch: boolean;
  /** ゴールや勝利、優勝、選手の加入を大きく見せる（演出） */
  celebrations: boolean;
  /** 文字の大きさと余白 */
  uiScale: UiScale;
  /** アシスタントコーチが画面を開いたときに一言話す */
  coach: boolean;
  /** コーチの一言を小さくたたんでいる */
  coachCollapsed: boolean;
  /** コーチがもう話したこと（同じことは繰り返さない） */
  coachSeen: string[];
  /** 選手の一覧の見せ方（要点のカードか、表か） */
  squadView: 'cards' | 'table';
  /** 観戦の見せ方。前回選んだほうから始める（1.2） */
  matchView: MatchView;
  /** 観戦のピッチの描き方（1.2） */
  pitchStyle: PitchStyle;
  /** ドット絵のピッチの映し方（1.2） */
  camera: CameraMode;
  /** 観戦の音を出す（1.2） */
  sound: boolean;
  /** 観戦の音量（0〜1） */
  volume: number;
}

// 今までの設定を読めるように、リポジトリの名前を変えても変えない
const KEY = 'soccer-manager:settings';
const DEFAULTS: Settings = {
  matchSpeed: 2, commentary: 'key', squadColumns: null, conversations: true, theme: 'light', tutorials: true, tutorialSeen: [], showPitch: true, celebrations: true,
  uiScale: 'normal', coach: true, coachCollapsed: false, coachSeen: [], squadView: 'cards',
  matchView: 'big', pitchStyle: 'dot', camera: 'whole', sound: true, volume: 0.6,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // 保存できなくても遊べる
  }
}

/** 配色を画面に反映する（styles.css の :root[data-theme] が切り替わる） */
export function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
}

/** 文字の大きさを画面に反映する（styles.css の :root[data-scale]） */
export function applyScale(scale: UiScale): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.scale = scale;
}
