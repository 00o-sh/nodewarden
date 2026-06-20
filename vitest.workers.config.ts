import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Integration tests run inside the real Workers runtime (workerd via Miniflare)
// with in-memory D1 and R2 bindings, exercising the actual worker `fetch`
// handler end to end. Bindings here mirror wrangler.toml; the worker bootstraps
// its own D1 schema on the first request (see StorageService.initializeDatabase),
// so no migrations need to be applied manually.
//
// ASSETS is intentionally omitted: API paths (/api/*, /identity/*, /config) are
// handled by the worker, never the static asset handler, so leaving it unbound
// keeps the test setup simple without affecting the routes under test.
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      miniflare: {
        compatibilityDate: '2024-01-01',
        bindings: {
          // 38 chars, not the dev sentinel: passes the JWT_SECRET safety gate.
          JWT_SECRET: 'integration-test-jwt-secret-0123456789',
        },
        d1Databases: ['DB'],
        r2Buckets: ['ATTACHMENTS'],
        durableObjects: {
          NOTIFICATIONS_HUB: 'NotificationsHub',
          BACKUP_TRANSFER_RUNNER: 'BackupTransferRunner',
        },
      },
    }),
  ],
  test: {
    name: 'integration',
    include: ['test/integration/**/*.test.ts'],
  },
});
