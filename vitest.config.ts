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
      // new tests land so coverage can only move up. Current focus is the
      // D1/R2-backed handlers (Bucket A); the backup-uploader, WebAuthn, and
      // Durable Object internals are deliberately excluded as low-value to test.
      thresholds: {
        lines: 73,
        statements: 69,
        functions: 82,
        branches: 56,
      },
    },
  },
});
