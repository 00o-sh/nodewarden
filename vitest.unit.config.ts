import { defineConfig } from 'vitest/config';

// Pure-function unit tests. These rely only on standard Web APIs available as
// Node globals, so the default node environment is sufficient and fast.
export default defineConfig({
  test: {
    name: 'unit',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**', '**/node_modules/**'],
    globals: false,
  },
});
