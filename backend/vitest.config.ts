import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // server.ts は起動ブートストラップ（実プロセス・実PTYが必要）のためユニット対象外
      exclude: ['src/server.ts', 'src/**/*.test.ts', 'src/types/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
