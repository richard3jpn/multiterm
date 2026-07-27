import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      // ユニットテスト対象はロジック層。xterm/canvas依存のUIコンポーネントと
      // 起動ブートストラップ（main.tsx / App.tsx）はjsdomで実行不能のため対象外
      include: ['src/features/**/*.ts', 'src/services/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
