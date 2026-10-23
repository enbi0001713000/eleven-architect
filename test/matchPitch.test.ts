// 観戦の2D表示のユニフォームの色（芝生に埋もれず、両チームが見分けられる）

import { describe, expect, it } from 'vitest';
import { kitColors } from '../src/ui/components/MatchPitch';

describe('2D表示のユニフォームの色', () => {
  it('違う色ならそのまま使う', () => {
    expect(kitColors({ primary: '#d94f87', secondary: '#ffffff' }, { primary: '#1559c2', secondary: '#ffffff' })).toEqual(['#d94f87', '#1559c2']);
  });

  it('芝生と同じ緑のチームは、2番目の色にする', () => {
    const [, away] = kitColors({ primary: '#d94f87', secondary: '#ffffff' }, { primary: '#2a7a44', secondary: '#f4c430' });
    expect(away).toBe('#f4c430');
  });

  it('ホームと似た色のアウェイは、2番目の色か白・黒にする', () => {
    const [home, away] = kitColors({ primary: '#c8102e', secondary: '#ffffff' }, { primary: '#c41230', secondary: '#c8102e' });
    expect(home).toBe('#c8102e');
    expect(['#f2f2f2', '#1a1a1a']).toContain(away);
  });
});
