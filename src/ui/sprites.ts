// ドット絵の選手（要件定義書「観戦の強化（1.2〜）」）。他のゲームの絵は使わず、プログラムで1ドットずつ描く。
// 1人は16×26ドット（体は24ドットほど）。向きは正面・背中・横（左向きは横を裏返す）、走りは6コマ、喜ぶポーズは2コマ。
// 髪型、肌と髪の色は顔のイラスト（Face.tsx）と合わせ、背中に背番号を描く。ここは色の並びを作るだけで、画面には描かない。

export const SPRITE_W = 16;
export const SPRITE_H = 26;

export type HairShape = 'buzz' | 'short' | 'sidePart' | 'curly' | 'spiky' | 'long' | 'receding';
export type Facing = 'down' | 'up' | 'side';
export type Pose = { kind: 'stand' } | { kind: 'run'; frame: number } | { kind: 'cheer'; frame: number };

export interface SpriteLook {
  shirt: string;
  shorts: string;
  socks: string;
  /** 背番号の色（シャツの上で読める色） */
  numberColor: string;
  skin: string;
  hair: string;
  hairShape: HairShape;
  number: number | null;
  /** GKは手袋をつける */
  keeper: boolean;
}

export const RUN_FRAMES = 6;
const OUTLINE = '#14201a';
const BOOT = '#1b1b1f';
const EYE = '#20140f';
const GLOVE = '#f4f4f0';

/** 3×5ドットの数字 */
const DIGITS: Record<string, string[]> = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

/** 色を少し暗く（影の側に使う） */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1] as string, 16);
  const ch = (shift: number) => Math.max(0, Math.min(255, Math.round(((v >> shift) & 255) * (1 - amount))));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

class Grid {
  readonly pixels: (string | null)[] = new Array(SPRITE_W * SPRITE_H).fill(null);
  set(x: number, y: number, color: string): void {
    if (x < 0 || y < 0 || x >= SPRITE_W || y >= SPRITE_H) return;
    this.pixels[y * SPRITE_W + x] = color;
  }
  rect(x: number, y: number, w: number, h: number, color: string): void {
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) this.set(x + i, y + j, color);
  }
  get(x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= SPRITE_W || y >= SPRITE_H) return null;
    return this.pixels[y * SPRITE_W + x] ?? null;
  }
  /** 芝生の上で見えるように、まわりを1ドットの線で囲む */
  outline(): void {
    const filled = this.pixels.map((p) => p !== null);
    for (let y = 0; y < SPRITE_H; y++) {
      for (let x = 0; x < SPRITE_W; x++) {
        if (filled[y * SPRITE_W + x]) continue;
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const nx = x + (dx as number);
          const ny = y + (dy as number);
          return nx >= 0 && ny >= 0 && nx < SPRITE_W && ny < SPRITE_H && filled[ny * SPRITE_W + nx];
        });
        if (near) this.pixels[y * SPRITE_W + x] = OUTLINE;
      }
    }
  }
}

function drawNumber(g: Grid, n: number, centerX: number, top: number, color: string): void {
  const text = String(n).slice(0, 2);
  const width = text.length * 3 + (text.length - 1);
  let x = centerX - Math.floor(width / 2);
  for (const ch of text) {
    const rows = DIGITS[ch] ?? DIGITS[0]!;
    rows.forEach((row, j) => [...row].forEach((bit, i) => { if (bit === '1') g.set(x + i, top + j, color); }));
    x += 4;
  }
}

/** 頭と髪（正面と背中）。top は頭のいちばん上の行 */
function headFront(g: Grid, look: SpriteLook, top: number, back: boolean): void {
  const skinDark = shade(look.skin, 0.18);
  g.rect(5, top, 6, 6, look.skin);
  g.rect(10, top + 1, 1, 5, skinDark);
  const hair = look.hair;
  const hairDark = shade(hair, 0.25);
  switch (look.hairShape) {
    case 'buzz':
      g.rect(5, top, 6, 1, hairDark);
      break;
    case 'short':
    case 'sidePart':
      g.rect(5, top, 6, 2, hair);
      g.set(5, top + 2, hair);
      g.set(10, top + 2, hair);
      if (look.hairShape === 'sidePart') g.set(7, top, shade(hair, -0.4));
      break;
    case 'curly':
      g.rect(4, top, 8, 2, hair);
      [4, 6, 8, 10].forEach((x) => g.set(x + 1, top - 1, hair));
      g.set(4, top + 2, hair);
      g.set(11, top + 2, hair);
      break;
    case 'spiky':
      g.rect(5, top, 6, 2, hair);
      [5, 7, 9].forEach((x) => g.set(x, top - 1, hair));
      g.set(10, top - 1, hair);
      break;
    case 'long':
      g.rect(5, top, 6, 2, hair);
      g.rect(4, top + 1, 1, 6, hair);
      g.rect(11, top + 1, 1, 6, hair);
      break;
    case 'receding':
      g.set(5, top + 1, hair);
      g.set(5, top + 2, hair);
      g.set(10, top + 1, hair);
      g.set(10, top + 2, hair);
      break;
  }
  if (back) {
    // 背中から見ると、頭の大部分が髪（剃っている人と薄い人は肌が見える）
    const cover = look.hairShape === 'buzz' ? hairDark : look.hairShape === 'receding' ? look.skin : hair;
    g.rect(5, top + 1, 6, 4, cover);
    if (look.hairShape === 'long') g.rect(5, top + 5, 6, 2, hair);
  } else {
    g.set(6, top + 3, EYE);
    g.set(9, top + 3, EYE);
  }
}

/** 正面と背中の体。走りは足を交互に上げ、腕を振る */
function bodyFront(g: Grid, look: SpriteLook, facing: 'down' | 'up', pose: Pose): void {
  const cheer = pose.kind === 'cheer';
  const frame = pose.kind === 'run' ? pose.frame % RUN_FRAMES : 0;
  const stride = pose.kind === 'run' ? [0, 1, 2, 0, -1, -2][frame] as number : 0;
  const bob = pose.kind === 'run' && (frame === 1 || frame === 4) ? -1 : 0;
  const top = 3 + bob;
  headFront(g, look, top, facing === 'up');
  // 首
  g.rect(7, top + 6, 2, 1, shade(look.skin, 0.18));
  // シャツ（右側を少し暗く）
  const shirtDark = shade(look.shirt, 0.2);
  g.rect(4, top + 7, 8, 7, look.shirt);
  g.rect(11, top + 8, 1, 6, shirtDark);
  if (facing === 'up' && look.number !== null) drawNumber(g, look.number, 8, top + 8, look.numberColor);
  if (facing === 'down') g.rect(7, top + 7, 2, 1, shade(look.shirt, 0.35));
  // 腕
  const hand = look.keeper ? GLOVE : look.skin;
  if (cheer) {
    // 両手を上げる
    const lift = pose.frame % 2 === 0 ? 0 : 1;
    g.rect(3, top - 2 + lift, 1, 2, hand);
    g.rect(12, top - 2 + lift, 1, 2, hand);
    g.rect(3, top + lift, 1, 2, look.skin);
    g.rect(12, top + lift, 1, 2, look.skin);
    g.rect(3, top + 2 + lift, 1, 5, look.shirt);
    g.rect(12, top + 2 + lift, 1, 5, shirtDark);
  } else {
    const swing = -stride;
    const arm = (x: number, offset: number, color: string) => {
      const y0 = top + 8 + Math.max(-1, Math.min(1, offset));
      g.rect(x, y0, 1, 2, color);
      g.rect(x, y0 + 2, 1, 3, look.skin);
      g.set(x, y0 + 5, hand);
    };
    arm(3, swing, look.shirt);
    arm(12, -swing, shirtDark);
  }
  // パンツ
  g.rect(5, top + 14, 6, 3, look.shorts);
  g.rect(10, top + 14, 1, 3, shade(look.shorts, 0.2));
  // 足：上げた足は短く見せる
  const leg = (x: number, lift: number) => {
    const from = top + 17;
    const foot = 25 - lift;
    for (let y = from; y <= foot; y++) {
      const color = y === foot ? BOOT : y - from < 2 ? look.skin : look.socks;
      g.rect(x, y, 2, 1, color);
    }
  };
  leg(5, stride > 0 ? stride : 0);
  leg(9, stride < 0 ? -stride : 0);
}

/** 横向き（右向き）。足を前後に開き、腕を振る */
function bodySide(g: Grid, look: SpriteLook, pose: Pose): void {
  const frame = pose.kind === 'run' ? pose.frame % RUN_FRAMES : 0;
  const stride = pose.kind === 'run' ? [3, 1, -1, -3, -1, 1][frame] as number : 0;
  const bob = pose.kind === 'run' && (frame === 1 || frame === 4) ? -1 : 0;
  const top = 3 + bob;
  const skinDark = shade(look.skin, 0.18);
  // 頭（横顔）
  g.rect(6, top, 5, 6, look.skin);
  g.set(11, top + 3, look.skin);
  g.set(9, top + 3, EYE);
  g.rect(6, top + 1, 1, 5, skinDark);
  const hair = look.hair;
  switch (look.hairShape) {
    case 'buzz': g.rect(6, top, 5, 1, shade(hair, 0.25)); break;
    case 'receding': g.rect(6, top + 1, 2, 2, hair); break;
    case 'curly': g.rect(5, top - 1, 6, 2, hair); g.rect(5, top + 1, 2, 3, hair); break;
    case 'spiky': g.rect(6, top, 5, 2, hair); g.set(6, top - 1, hair); g.set(8, top - 1, hair); g.rect(6, top + 2, 2, 2, hair); break;
    case 'long': g.rect(6, top, 5, 2, hair); g.rect(5, top + 1, 2, 7, hair); break;
    default: g.rect(6, top, 5, 2, hair); g.rect(6, top + 2, 2, 2, hair); break;
  }
  g.rect(8, top + 6, 2, 1, skinDark);
  // 胴
  g.rect(6, top + 7, 5, 7, look.shirt);
  g.rect(6, top + 8, 1, 6, shade(look.shirt, 0.2));
  // 腕（足と逆に振る）
  const hand = look.keeper ? GLOVE : look.skin;
  const swing = Math.round(-stride / 2);
  const armX = 8 + swing;
  g.rect(armX, top + 8, 2, 2, shade(look.shirt, 0.1));
  g.rect(armX + Math.sign(swing), top + 10, 2, 2, look.skin);
  g.rect(armX + Math.sign(swing) * 2, top + 12, 2, 1, hand);
  // パンツ
  g.rect(6, top + 14, 5, 3, look.shorts);
  // 足：腰から足先へ
  const hipY = top + 17;
  const leg = (dx: number, dark: boolean) => {
    const rows = 25 - hipY + 1;
    for (let r = 0; r < rows; r++) {
      const t = rows === 1 ? 1 : r / (rows - 1);
      const x = 7 + Math.round(dx * t);
      const color = r === rows - 1 ? BOOT : r < 2 ? (dark ? skinDark : look.skin) : dark ? shade(look.socks, 0.2) : look.socks;
      g.rect(x, hipY + r, 2, 1, color);
    }
    if (dx >= 0) g.set(9 + Math.round(dx), 25, BOOT);
  };
  leg(-stride, true);
  leg(stride, false);
}

/** 1コマ分の色の並び（左上から右へ、上から下へ。null は透明） */
export function spritePixels(look: SpriteLook, facing: Facing, pose: Pose): (string | null)[] {
  const g = new Grid();
  if (facing === 'side' && pose.kind !== 'cheer') bodySide(g, look, pose);
  else bodyFront(g, look, facing === 'up' ? 'up' : 'down', pose);
  g.outline();
  return g.pixels;
}
