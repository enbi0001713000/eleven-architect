// 会話画面：オーナー、営業担当、経理担当とのやり取り。
// 受信箱の知らせ（予算、お金が足りない、スポンサーの提案）と、財務の画面からの相談（予算の増額、借り入れ）を会話で見せる。

import { useEffect, useState } from 'react';
import { budgetIncreaseRoom, chooseSponsorOffer, payrollOf, requestBudgetIncrease, yenText } from '../../game/finance';
import { SPONSOR_DEALS, SPONSOR_SLOT_ORDER, SPONSOR_SLOTS } from '../../game/financeBalance';
import { markRead } from '../../game/inbox';
import type { Club, GameState, InboxMessage, SponsorOffer } from '../../game/types';
import { Conversation, type ConversationChoice, type ConversationLine, type Speaker } from '../components/Conversation';
import { store, useGame, type Screen } from '../store';

export type ConversationTopic = Extract<Screen, { name: 'conversation' }>;

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

  if (!club) return null;
  const topic = message?.topic ?? screen.topic;
  let body;
  if (topic === 'sponsorOffer' || topic === 'sponsor') body = <SponsorTalk game={game} club={club} message={message} />;
  else if (topic === 'budget' || topic === 'budgetIncrease') body = <OwnerBudgetTalk game={game} club={club} message={message} />;
  else if (topic === 'loan') body = <LoanTalk game={game} club={club} screen={screen} />;
  else if (message) body = <MessageTalk game={game} club={club} message={message} />;
  else body = <p className="muted">話す相手がいません。</p>;

  return (
    <div className="page conversation-page">
      <header className="page-header">
        <button type="button" className="secondary" onClick={() => store.back()}>← 戻る</button>
        <h1>{message?.subject ?? (topic === 'loan' ? '借り入れの相談' : topic === 'sponsor' ? 'スポンサーの相談' : '予算の相談')}</h1>
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

/** ふつうの知らせ（お金が足りない、など）：相手が話して、返事をして終わる */
function MessageTalk({ game, club, message }: { game: GameState; club: Club; message: InboxMessage }) {
  const [lines, setLines] = useState<ConversationLine[]>(messageLines(message));
  const [ended, setEnded] = useState(false);
  const shortfall = message.topic === 'shortfall';
  const choices: ConversationChoice[] = shortfall
    ? [{ id: 'ok', label: '「わかった。立て直しを考える」' }, { id: 'loans', label: '借り入れの状況を見る（財務の画面へ）' }]
    : [{ id: 'ok', label: '「わかった」' }];
  const choose = (id: string) => {
    if (id === 'loans') {
      store.navigate({ name: 'finance' });
      return;
    }
    setLines([...lines, me(shortfall ? 'わかった。立て直しを考える。' : 'わかった。'), them(shortfall ? 'お願いします。' : 'よろしくお願いします。')]);
    setEnded(true);
  };
  return (
    <Conversation speaker={speakerFor(message.from, club)} me={game.manager.name} lines={lines}
      choices={ended ? undefined : choices} onChoose={choose} footer={ended ? <BackButtons finance={shortfall} /> : undefined} />
  );
}

type BudgetStage = 'menu' | 'amount' | 'target' | 'done';

/** オーナーとの予算の話：予算の知らせを聞き、必要なら手元のお金から増やしてもらう */
function OwnerBudgetTalk({ game, club, message }: { game: GameState; club: Club; message?: InboxMessage }) {
  const room = budgetIncreaseRoom(game, club);
  const askAmount = (base: ConversationLine[]): ConversationLine[] => [
    ...base,
    room > 0
      ? them(`手元のお金から、今年はあと${yenText(room)}まで予算に足せます。いくら必要ですか。`)
      : them('今は手元のお金に余裕がありません。支払いのために残しておきたいのです。'),
  ];
  // 財務の画面から来たときは、最初から増額の話をする
  const [lines, setLines] = useState<ConversationLine[]>(() => (message
    ? messageLines(message)
    : askAmount([me('予算のことで、ご相談があります。'), them('どうしましたか。'), me('予算を、もう少し増やしていただけませんか。')])));
  const [stage, setStage] = useState<BudgetStage>(message ? 'menu' : 'amount');
  const [amount, setAmount] = useState(0);

  const amounts = [...new Set([room / 4, room / 2, room].map((v) => Math.floor(v / 1e7) * 1e7))].filter((v) => v > 0);
  let choices: ConversationChoice[] | undefined;
  if (stage === 'menu') {
    choices = [
      { id: 'ok', label: '「わかりました。この予算でやってみます」' },
      { id: 'more', label: '「予算を、もう少し増やしていただけませんか」', description: room > 0 ? `手元のお金から、あと${yenText(room)}まで` : '手元のお金に余裕がない' },
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
        setLines([...base, me('わかりました。この予算でやってみます。'), them('期待しています。よろしく頼みます。')]);
        setStage('done');
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
