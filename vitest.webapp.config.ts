import { defineConfig } from 'vitest/config';

// Frontend coverage orchestrator. Runs BOTH frontend test projects under one
// istanbul coverage report:
//   - vitest.webapp.jsdom.config.ts : unit + component tests (jsdom)
//   - vitest.contract.config.ts     : api-client contract tests against the
//                                     real worker (workerd/Miniflare)
// Combining them means the api/ modules — which are only exercised end-to-end
// against the real worker — count toward the webapp coverage number, the same
// way the backend merges its node + workerd projects in vitest.config.ts.
//
// This is a SEPARATE invocation from the backend suite so the backend's 95%
// ratchet stays independent of the frontend's (they move at different speeds).
export default defineConfig({
  test: {
    projects: ['vitest.webapp-jsdom.config.ts', 'vitest.contract.config.ts'],
    coverage: {
      // v8 coverage cannot run inside the workerd isolate, so use istanbul,
      // which works across both the jsdom and workers projects.
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
      // Ratcheting floor: CI fails if frontend coverage drops below these. Raise
      // them as new tests land so coverage can only move up. The lib pure-logic
      // surface and the api/ clients (via contract tests) are now covered; the
      // remaining gap is the large page components and hooks. Grow toward parity
      // with the backend (95/92/95/80) as those fill in.
      thresholds: {
        lines: 71,
        statements: 68,
        functions: 65,
        branches: 59,
      },
    },
  },
});
