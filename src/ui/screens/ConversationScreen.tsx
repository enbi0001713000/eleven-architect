// 会話画面：オーナー、営業担当、経理担当、ファンクラブ担当とのやり取り。
// 受信箱の知らせ（目標と予算、オーナーの警告、解任、お金が足りない、スポンサーの提案、ファン感謝デーの提案）と、
// 財務やクラブの画面からの相談（予算の増額、借り入れ、目標の話し合い、ファンクラブのイベント）を会話で見せる。

import { useEffect, useState } from 'react';
import { acceptOffer, declineOffer } from '../../game/career';
import { budgetIncreaseRoom, chooseSponsorOffer, payrollOf, requestBudgetIncrease, yenText } from '../../game/finance';
import { canHoldEvent, decideThanksDay, eventCandidates, eventPreview, holdEvent, popularity, type HeldEventKind } from '../../game/fanClub';
import { EVENT_LABEL, FAN_EVENTS, THANKS_DAY } from '../../game/fanClubBalance';
import { SPONSOR_DEALS, SPONSOR_SLOT_ORDER, SPONSOR_SLOTS } from '../../game/financeBalance';
import { markRead } from '../../game/inbox';
import { canNegotiate, goalLabel, negotiateGoal } from '../../game/owner';
import { FINANCE_GOAL_LABEL, OWNER } from '../../game/ownerBalance';
import type { Club, GameState, InboxMessage, PlayerRecord, SponsorOffer, ThanksDayScale } from '../../game/types';
import { Conversation, type ConversationChoice, type ConversationLine, type Speaker } from '../components/Conversation';
import { store, useGame, type Screen } from '../store';
import type { TutorialId } from '../tutorials';
import { useTutorial } from '../useTutorial';

export type ConversationTopic = Extract<Screen, { name: 'conversation' }>;

/** 初めてその話をするときの説明 */
const TOPIC_TUTORIAL: Partial<Record<string, TutorialId>> = {
  sponsorOffer: 'sponsorOffer', sponsor: 'sponsorOffer', ownerWarning: 'ownerWarning', fanThanksDay: 'thanksDay', jobOffer: 'jobOffer',
};

const them = (text: string): ConversationLine => ({ who: 'them', text });
const me = (text: string): ConversationLine => ({ who: 'me', text });
const note = (text: string): ConversationLine => ({ who: 'note', text });

function speakerFor(from: string, club: Club): Speaker {
  if (from === 'オーナー') return { name: 'オーナー', role: `${club.name}のオーナー`, kind: 'owner' };
  return { name: from, role: `${club.name}の${from}`, kind: 'staff' };
}

export function ConversationScreen({ screen }: { screen: ConversationTopic }) {
  const game = useGame();
  const club = game.clubs[game.manager.clubId];
  const message = screen.messageId ? game.inbox.find((m) => m.id === screen.messageId) : undefined;

  useEffect(() => {
    if (message && !message.read) store.update((g) => markRead(g, message.id));
  }, [message]);
  const topic = message?.topic ?? screen.topic;
  useTutorial('conversation', topic ? TOPIC_TUTORIAL[topic] : undefined);

  if (!club) {
    // 無職の間に開く話（オファー、解任の話）
    return (
      <div className="page conversation-page">
        <header className="page-header">
          <button type="button" className="secondary" onClick={() => store.back()}>← 戻る</button>
          <h1>{message?.subject ?? '話'}</h1>
        </header>
        {message?.topic === 'jobOffer' ? <JobOfferTalk game={game} message={message} />
          : message ? <MessageTalk game={game} club={formerClub(game)} message={message} /> : <p className="muted">話す相手がいません。</p>}
      </div>
    );
  }
  let body;
  if (topic === 'sponsorOffer' || topic === 'sponsor') body = <SponsorTalk game={game} club={club} message={message} />;
  else if (topic === 'budget' || topic === 'budgetIncrease' || topic === 'goals') body = <OwnerBudgetTalk game={game} club={club} message={message} goals={topic === 'goals'} />;
  else if (topic === 'loan') body = <LoanTalk game={game} club={club} screen={screen} />;
  else if (topic === 'fanThanksDay' && message) body = <ThanksDayTalk game={game} club={club} message={message} />;
  else if (topic === 'jobOffer' && message) body = <JobOfferTalk game={game} message={message} />;
  else if (topic === 'fanEvent' && screen.eventKind) body = <FanEventTalk game={game} club={club} kind={screen.eventKind} />;
  else if (message) body = <MessageTalk game={game} club={club} message={message} />;
  else body = <p className="muted">話す相手がいません。</p>;

  return (
    <div className="page conversation-page">
      <header className="page-header">
        <button type="button" className="secondary" onClick={() => store.back()}>← 戻る</button>
        <h1>{message?.subject ?? (topic === 'loan' ? '借り入れの相談' : topic === 'sponsor' ? 'スポンサーの相談' : topic === 'goals' ? '目標の相談'
          : topic === 'fanEvent' && screen.eventKind ? `${EVENT_LABEL[screen.eventKind]}の相談` : '予算の相談')}</h1>
      </header>
      {body}
    </div>
  );
}

const messageLines = (message: InboxMessage): ConversationLine[] =>
  (message.lines ?? message.body.split('\n')).filter((l) => l.trim() !== '').map(them);

const BackButtons = ({ finance }: { finance?: boolean }) => (
  <div className="button-row">
    {finance && <button type="button" className="secondary" onClick={() => store.open({ name: 'finance' })}>財務の画面へ</button>}
    <button type="button" className="primary" onClick={() => store.back()}>戻る</button>
  </div>
);

/** 知らせの種類ごとの、返事とその答え */
const REPLIES: Partial<Record<NonNullable<InboxMessage['topic']>, { id: string; label: string; say: string; answer: string }[]>> = {
  shortfall: [
    { id: 'ok', label: '「わかった。立て直しを考える」', say: 'わかった。立て直しを考える。', answer: 'お願いします。' },
  ],
  ownerWarning: [
    { id: 'promise', label: '「必ず立て直します」', say: '必ず立て直します。', answer: '結果で示してください。期待していますよ。' },
    { id: 'ok', label: '「わかりました」', say: 'わかりました。', answer: '……頼みますよ。' },
  ],
};

/** ふつうの知らせ（お金が足りない、オーナーの警告、解任など）：相手が話して、返事をして終わる */
function MessageTalk({ game, club, message }: { game: GameState; club: Club; message: InboxMessage }) {
  const [lines, setLines] = useState<ConversationLine[]>(messageLines(message));
  const [ended, setEnded] = useState(false);
  const shortfall = message.topic === 'shortfall';
  if (message.topic === 'dismissal') {
    return (
      <Conversation speaker={speakerFor(message.from, club)} me={game.manager.name} lines={lines}
        footer={<div className="button-row"><button type="button" className="primary" onClick={() => store.open({ name: 'manager' })}>次へ</button></div>} />
    );
  }
  const replies = (message.topic && REPLIES[message.topic]) ?? [{ id: 'ok', label: '「わかった」', say: 'わかった。', answer: 'よろしくお願いします。' }];
  const choices: ConversationChoice[] = [
    ...replies.map((r) => ({ id: r.id, label: r.label })),
    ...(shortfall ? [{ id: 'loans', label: '借り入れの状況を見る（財務の画面へ）' }] : []),
  ];
  const choose = (id: string) => {
    if (id === 'loans') {
      store.navigate({ name: 'finance' });
      return;
    }
    const reply = replies.find((r) => r.id === id);
    if (!reply) return;
    setLines([...lines, me(reply.say), them(reply.answer)]);
    setEnded(true);
  };
  return (
    <Conversation speaker={speakerFor(message.from, club)} me={game.manager.name} lines={lines}
      choices={ended ? undefined : choices} onChoose={choose} footer={ended ? <BackButtons finance={shortfall} /> : undefined} />
  );
}

type BudgetStage = 'menu' | 'amount' | 'target' | 'done';

/** オーナーとの目標と予算の話：知らせを聞き、目標を話し合い、必要なら手元のお金から予算を増やしてもらう */
function OwnerBudgetTalk({ game, club, message, goals }: { game: GameState; club: Club; message?: InboxMessage; goals?: boolean }) {
  const room = budgetIncreaseRoom(game, club);
  const askAmount = (base: ConversationLine[]): ConversationLine[] => [
    ...base,
    room > 0
      ? them(`手元のお金から、今年はあと${yenText(room)}まで予算に足せます。いくら必要ですか。`)
      : them('今は手元のお金に余裕がありません。支払いのために残しておきたいのです。'),
  ];
  const goalLines = (): ConversationLine[] => [
    them(`今シーズンの目標は、${goalLabel(game.owner.goals.position)}です。財務では「${FINANCE_GOAL_LABEL[game.owner.goals.finance]}」をお願いしています。`),
  ];
  // 財務の画面から来たときは、最初から増額の話をする。クラブの画面から来たときは、目標の話から
  const [lines, setLines] = useState<ConversationLine[]>(() => (message
    ? messageLines(message)
    : goals
      ? [me('今シーズンの目標について、ご相談があります。'), them('聞きましょう。'), ...goalLines()]
      : askAmount([me('予算のことで、ご相談があります。'), them('どうしましたか。'), me('予算を、もう少し増やしていただけませんか。')])));
  const [stage, setStage] = useState<BudgetStage>(message || goals ? 'menu' : 'amount');
  const [amount, setAmount] = useState(0);

  const amounts = [...new Set([room / 4, room / 2, room].map((v) => Math.floor(v / 1e7) * 1e7))].filter((v) => v > 0);
  let choices: ConversationChoice[] | undefined;
  if (stage === 'menu') {
    const negotiable = canNegotiate(game);
    const change = yenText(Math.round(club.finance.budget.total * OWNER.negotiationBudgetShare / 1e7) * 1e7);
    choices = [
      { id: 'ok', label: '「わかりました。この目標と予算でやってみます」' },
      ...(negotiable ? [
        { id: 'lower', label: '「目標を、もう少し下げていただけませんか」', description: `目標が1段下がり、予算が${change}減る。オーナーの信頼も少し下がる（開幕までに1回だけ）` },
        { id: 'higher', label: '「目標を上げてもかまいません。そのかわり、予算を増やしてください」', description: `目標が1段上がり、予算が${change}増える（開幕までに1回だけ）` },
      ] : []),
      { id: 'more', label: '「予算を、もう少し増やしていただけませんか」', description: room > 0 ? `手元のお金から、あと${yenText(room)}まで` : '手元のお金に余裕がない、または今の成績では難しい' },
      { id: 'finance', label: '配分を見直す（財務の画面へ）' },
    ];
  } else if (stage === 'amount') {
    choices = room > 0
      ? [...amounts.map((v) => ({ id: `amount-${v}`, label: `「${yenText(v)}お願いします」` })), { id: 'cancel', label: '「やはり、今のままで大丈夫です」' }]
      : [{ id: 'cancel', label: '「わかりました」' }];
  } else if (stage === 'target') {
    choices = [
      { id: 'wages', label: '「年俸予算に足してください」', description: `今の年俸予算 ${yenText(club.finance.budget.wages)}（年俸の合計 ${yenText(payrollOf(game, club.id))}）` },
      { id: 'transfers', label: '「移籍予算に足してください」', description: `今の移籍予算 ${yenText(club.finance.budget.transfers)}` },
    ];
  }

  const choose = (id: string) => {
    const base = lines;
    if (stage === 'menu') {
      if (id === 'finance') {
        store.navigate({ name: 'finance' });
        return;
      }
      if (id === 'ok') {
        setLines([...base, me('わかりました。この目標と予算でやってみます。'), them('期待しています。よろしく頼みます。')]);
        setStage('done');
        return;
      }
      if (id === 'lower' || id === 'higher') {
        let answer = { ok: false, lines: [] as string[] };
        store.update((g) => {
          answer = negotiateGoal(g, id);
        });
        setLines([
          ...base,
          me(id === 'lower' ? '目標を、もう少し下げていただけませんか。' : '目標を上げてもかまいません。そのかわり、予算を増やしてください。'),
          ...answer.lines.map(them),
          ...(answer.ok ? [them('ほかに、何かありますか。')] : []),
        ]);
        return;
      }
      setLines(askAmount([...base, me('予算を、もう少し増やしていただけませんか。')]));
      setStage('amount');
      return;
    }
    if (stage === 'amount') {
      if (id === 'cancel') {
        setLines([...base, me(room > 0 ? 'やはり、今のままで大丈夫です。' : 'わかりました。'), them('わかりました。')]);
        setStage('done');
        return;
      }
      const value = Number(id.slice('amount-'.length));
      setAmount(value);
      setLines([...base, me(`${yenText(value)}、お願いします。`), them('年俸と移籍、どちらの予算に足しますか。')]);
      setStage('target');
      return;
    }
    if (stage === 'target') {
      const target = id === 'wages' ? 'wages' : 'transfers';
      let answer = { approved: false, reason: '' };
      store.update((g) => {
        answer = requestBudgetIncrease(g, club.id, amount, target);
      });
      setLines([
        ...base,
        me(target === 'wages' ? '年俸予算に足してください。' : '移籍予算に足してください。'),
        answer.approved
          ? them(`わかりました。${yenText(amount)}を${target === 'wages' ? '年俸予算' : '移籍予算'}に足しておきます。${target === 'wages' ? '良い選手を引き留めるのにも、連れてくるのにも使ってください。' : '良い選手を連れてきてください。'}`)
          : them(answer.reason),
        ...(answer.approved ? [note('貯めてきたお金の一部が、今年の予算に入った。')] : []),
      ]);
      setStage('done');
    }
  };

  return (
    <Conversation speaker={speakerFor('オーナー', club)} me={game.manager.name} lines={lines}
      choices={stage === 'done' ? undefined : choices} onChoose={choose}
      footer={stage === 'done' ? <BackButtons finance /> : undefined} />
  );
}

/** 借り入れの相談（財務の画面で申請したときの、オーナーの返事） */
function LoanTalk({ game, club, screen }: { game: GameState; club: Club; screen: ConversationTopic }) {
  const amount = screen.amount ?? 0;
  const months = screen.months ?? 0;
  const lines: ConversationLine[] = [
    me(`${yenText(amount)}を、${months}か月で返す約束で借りたいのですが。`),
    ...(screen.approved
      ? [
        them(`わかりました。${yenText(amount)}の借り入れを認めます。`),
        them(`年利は${((screen.rate ?? 0) * 100).toFixed(1)}%で、毎月${yenText(screen.monthly ?? 0)}ずつ返してください。`),
        them('借りすぎには気をつけてくださいよ。'),
        note(`手元のお金に${yenText(amount)}が入った。`),
      ]
      : [them(screen.reason ?? '今回は認められません。'), them('今回は、見送らせてください。')]),
  ];
  return <Conversation speaker={speakerFor('オーナー', club)} me={game.manager.name} lines={lines} footer={<BackButtons finance />} />;
}

/** スポンサーの提案：営業担当が、切れる枠ごとに提案を見せる */
function SponsorTalk({ game, club, message }: { game: GameState; club: Club; message?: InboxMessage }) {
  const fin = club.finance;
  const slots = SPONSOR_SLOT_ORDER.filter((s) => fin.sponsorOffers.some((o) => o.slot === s));
  const slotIntro = (slot: SponsorOffer['slot']): ConversationLine => {
    const deal = fin.sponsors.find((d) => d.slot === slot);
    return them(`${SPONSOR_SLOTS[slot].label}は、今は${deal?.company ?? 'なし'}（年額${yenText(deal?.annual ?? 0)}）です。届いている提案は、こちらです。`);
  };
  const opening = message?.lines ? messageLines(message) : [them('スポンサーの件ですね。')];
  const [lines, setLines] = useState<ConversationLine[]>(() =>
    slots.length > 0 && slots[0] ? [...opening, slotIntro(slots[0])] : [...opening, them('今は、届いている提案はありません。')]);
  const slot = slots[0];
  const offers = slot ? fin.sponsorOffers.filter((o) => o.slot === slot) : [];
  const choices = offers.map((o) => {
    const deal = SPONSOR_DEALS[o.kind];
    return {
      id: o.id,
      label: `${o.company}：${deal.label}`,
      description: `年額${yenText(o.annual)}、${o.years}年${o.bonus > 0 ? `。3位以内の年は${yenText(o.bonus)}の上乗せ` : ''}。${deal.description}`,
    };
  });

  const choose = (id: string) => {
    const offer = offers.find((o) => o.id === id);
    if (!offer) return;
    let signed = false;
    store.update((g) => {
      signed = chooseSponsorOffer(g, offer.id) !== null;
    });
    const rest = slots.slice(1);
    setLines([
      ...lines,
      me(`${offer.company}の提案でお願いします。`),
      signed ? them(`わかりました。${offer.company}と${offer.years}年の契約を結びます。来年の1月からです。`) : them('すみません、その提案はもう締め切られていました。'),
      ...(rest[0] ? [slotIntro(rest[0])] : [them('これで、来年のスポンサーは決まりました。ありがとうございます。')]),
    ]);
  };

  return (
    <Conversation speaker={speakerFor('営業担当', club)} me={game.manager.name} lines={lines}
      choices={choices} onChoose={choose} footer={slots.length === 0 ? <BackButtons finance /> : undefined} />
  );
}

const FAN_STAFF = 'ファンクラブ担当';

/** ファン感謝デーの提案：規模を選ぶ（開かないこともできる） */
function ThanksDayTalk({ game, club, message }: { game: GameState; club: Club; message: InboxMessage }) {
  const plan = club.fanClub.thanksDay;
  const decided = message.resolved === true;
  const [lines, setLines] = useState<ConversationLine[]>(() => [
    ...messageLines(message),
    ...(decided ? [them(plan?.scale ? `今年のファン感謝デーは、${THANKS_DAY[plan.scale].label}ことで準備しています。` : '今年は開かないことになっています。')] : []),
  ]);
  const [ended, setEnded] = useState(decided);
  const choices: ConversationChoice[] = (['small', 'large'] as ThanksDayScale[]).map((scale) => ({
    id: scale,
    label: `「${THANKS_DAY[scale].label}ことにしよう」`,
    description: `費用 ${yenText(THANKS_DAY[scale].cost[club.size])}。来年の更新と入会が増え、ファンの雰囲気が上がる（${scale === 'large' ? '大きく' : '少し'}）`,
  }));
  choices.push({ id: 'none', label: '「今年は見送ろう」', description: '費用はかからないが、更新と入会は増えない' });
  const choose = (id: string) => {
    const scale = id === 'none' ? null : (id as ThanksDayScale);
    store.update((g) => decideThanksDay(g, scale));
    setLines([
      ...lines,
      me(scale ? `${THANKS_DAY[scale].label}ことにしよう。選手にも伝えておく。` : '今年は見送ろう。'),
      them(scale ? 'ありがとうございます！12月の頭に開けるよう、準備を進めます。' : 'わかりました。来年はぜひお願いします。'),
    ]);
    setEnded(true);
  };
  return (
    <Conversation speaker={speakerFor(FAN_STAFF, club)} me={game.manager.name} lines={lines}
      choices={ended ? undefined : choices} onChoose={choose} footer={ended ? <FanBackButtons /> : undefined} />
  );
}

const FanBackButtons = () => (
  <div className="button-row">
    <button type="button" className="secondary" onClick={() => store.open({ name: 'myClub', tab: 'fanClub' })}>ファンクラブの画面へ</button>
    <button type="button" className="primary" onClick={() => store.back()}>戻る</button>
  </div>
);

type FanStage = 'first' | 'second' | 'confirm' | 'done';

const popularityStars = (p: PlayerRecord): string => '★'.repeat(Math.max(1, Math.min(5, Math.round(popularity(p) * 4) + 1)));

/** ファンクラブのイベント：選手を選び（サイン会と地域の活動）、効果を聞いてから開く */
function FanEventTalk({ game, club, kind }: { game: GameState; club: Club; kind: HeldEventKind }) {
  const needsPlayers = kind !== 'openTraining';
  const check = canHoldEvent(game, kind);
  const [picked, setPicked] = useState<string[]>([]);
  const [stage, setStage] = useState<FanStage>(!check.ok ? 'done' : needsPlayers ? 'first' : 'confirm');
  const players = picked.map((id) => game.players[id]).filter((p): p is PlayerRecord => p !== undefined);
  const previewLine = (chosen: PlayerRecord[]): ConversationLine => {
    const p = eventPreview(game, kind, chosen);
    const effect = kind === 'community' ? `ファンが約${p.gain.toLocaleString('ja-JP')}人増えそう` : `約${p.gain.toLocaleString('ja-JP')}人が入会しそう`;
    const tired = kind === 'signing' ? `出た選手のコンディションが${-FAN_EVENTS.signing.condition}下がります。` : kind === 'community' ? `出た選手のコンディションが${-FAN_EVENTS.community.condition}下がります。` : '明日の練習の効果は、2割ほど下がります。';
    return them(`見込みは、${effect}です。費用は${yenText(p.cost)}。${tired}`);
  };
  const intro: ConversationLine[] = !check.ok
    ? [me(`${EVENT_LABEL[kind]}を開きたいんだが。`), them(`すみません、今は開けません。${check.reason ?? ''}`), ...(check.nextDate ? [them(`次に開けるのは${check.nextDate.slice(5).replace('-', '月')}日です。`)] : [])]
    : kind === 'signing'
      ? [me('サイン会かトークショーを開きたい。'), them('いいですね！誰に出てもらいましょう？人気のある選手ほど、たくさんの人が来ます。')]
      : kind === 'community'
        ? [me('地域の学校や病院を訪ねたい。'), them('喜ばれると思います。誰に行ってもらいましょう？')]
        : [me('明日の練習を、会員に公開したい。'), them('会員の方はきっと喜びます。'), previewLine([])];
  const [lines, setLines] = useState<ConversationLine[]>(intro);

  const candidates = eventCandidates(game).filter((p) => !picked.includes(p.id)).slice(0, 6);
  const playerChoices: ConversationChoice[] = candidates.map((p) => ({
    id: p.id,
    label: `${p.name}`,
    description: `人気 ${popularityStars(p)}　コンディション ${Math.round(p.status.condition)}%　今季 ${p.season.appearances}試合 ${p.season.goals}点`,
  }));
  let choices: ConversationChoice[] | undefined;
  if (stage === 'first') choices = playerChoices;
  if (stage === 'second') choices = [{ id: 'enough', label: '「1人で十分だ」' }, ...playerChoices];
  if (stage === 'confirm') choices = [{ id: 'hold', label: '「それで開こう」' }, { id: 'cancel', label: '「やっぱりやめておく」' }];

  const choose = (id: string) => {
    if (stage === 'first' || stage === 'second') {
      if (id === 'enough') {
        setLines([...lines, me('1人で十分だ。'), previewLine(players)]);
        setStage('confirm');
        return;
      }
      const player = game.players[id];
      if (!player) return;
      const next = [...picked, id];
      setPicked(next);
      const chosen = next.map((pid) => game.players[pid]).filter((p): p is PlayerRecord => p !== undefined);
      if (stage === 'first') {
        setLines([...lines, me(`${player.name}に頼もう。`), them(`${player.name}選手ですね。もう1人呼びますか？`)]);
        setStage('second');
      } else {
        setLines([...lines, me(`${player.name}にも来てもらおう。`), previewLine(chosen)]);
        setStage('confirm');
      }
      return;
    }
    if (id === 'cancel') {
      setLines([...lines, me('やっぱりやめておく。'), them('わかりました。またいつでも声をかけてください。')]);
      setStage('done');
      return;
    }
    let held = false;
    store.update((g) => {
      held = holdEvent(g, kind, picked) !== null;
    });
    setLines([
      ...lines,
      me('それで開こう。'),
      held
        ? them(kind === 'openTraining' ? '明日の練習を公開します。準備しておきますね！'
          : kind === 'community' ? '訪問先の皆さん、とても喜んでいました。地元での評判も上がりそうです。結果は受信箱に送っておきます。'
            : '大成功でした！会場はファンでいっぱいでしたよ。結果は受信箱に送っておきます。')
        : them('すみません、今日はもう開けなくなってしまいました。'),
    ]);
    setStage('done');
  };

  return (
    <Conversation speaker={speakerFor(FAN_STAFF, club)} me={game.manager.name} lines={lines}
      choices={choices} onChoose={choose} footer={stage === 'done' ? <FanBackButtons /> : undefined} />
  );
}

/** 無職の間に、前のクラブの話（解任の話など）を見るときのクラブ */
function formerClub(game: GameState): Club {
  const last = game.manager.career.at(-1);
  return (last ? game.clubs[last.clubId] : undefined) ?? Object.values(game.clubs)[0] as Club;
}

/** 監督のオファー：そのクラブのオーナーが話し、受ける・断る・考えさせてほしい を選ぶ（フェーズ3-C） */
function JobOfferTalk({ game, message }: { game: GameState; message: InboxMessage }) {
  const offerId = message.action?.kind === 'jobOffer' ? message.action.offerId : '';
  const offer = game.manager.offers.find((o) => o.id === offerId);
  const club = offer ? game.clubs[offer.clubId] : undefined;
  const speaker: Speaker = { name: message.from, role: message.from, kind: 'owner', color: club?.colors.primary };
  const [lines, setLines] = useState<ConversationLine[]>(() => [
    ...messageLines(message),
    ...(!offer ? [note('このオファーには、もう返事をしたか、期限が過ぎました。')] : []),
  ]);
  const [result, setResult] = useState<'accepted' | 'declined' | 'later' | null>(offer ? null : 'later');
  const choose = (id: string) => {
    if (!offer || !club) return;
    if (id === 'accept') {
      let ok = false;
      store.update((g) => {
        ok = acceptOffer(g, offer.id);
      });
      setLines([
        ...lines,
        me('お引き受けします。よろしくお願いします。'),
        ok ? them(offer.start === 'now' ? 'ありがとうございます！明日から、よろしくお願いします。まずは予算と目標の話をさせてください。' : 'ありがとうございます！来シーズンから、よろしくお願いします。')
          : them('申し訳ありません、この話はもう進められなくなりました。'),
      ]);
      setResult(ok ? 'accepted' : 'later');
      return;
    }
    if (id === 'decline') {
      store.update((g) => declineOffer(g, offer.id));
      setLines([...lines, me('ありがたいお話ですが、今回はお断りします。'), them('そうですか……残念です。またの機会に。')]);
      setResult('declined');
      return;
    }
    setLines([...lines, me('少し考えさせてください。'), them(`わかりました。${offer.expires.slice(5).replace('-', '月')}日までに返事をお願いします。`)]);
    setResult('later');
  };
  const budgetTalk = game.inbox.find((m) => m.topic === 'budget' && m.date === game.date && !m.read);
  return (
    <Conversation speaker={speaker} me={game.manager.name} lines={lines}
      choices={result === null ? [
        { id: 'accept', label: '「お引き受けします」', description: offer?.start === 'now' ? '次の日から、このクラブの監督になる' : '今シーズンが終わったあと（1月1日）に移る' },
        { id: 'decline', label: '「今回はお断りします」' },
        { id: 'later', label: '「少し考えさせてください」', description: '期限までに、監督の画面から返事ができる' },
      ] : undefined}
      onChoose={choose}
      footer={result !== null ? (
        <div className="button-row">
          {result === 'accepted' && offer?.start === 'now' && budgetTalk
            ? <button type="button" className="primary" onClick={() => { store.open({ name: 'home' }); store.navigate({ name: 'conversation', messageId: budgetTalk.id }); }}>オーナーの話を聞く</button>
            : <button type="button" className="primary" onClick={() => store.open({ name: game.manager.clubId === '' ? 'manager' : 'home' })}>戻る</button>}
        </div>
      ) : undefined} />
  );
}
