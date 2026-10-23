// 色の計算のテスト（クラブの色を画面の飾りに使うとき、背景から見分けられる色を選ぶ）

import { describe, expect, it } from 'vitest';
import { clubVars, shade, textOn } from '../src/ui/colors';

describe('クラブの色', () => {
  it('暗くしたり明るくしたりできる', () => {
    expect(shade('#808080', 0.5)).toBe('#404040');
    expect(shade('#000000', -1)).toBe('#ffffff');
    expect(shade('#123456', 0)).toBe('#123456');
  });

  it('上に置く文字は、明るい色なら黒、暗い色なら白', () => {
    expect(textOn('#f4f4f4')).toBe('#111111');
    expect(textOn('#1d3f8f')).toBe('#ffffff');
  });

  it('線の色：明るい配色で白いクラブは2番目の色、暗い配色で暗いクラブは明るくした色', () => {
    expect(clubVars({ primary: '#f4f4f4', secondary: '#2f6db5' }, 'light')['--club-line']).toBe('#2f6db5');
    expect(clubVars({ primary: '#d94f87', secondary: '#ffffff' }, 'light')['--club-line']).toBe('#d94f87');
    expect(clubVars({ primary: '#311b92', secondary: '#ffeb3b' }, 'dark')['--club-line']).toBe('#ffeb3b');
    expect(clubVars({ primary: '#1a1a1a', secondary: '#202020' }, 'dark')['--club-line']).toBe(shade('#1a1a1a', -0.5));
    expect(clubVars(undefined)).toEqual({});
  });
});
