// 架空のクラブ18個のもと。地名も愛称も架空で、実在のクラブ名と紛らわしくならないようにしている。

export interface ClubSeed {
  id: string;
  place: string;
  name: string;
  /** エンブレムに入れる英字 */
  initials: string;
  colors: { primary: string; secondary: string };
}

export const CLUB_SEEDS: readonly ClubSeed[] = [
  { id: 'hokuto', place: '北都', name: '北都FC', initials: 'HFC', colors: { primary: '#1d3f8f', secondary: '#f2c230' } },
  { id: 'minatogawa', place: '湊川', name: '湊川ユナイテッド', initials: 'MU', colors: { primary: '#c62828', secondary: '#1a1a1a' } },
  { id: 'sakuragaoka', place: '桜ヶ丘', name: '桜ヶ丘SC', initials: 'SSC', colors: { primary: '#d94f87', secondary: '#ffffff' } },
  { id: 'shiramine', place: '白峰', name: '白峰アルバ', initials: 'SA', colors: { primary: '#f4f4f4', secondary: '#2f6db5' } },
  { id: 'shinonome', place: '東雲', name: '東雲シティ', initials: 'SC', colors: { primary: '#5aa9e6', secondary: '#0b2545' } },
  { id: 'asagi', place: '浅葱', name: '浅葱フォルテ', initials: 'AF', colors: { primary: '#00897b', secondary: '#ffffff' } },
  { id: 'midorigawa', place: '緑川', name: '緑川ヴェルデ', initials: 'MV', colors: { primary: '#2e7d32', secondary: '#ffd54f' } },
  { id: 'amagi', place: '天城', name: '天城ロッソ', initials: 'AR', colors: { primary: '#8e1b1b', secondary: '#f5d76e' } },
  { id: 'wakabadai', place: '若葉台', name: '若葉台アスレティック', initials: 'WA', colors: { primary: '#7cb342', secondary: '#263238' } },
  { id: 'takanosu', place: '鷹ノ巣', name: '鷹ノ巣ウインズ', initials: 'TW', colors: { primary: '#37474f', secondary: '#ff7043' } },
  { id: 'aoihara', place: '葵原', name: '葵原ブルーウィングス', initials: 'ABW', colors: { primary: '#283593', secondary: '#90caf9' } },
  { id: 'asanagi', place: '朝凪', name: '朝凪ソレイユ', initials: 'AS', colors: { primary: '#f57c00', secondary: '#1565c0' } },
  { id: 'hoshimidai', place: '星見台', name: '星見台スターズ', initials: 'HS', colors: { primary: '#311b92', secondary: '#ffeb3b' } },
  { id: 'hibarino', place: '雲雀野', name: '雲雀野FC', initials: 'HFC', colors: { primary: '#6d4c41', secondary: '#fff3e0' } },
  { id: 'momijidani', place: '紅葉谷', name: '紅葉谷グランツ', initials: 'MG', colors: { primary: '#d84315', secondary: '#3e2723' } },
  { id: 'shiomi', place: '潮見', name: '潮見ガレオン', initials: 'SG', colors: { primary: '#006064', secondary: '#e0f7fa' } },
  { id: 'aomine', place: '青嶺', name: '青嶺ノヴァ', initials: 'AN', colors: { primary: '#1565c0', secondary: '#ffffff' } },
  { id: 'ichozaka', place: '銀杏坂', name: '銀杏坂SC', initials: 'ISC', colors: { primary: '#f9a825', secondary: '#212121' } },
];
