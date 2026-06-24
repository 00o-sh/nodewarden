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
      // Only instrument TypeScript sources. The `.json` data files under
      // src/static (e.g. the global-domains rule sets) are not executable code;
      // including them makes istanbul's uncovered-file pass try to parse JSON as
      // JavaScript, which throws a SyntaxError.
      include: ['src/**/*.ts', 'shared/**/*.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      // Ratcheting floor: CI fails if coverage drops below these. Raise them as
      // new tests land so coverage can only move up. Coverage now includes the
      // backup subsystem (local export/import plus the remote WebDAV/S3 flows,
      // exercised end-to-end with real in-memory servers rather than mocks),
      // plus the upstream realtime-notifications and mobile push-relay paths.
      thresholds: {
        lines: 95,
        statements: 92,
        functions: 95,
        branches: 79,
      },
    },
  },
});
