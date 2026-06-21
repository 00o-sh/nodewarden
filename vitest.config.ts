import { defineConfig } from 'vitest/config';

// Two test projects:
//   - "unit":        fast pure-function tests in the Node environment.
//   - "integration": API contract/flow tests that run inside the real
//                    Cloudflare Workers runtime (Miniflare) with live D1/R2
//                    bindings, driving the actual worker `fetch` handler.
export default defineConfig({
  test: {
    projects: ['vitest.unit.config.ts', 'vitest.workers.config.ts'],
    coverage: {
      // v8 coverage cannot run inside the workerd (Workers) isolate, so use
      // istanbul instrumentation, which works across both the node and workers
      // projects.
      provider: 'istanbul',
      include: ['src/**', 'shared/**'],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      // Ratcheting floor: CI fails if coverage drops below these. Raise them as
      // new tests land so coverage can only move up. Coverage now includes the
      // backup subsystem (local export/import plus the remote WebDAV/S3 flows,
      // exercised end-to-end with real in-memory servers rather than mocks).
      thresholds: {
        lines: 83,
        statements: 80,
        functions: 90,
        branches: 65,
      },
    },
  },
});
