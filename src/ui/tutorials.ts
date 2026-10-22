// チュートリアルの中身（要件定義書 フェーズ3.5「チュートリアル」）。
// 案内役のアシスタントコーチが、1手順ずつ説明する。target は光らせる部品（CSSセレクタ。見つからなければ光らせない）。
// 新しい機能を作るときは、ここにその機能の説明も足す。

export type TutorialId =
  | 'conversation' | 'start' | 'inbox' | 'squad' | 'tactics' | 'training' | 'fixtures' | 'league' | 'finance' | 'myClub' | 'fanClub'
  | 'match' | 'talk' | 'press' | 'monthClose' | 'sponsorOffer' | 'fanClubWindow' | 'ownerWarning' | 'thanksDay';

export interface TutorialStep {
  text: string;
  target?: string;
}

export interface Tutorial {
  title: string;
  steps: TutorialStep[];
}

const t = (name: string): string => `[data-tutorial="${name}"]`;

export const TUTORIALS: Record<TutorialId, Tutorial> = {
  conversation: {
    title: '会話の画面',
    steps: [
      { text: '監督、アシスタントコーチです。大事な出来事は、このように会話で伝えられます。', target: '.conv-log' },
      { text: '文字が流れている間にクリックすると、すぐに全部出ます。もう一度クリックすると、次の話に進みます。', target: '.conv-log' },
      { text: '話が終わると、下に返事が出ます。選んだ返事で、相手の反応や結果が変わります。' },
      { text: '会話を閉じても、受信箱からもう一度開けます。設定で、会話を自動で開かないようにもできます。' },
    ],
  },
  start: {
    title: 'ゲームの進め方',
    steps: [
      { text: 'ようこそ、監督！画面の見方を、ひととおり案内します。「この説明を閉じる」で、いつでも終われます。' },
      { text: 'ホームには、次の試合、順位、最近の結果、新しい知らせがまとまっています。', target: t('home-next-match') },
      { text: '左のメニューから、選手、戦術、練習、財務などの画面に移れます。', target: t('menu') },
      { text: '受信箱には、オーナーやスタッフ、選手からの知らせが届きます。数字は、まだ読んでいない大事な知らせの数です。', target: t('menu-inbox') },
      { text: '試合の前に、戦術の画面でフォーメーションとスタメンを決めます。最初は「自動で選ぶ」でも大丈夫です。', target: t('menu-tactics') },
      { text: 'オーナーは、シーズンの目標を見ています。成績が悪いと信頼度が下がり、下がりすぎると解任されます。', target: t('home-owner') },
      { text: '準備ができたら「次の出来事まで進める」を押します。試合の日や、大事な知らせが届いた日で止まります。', target: t('advance') },
      { text: 'それぞれの画面を初めて開いたときにも、短く説明します。右上の「？」で、いつでももう一度見られます。それでは、がんばりましょう！', target: t('help') },
    ],
  },
  inbox: {
    title: '受信箱',
    steps: [
      { text: '知らせは新しい順に並びます。太字は、まだ読んでいない知らせです。', target: t('inbox-list') },
      { text: '返事が必要な知らせには、ボタンが出ます。会話で話す知らせは、ここから会話を開けます。', target: t('inbox-body') },
    ],
  },
  squad: {
    title: '選手',
    steps: [
      { text: 'クラブにいる選手の一覧です。見出しを押すと並べ替えられます。', target: `${t('squad-table')} thead` },
      { text: '表示を切り替えると、能力、コンディション、契約などが見られます。「列を選ぶ」で、自分で列も決められます。', target: t('squad-views') },
      { text: '選手の名前を押すと、詳しい能力や記録、面談の画面に進めます。' },
    ],
  },
  tactics: {
    title: '戦術',
    steps: [
      { text: 'まずフォーメーションを選びます。慣れていない形は熟成度が低く、少し力を出しにくくなります。', target: t('formation') },
      { text: 'ピッチの枠を押すと、その位置に入れる選手と役割を選べます。下の数字は、その位置での力とコンディションです。', target: t('pitch') },
      { text: '役割は、その位置での動き方です。◎は向いている、○はふつう、△は向いていないという目安です。', target: t('roles') },
      { text: '「役割を選手に合わせる」を押すと、全員を一番向いている役割にできます。', target: t('fit-roles') },
      { text: 'チーム指示で、攻撃と守備のバランス、守備ラインの高さ、プレスの強さなどを決めます。', target: t('instructions') },
    ],
  },
  training: {
    title: '練習',
    steps: [
      { text: '練習の方針と強度を決めます。強い練習ほど伸びますが、疲れとケガが増えます。', target: t('training-plan') },
      { text: '試合の前日と翌日は、自動で軽めの練習になります。疲れている選手は、休ませることも大事です。' },
    ],
  },
  fixtures: {
    title: '日程と結果',
    steps: [
      { text: 'リーグ全体の日程と結果です。節を切り替えて、ほかの試合の結果も見られます。', target: t('fixtures') },
    ],
  },
  league: {
    title: 'リーグ',
    steps: [
      { text: '順位表と、得点などの記録です。クラブ名を押すと、そのクラブの詳しい情報が見られます。', target: t('league') },
    ],
  },
  finance: {
    title: '財務',
    steps: [
      { text: '手元のお金と、今年の差し引き（黒字か赤字か）、年俸と予算が一目でわかります。', target: t('finance-tiles') },
      { text: '予算、スポンサー、チケット、借り入れは、タブで切り替えます。', target: t('finance-tabs') },
      { text: 'お金は毎月1日に締めます。年俸の合計が予算を超えないように気をつけましょう。' },
    ],
  },
  myClub: {
    title: 'クラブ',
    steps: [
      { text: 'オーナーの信頼度です。成績とお金の様子で、毎月上下します。', target: t('owner-trust') },
      { text: '今シーズンの目標です。開幕までに1回だけ、オーナーと話し合えます。', target: t('owner-goals') },
      { text: '「ファンクラブ」のタブでは、会員と会費、イベントを決められます。', target: t('club-tabs') },
    ],
  },
  fanClub: {
    title: 'ファンクラブ',
    steps: [
      { text: '会員には、レギュラー、ゴールド、プラチナの3つのランクがあります。年会費は自分で決められます。', target: t('fan-ranks') },
      { text: '会費を上げると1人あたりの収入は増えますが、会員が減ります。会員が多いほど、観客とグッズも増えます。' },
      { text: 'イベントを開くと、会員やファンが増えます。ただし費用がかかり、出た選手は少し疲れます。', target: t('fan-events') },
    ],
  },
  match: {
    title: '試合の日',
    steps: [
      { text: '試合の日です。メンバーと相手を確かめてから、試合を始めます。' },
      { text: '試合中は、いつでも一時停止して、交代や戦術の変更ができます。' },
      { text: '実況の速さは変えられます。結果まで一気に飛ばすこともできます。' },
    ],
  },
  talk: {
    title: '面談',
    steps: [
      { text: '選手との面談です。選手の話を聞いて、返事を選びます。返事しだいで、選手のやる気が上がったり下がったりします。' },
    ],
  },
  press: {
    title: '記者会見',
    steps: [
      { text: '記者会見です。答え方で、選手やファンの雰囲気が変わります。' },
    ],
  },
  monthClose: {
    title: '月の締め',
    steps: [
      { text: '月が変わり、前の月のお金が締められました。財務の画面で、収入と支出を確かめられます。', target: t('menu-finance') },
    ],
  },
  sponsorOffer: {
    title: 'スポンサーの提案',
    steps: [
      { text: 'スポンサーの契約が切れる枠に、提案が届きました。年額が高い契約、長い契約、成績で上乗せがある契約から選べます。' },
      { text: '選ばなかった枠は、標準の契約になります。' },
    ],
  },
  fanClubWindow: {
    title: 'ファンクラブの受付',
    steps: [
      { text: '来年のファンクラブの入会と更新の受付が始まりました。会費は12月から2月に分けて入ります。クラブの画面で様子を見られます。', target: t('menu-myClub') },
    ],
  },
  ownerWarning: {
    title: 'オーナーの警告',
    steps: [
      { text: 'オーナーから警告されました。信頼度がもっと下がると、解任されてしまいます。' },
      { text: '目標に近づけるよう、戦術やメンバー、練習を見直しましょう。クラブの画面で、信頼度の推移を見られます。' },
    ],
  },
  thanksDay: {
    title: 'ファン感謝デー',
    steps: [
      { text: 'ファン感謝デーの提案です。開くと費用がかかりますが、来年の会員が増え、ファンの雰囲気も上がります。' },
    ],
  },
};
