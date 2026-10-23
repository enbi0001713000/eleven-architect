// 1.2「観戦の強化」のテスト（ドット絵の選手、ピッチの立ち位置、選手の見た目、実況を変えても結果が変わらないこと、設定の初期値）

import { describe, expect, it } from 'vitest';
import { commentary } from '../src/engine/commentary';
import { LiveMatch } from '../src/engine/match';
import { createRng } from '../src/engine/rng';
import { prepareMatchday } from '../src/game/season';
import { createWorld, startNewGame } from '../src/game/world';
import { colorDistance } from '../src/ui/colors';
import { keeperShirt, matchLooks } from '../src/ui/matchLooks';
import { pitchSpots } from '../src/ui/pitchModel';
import { loadSettings } from '../src/ui/settings';
import { RUN_FRAMES, SPRITE_H, SPRITE_W, spritePixels, type SpriteLook } from '../src/ui/sprites';

const look: SpriteLook = {
  shirt: '#c0392b', shorts: '#ffffff', socks: '#c0392b', numberColor: '#fefefe', skin: '#e8b98f', hair: '#2a1a10',
  hairShape: 'short', number: 10, keeper: false,
};
const pixelsOf = (px: (string | null)[], color: string) => px.filter((c) => c === color).length;

describe('ドット絵の選手', () => {
  it('16×26ドットで、まわりを線で囲む', () => {
    const px = spritePixels(look, 'down', { kind: 'stand' });
    expect(px).toHaveLength(SPRITE_W * SPRITE_H);
    expect(pixelsOf(px, '#14201a')).toBeGreaterThan(20);
    // 体の高さは24ドット前後（描いた行の数）
    const rows = new Set(px.map((c, i) => (c && c !== '#14201a' ? Math.floor(i / SPRITE_W) : -1)).filter((r) => r >= 0));
    expect(rows.size).toBeGreaterThanOrEqual(22);
    expect(rows.size).toBeLessThanOrEqual(26);
  });

  it('背中には背番号を描き、正面には描かない', () => {
    expect(pixelsOf(spritePixels(look, 'up', { kind: 'stand' }), look.numberColor)).toBeGreaterThan(10);
    expect(pixelsOf(spritePixels(look, 'down', { kind: 'stand' }), look.numberColor)).toBe(0);
    expect(pixelsOf(spritePixels({ ...look, number: null }, 'up', { kind: 'stand' }), look.numberColor)).toBe(0);
  });

  it('走りは6コマで、コマごとに形が変わる。横向きは正面と違う', () => {
    const frames = Array.from({ length: RUN_FRAMES }, (_, frame) => spritePixels(look, 'side', { kind: 'run', frame }).join(','));
    expect(new Set(frames).size).toBeGreaterThanOrEqual(4);
    expect(spritePixels(look, 'side', { kind: 'stand' }).join(',')).not.toBe(spritePixels(look, 'down', { kind: 'stand' }).join(','));
  });

  it('喜ぶポーズは手を頭より上に上げる', () => {
    const stand = spritePixels(look, 'down', { kind: 'stand' });
    const cheer = spritePixels(look, 'down', { kind: 'cheer', frame: 0 });
    const topRow = (px: (string | null)[]) => Math.floor(px.findIndex((c) => c !== null && c !== '#14201a') / SPRITE_W);
    expect(topRow(cheer)).toBeLessThan(topRow(stand));
  });

  it('髪型ごとに頭の形が変わり、GKは手袋をつける', () => {
    const shapes = (['buzz', 'short', 'sidePart', 'curly', 'spiky', 'long', 'receding'] as const)
      .map((hairShape) => spritePixels({ ...look, hairShape }, 'down', { kind: 'stand' }).join(','));
    expect(new Set(shapes).size).toBe(7);
    expect(pixelsOf(spritePixels({ ...look, keeper: true }, 'down', { kind: 'stand' }), '#f4f4f0')).toBeGreaterThan(0);
  });
});

function liveMatch(seed = 21) {
  const world = createWorld(seed);
  const game = startNewGame(world, 'テスト監督', Object.keys(world.clubs)[2]!);
  const day = prepareMatchday(game)[0]!;
  return { game, day, live: new LiveMatch(day.home, day.away, { seed: day.seed, important: day.important }) };
}

describe('ピッチの立ち位置', () => {
  it('22人が立ち、ボールを持つ選手はボールの位置にいる', () => {
    const { live } = liveMatch();
    for (let i = 0; i < 60; i++) live.advanceStep();
    const snapshot = live.snapshot();
    const { spots, ball } = pitchSpots(snapshot);
    expect(spots).toHaveLength(22);
    expect(spots.filter((s) => s.goalkeeper)).toHaveLength(2);
    const holder = spots.find((s) => s.id === snapshot.ball.holderId);
    expect(holder).toBeDefined();
    expect(ball).toEqual({ x: holder!.x, y: holder!.y });
    for (const s of spots) {
      expect(s.x).toBeGreaterThan(-1);
      expect(s.x).toBeLessThan(7);
    }
  });

  it('同じ状態からは、いつも同じ立ち位置になる', () => {
    const a = liveMatch(33);
    const b = liveMatch(33);
    for (let i = 0; i < 40; i++) { a.live.advanceStep(); b.live.advanceStep(); }
    expect(pitchSpots(a.live.snapshot())).toEqual(pitchSpots(b.live.snapshot()));
  });
});

describe('選手の見た目', () => {
  it('GKのシャツは、両チームのユニフォームと見分けられる色', () => {
    const kits = ['#f2c500', '#2fbf71'];
    const shirt = keeperShirt(kits);
    for (const kit of kits) expect(colorDistance(shirt, kit)).toBeGreaterThan(80);
    expect(keeperShirt([...kits, shirt], [shirt])).not.toBe(shirt);
  });

  it('ホームとアウェイの選手に、ユニフォームの色と背番号が付く', () => {
    const { game, day } = liveMatch();
    const looks = matchLooks(game, day.fixture.homeId, day.fixture.awayId, ['#c0392b', '#1559c2'], 0.8, 5);
    const homePlayer = game.players[day.home.lineup[5]!]!;
    const awayPlayer = game.players[day.away.lineup[5]!]!;
    const homeInfo = looks.infoOf(homePlayer.id)!;
    const awayInfo = looks.infoOf(awayPlayer.id)!;
    expect(homeInfo.side).toBe(0);
    expect(awayInfo.side).toBe(1);
    expect(homeInfo.look.shirt).toBe('#c0392b');
    expect(awayInfo.look.shirt).toBe('#1559c2');
    expect(homeInfo.look.number).toBe(homePlayer.squadNumber ?? null);
    const keeper = game.players[day.home.lineup[0]!]!;
    expect(keeper.position).toBe('GK');
    expect(looks.infoOf(keeper.id)!.look.keeper).toBe(true);
    expect(looks.options.crowdFill).toBe(0.8);
  });
});

describe('実況の言い回しを変えても、試合の結果は変わらない', () => {
  it('実況は1つにつき乱数を1回だけ使う', () => {
    for (const key of ['shotOff', 'headerOff', 'shotSaved', 'goal', 'tackle'] as const) {
      const a = createRng(99);
      const b = createRng(99);
      commentary(a, key, { p: 'A', q: 'B', gk: 'C', team: 'T' });
      b.next();
      expect(a.next()).toBe(b.next());
    }
  });

  it('ポストやバーに当たるのは、外れたシュートのうち1割ほど', () => {
    const rng = createRng(7);
    let post = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (/ポスト|バー/.test(commentary(rng, i % 2 ? 'shotOff' : 'headerOff', { p: 'A' }))) post++;
    expect(post / n).toBeGreaterThan(0.08);
    expect(post / n).toBeLessThan(0.18);
  });
});

describe('設定', () => {
  it('初めては大きく見るモード、ドット絵、音あり', () => {
    const settings = loadSettings();
    expect(settings.matchView).toBe('big');
    expect(settings.pitchStyle).toBe('dot');
    expect(settings.sound).toBe(true);
    expect(settings.volume).toBeGreaterThan(0);
    expect(settings.camera).toBe('whole');
  });
});
