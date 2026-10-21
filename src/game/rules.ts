// リーグのルール。要件定義書「リーグと日程」の「ルール」の表に対応する。数値はここを変えれば変えられる。

export const LEAGUE_RULES = {
  rounds: 34,
  points: { win: 3, draw: 1, loss: 0 },
  /** 登録できる選手の最大数 */
  squadMax: 30,
  /** 試合に出るメンバー：先発11人と控え */
  benchSize: 9,
  /** 試合のメンバー（先発＋控え）に入れられる外国籍選手の数 */
  foreignLimit: 5,
  /** 警告がこの枚数たまると1試合の出場停止 */
  yellowLimit: 4,
  /** 2枚目のイエローで退場したときの出場停止試合数 */
  secondYellowBan: 1,
  /** 一発レッドで退場したときの出場停止試合数 */
  straightRedBan: 2,
} as const;

export const HOME_NATIONALITY = '日本';
