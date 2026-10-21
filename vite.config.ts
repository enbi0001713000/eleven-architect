import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages など、サブフォルダに置いても動くように相対パスにする
  base: './',
  worker: { format: 'es' },
});
