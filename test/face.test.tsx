// 顔のイラストのテスト（同じ選手はいつも同じ顔、国籍で肌の色の幅が変わる、年齢で白髪とひげが出る）

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Face, faceLook } from '../src/ui/components/Face';

const kit = { kind: 'kit', primary: '#d94f87', secondary: '#ffffff' } as const;

describe('顔', () => {
  it('同じIDならいつも同じ顔、IDが違えば顔も違う', () => {
    expect(faceLook('p0001', '日本')).toEqual(faceLook('p0001', '日本'));
    const looks = Array.from({ length: 40 }, (_, i) => JSON.stringify(faceLook(`p${i}`, '日本')));
    expect(new Set(looks).size).toBe(40);
    const styles = new Set(Array.from({ length: 80 }, (_, i) => faceLook(`q${i}`, '日本').hairStyle));
    expect(styles.size).toBeGreaterThanOrEqual(5);
  });

  it('国籍で肌の色の幅が変わる（ブラジルは濃い肌の選手もいる）', () => {
    const skins = (nat: string) => new Set(Array.from({ length: 200 }, (_, i) => faceLook(`s${i}`, nat).skin));
    expect([...skins('ブラジル')].some((c) => !skins('日本').has(c))).toBe(true);
    // 知らない国籍は日本と同じ幅で描く
    expect(faceLook('x1', '架空の国')).toEqual(faceLook('x1', '日本'));
  });

  it('白髪とひげは、決まった年齢から出る', () => {
    const look = { ...faceLook('p0002', '日本'), grayFrom: 34, facialHair: 'beard' as const, facialHairFrom: 25, hair: '#1c1917' };
    const young = renderToStaticMarkup(<Face look={look} age={20} outfit={kit} />);
    const old = renderToStaticMarkup(<Face look={look} age={36} outfit={kit} />);
    expect(young).toContain('#1c1917');
    expect(young).not.toContain('#8d8d8d');
    expect(old).toContain('#8d8d8d');
    expect(old.match(/<path/g)!.length).toBeGreaterThan(young.match(/<path/g)!.length);
  });
});
