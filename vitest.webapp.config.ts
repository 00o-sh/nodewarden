import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// Frontend tests (webapp/). Two layers run here in the jsdom environment:
//   - unit:      pure-logic tests for lib/ helpers (crypto, importers, utils).
//   - component: rendered-DOM tests for components/hooks via @testing-library.
//
// This is intentionally a SEPARATE vitest invocation from the backend suite
// (vitest.config.ts) so the backend's 95% coverage ratchet stays independent of
// the frontend's (the two move at different speeds). Full-stack contract tests
// that need the real Workers runtime live in vitest.contract.config.ts.
const rootDir = fileURLToPath(new URL('.', import.meta.url));
const webappSrc = path.resolve(rootDir, 'webapp/src');

export default defineConfig({
  plugins: [preact()],
  // Mirror the build-time define so production (non-demo) code paths are what
  // the tests exercise.
  define: {
    __NODEWARDEN_DEMO__: 'false',
  },
  resolve: {
    alias: {
      // Mirror webapp/vite.config.ts: the non-demo build swaps the demo modules
      // for empty stubs, so tests exercise the real (production) wiring.
      '@/lib/demo': path.resolve(webappSrc, 'lib/demo.empty.ts'),
      '@/lib/demo-brand-icons': path.resolve(webappSrc, 'lib/demo.empty.ts'),
      '@': webappSrc,
      '@shared': path.resolve(rootDir, 'shared'),
    },
  },
  test: {
    name: 'webapp',
    environment: 'jsdom',
    globals: true,
    include: ['webapp/test/unit/**/*.test.{ts,tsx}', 'webapp/test/component/**/*.test.{ts,tsx}'],
    setupFiles: ['webapp/test/setup.ts'],
    coverage: {
      provider: 'istanbul',
      include: ['webapp/src/**/*.{ts,tsx}'],
      // Generated/entry/asset-only modules carry no testable logic; excluding
      // them keeps the ratchet meaningful instead of penalising untestable code.
      exclude: [
        'webapp/src/main.tsx',
        'webapp/src/vite-env.d.ts',
        'webapp/src/**/*.d.ts',
        'webapp/src/workers/**',
        'webapp/src/lib/demo.ts',
        'webapp/src/lib/demo.empty.ts',
        'webapp/src/lib/demo-brand-icons.ts',
        'webapp/src/lib/i18n/locales/**',
      ],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage/webapp',
      // Ratcheting floor: CI fails if frontend coverage drops below these.
      // Raise them as new tests land so coverage can only move up. The pure-logic
      // surface of webapp/src/lib (crypto, importers, exporters, vault/backup
      // helpers, network/offline) is now broadly covered; the remaining gap is
      // the large page components, hooks, and api/ clients. Grow toward parity
      // with the backend (95/92/95/80) as those fill in.
      thresholds: {
        lines: 25,
        statements: 24,
        functions: 14,
        branches: 20,
      },
    },
  },
});
