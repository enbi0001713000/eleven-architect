// ゲームの版がずれていないか（タイトル画面に出す版と package.json）

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../src/ui/about';

describe('ゲームの版', () => {
  it('タイトル画面に出す版は package.json の version と同じ', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });
});
