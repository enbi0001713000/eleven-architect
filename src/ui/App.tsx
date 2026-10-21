// 今の画面を切り替える

import { Layout } from './components/Layout';
import { ClubDetail } from './screens/ClubDetail';
import { Finance } from './screens/Finance';
import { Fixtures } from './screens/Fixtures';
import { Home } from './screens/Home';
import { Inbox } from './screens/Inbox';
import { Later } from './screens/Later';
import { League } from './screens/League';
import { MatchDay } from './screens/MatchDay';
import { Meeting } from './screens/Meeting';
import { NewGame } from './screens/NewGame';
import { PlayerDetail } from './screens/PlayerDetail';
import { Press } from './screens/Press';
import { SeasonEnd } from './screens/SeasonEnd';
import { Settings } from './screens/Settings';
import { Squad } from './screens/Squad';
import { Tactics } from './screens/Tactics';
import { Talk } from './screens/Talk';
import { Title } from './screens/Title';
import { Training } from './screens/Training';
import { useStore } from './store';

export function App() {
  const s = useStore();
  const screen = s.screen;

  if (screen.name === 'title') return <Title />;
  if (screen.name === 'newGame') return <NewGame />;
  if (screen.name === 'settings') return <Settings />;
  if (!s.game) return <Title />;

  let content;
  switch (screen.name) {
    case 'home': content = <Home />; break;
    case 'squad': content = <Squad />; break;
    case 'player': content = <PlayerDetail key={screen.id} id={screen.id} />; break;
    case 'tactics': content = <Tactics />; break;
    case 'fixtures': content = <Fixtures initialRound={screen.round} />; break;
    case 'league': content = <League />; break;
    case 'club': content = <ClubDetail key={screen.id} id={screen.id} />; break;
    case 'match': content = <MatchDay />; break;
    case 'seasonEnd': content = <SeasonEnd />; break;
    // 新しい知らせが届いたら選び直す（受信箱を開いたまま進めたとき）
    case 'inbox': content = <Inbox key={screen.messageId ?? s.game.inbox[0]?.id ?? 'inbox'} initialId={screen.messageId} />; break;
    case 'training': content = <Training />; break;
    case 'talk': content = <Talk key={`${screen.playerId}-${screen.requestId ?? ''}`} playerId={screen.playerId} requestId={screen.requestId} />; break;
    case 'meeting': content = <Meeting />; break;
    case 'press': content = <Press key={screen.fixtureId} fixtureId={screen.fixtureId} />; break;
    case 'finance': content = <Finance />; break;
    case 'later': content = <Later key={screen.title} title={screen.title} phase={screen.phase} />; break;
  }
  return <Layout>{content}</Layout>;
}
