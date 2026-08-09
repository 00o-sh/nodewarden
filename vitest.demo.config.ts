import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// Demo-build coverage gate. lib/demo.ts (~1600 lines) and lib/demo-brand-icons.ts
// are aliased OUT of the production bundle (see webapp/vite.config.ts) and swapped
// for empty stubs, so the main webapp suite never runs them and they carry no
// coverage there. This config runs the DEMO wiring — __NODEWARDEN_DEMO__ = true
// and the real demo modules aliased in — under its own istanbul report, so the
// demo build's logic is tested instead of being a large untested blob.
//
// Kept as a SEPARATE invocation (npm run coverage:demo) from vitest.webapp.config.ts
// so the two never fight over coverage/ output and the production suite stays
// unaware of demo-only code.
const rootDir = fileURLToPath(new URL('.', import.meta.url));
const webappSrc = path.resolve(rootDir, 'webapp/src');

export default defineConfig({
  plugins: [preact()],
  // Mirror the demo build-time define so the demo code paths (IS_DEMO_MODE = true)
  // are what the tests exercise.
  define: {
    __NODEWARDEN_DEMO__: 'true',
  },
  resolve: {
    alias: {
      // Mirror the `mode === 'demo'` branch of webapp/vite.config.ts: the demo
      // build keeps the real demo modules instead of the empty stubs.
      '@/lib/demo': path.resolve(webappSrc, 'lib/demo.ts'),
      '@/lib/demo-brand-icons': path.resolve(webappSrc, 'lib/demo-brand-icons.ts'),
      '@': webappSrc,
      '@shared': path.resolve(rootDir, 'shared'),
    },
  },
  test: {
    name: 'demo',
    environment: 'jsdom',
    globals: true,
    include: ['webapp/test/demo/**/*.test.{ts,tsx}'],
    setupFiles: ['webapp/test/setup.ts'],
    coverage: {
      // v8 can't instrument these under the demo define reliably; istanbul matches
      // the rest of the frontend suite.
      provider: 'istanbul',
      // Only the demo-build-only modules — everything else is covered by the main
      // webapp suite.
      include: ['webapp/src/lib/demo.ts', 'webapp/src/lib/demo-brand-icons.ts'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage/demo',
      // Ratcheting floor for the demo build, set just under the current numbers
      // (lines 100 / statements 99 / functions 98.7 / branches 90.6) so the gains
      // are locked in. Raise as coverage grows; the demo wiring is pure in-memory
      // state manipulation, so it can reach high numbers. The residual uncovered
      // branches are exhaustive `value || ''` fallback arms.
      thresholds: {
        lines: 99,
        statements: 98,
        functions: 97,
        branches: 89,
      },
    },
  },
});
