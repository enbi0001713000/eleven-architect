// 小さな絵記号（メニューとパネルの見出しに使う）。線で描き、色は文字の色に合わせる。

const PATHS: Record<IconName, string> = {
  home: 'M3 11 L12 4 L21 11 M5 9.5 V20 H10 V14 H14 V20 H19 V9.5',
  inbox: 'M3 6 H21 V18 H3 Z M3 6 L12 13 L21 6',
  squad: 'M9 11 A3.2 3.2 0 1 0 9 4.6 A3.2 3.2 0 1 0 9 11 M3 20 C3 15.5 6 13.5 9 13.5 C12 13.5 15 15.5 15 20 M16 4.8 A3 3 0 0 1 16 10.8 M17.5 13.8 C19.5 14.5 21 16.5 21 20',
  tactics: 'M3 4 H21 V20 H3 Z M12 4 V20 M12 9.5 A2.5 2.5 0 1 0 12 14.5 A2.5 2.5 0 1 0 12 9.5 M6 8 L8 10 M8 8 L6 10 M16 14 L18 16 M18 14 L16 16',
  training: 'M4 9 V15 M7 7 V17 M17 7 V17 M20 9 V15 M7 12 H17',
  fixtures: 'M4 6 H20 V20 H4 Z M4 10 H20 M8 3.5 V7.5 M16 3.5 V7.5 M8 14 H10 M12 14 H14 M8 17 H10',
  league: 'M7 4 H17 V9 C17 12 15 14 12 14 C9 14 7 12 7 9 Z M7 6 H4 C4 9 5.5 10 7.5 10.5 M17 6 H20 C20 9 18.5 10 16.5 10.5 M12 14 V17 M8 20 H16 L15 17 H9 Z',
  transfers: 'M4 8 H18 M14 4 L18 8 L14 12 M20 16 H6 M10 12 L6 16 L10 20',
  scouting: 'M10.5 17 A6.5 6.5 0 1 0 10.5 4 A6.5 6.5 0 1 0 10.5 17 M15.5 15.5 L21 21',
  finance: 'M12 21 A9 9 0 1 0 12 3 A9 9 0 1 0 12 21 M15 8.5 C14.5 7.5 13.4 7 12 7 C10.2 7 9 8 9 9.4 C9 12.6 15 11.2 15 14.5 C15 16 13.7 17 12 17 C10.4 17 9.3 16.3 9 15.2 M12 5 V7 M12 17 V19',
  club: 'M12 3 L20 6 V12 C20 16.5 16.5 19.5 12 21 C7.5 19.5 4 16.5 4 12 V6 Z M12 8 L13.3 10.8 L16.3 11 L14 13 L14.7 16 L12 14.4 L9.3 16 L10 13 L7.7 11 L10.7 10.8 Z',
  manager: 'M12 11 A3.5 3.5 0 1 0 12 4 A3.5 3.5 0 1 0 12 11 M5 21 C5 16.5 8 14 12 14 C16 14 19 16.5 19 21 M12 14 L11 17 L12 18.5 L13 17 Z',
  match: 'M12 21 A9 9 0 1 0 12 3 A9 9 0 1 0 12 21 M12 7.5 L15.5 10 L14.2 14.2 H9.8 L8.5 10 Z M12 7.5 V3.2 M15.5 10 L20.3 8.6 M14.2 14.2 L17 18.3 M9.8 14.2 L7 18.3 M8.5 10 L3.7 8.6',
  heart: 'M12 20 C6 15.5 3 12.5 3 8.8 C3 6.2 5 4.5 7.3 4.5 C9.2 4.5 10.9 5.6 12 7.2 C13.1 5.6 14.8 4.5 16.7 4.5 C19 4.5 21 6.2 21 8.8 C21 12.5 18 15.5 12 20 Z',
  owner: 'M4 20 H20 M6 20 V10 M10 20 V10 M14 20 V10 M18 20 V10 M3 10 H21 L12 4 Z',
  chart: 'M4 4 V20 H20 M7 15 L11 11 L14 13.5 L19 8',
};

export type IconName =
  | 'home' | 'inbox' | 'squad' | 'tactics' | 'training' | 'fixtures' | 'league' | 'transfers' | 'scouting'
  | 'finance' | 'club' | 'manager' | 'match' | 'heart' | 'owner' | 'chart';

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
