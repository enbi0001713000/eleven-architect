// 遊ぶ人ごとの設定（ブラウザに保存）。使えない環境でも動くように、読み書きの失敗は無視する。

export type MatchSpeed = 1 | 2 | 4;
export type CommentaryMode = 'key' | 'all';
export type Theme = 'light' | 'dark';

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
}

// 今までの設定を読めるように、リポジトリの名前を変えても変えない
const KEY = 'soccer-manager:settings';
const DEFAULTS: Settings = {
  matchSpeed: 2, commentary: 'key', squadColumns: null, conversations: true, theme: 'light', tutorials: true, tutorialSeen: [], showPitch: true,
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
