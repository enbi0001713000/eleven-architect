import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // たくさんの試合を回すテストがあるので、1つのテストに最大3分まで待つ
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
