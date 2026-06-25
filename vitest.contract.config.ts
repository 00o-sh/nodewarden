import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Full-stack CONTRACT tests: the webapp's own lib/api client code is driven
// against the REAL worker (workerd via Miniflare, same runtime as the backend
// integration suite), not against mocks. A contract test's global `fetch` is
// routed to the live worker (see webapp/test/contract/setup.ts), so the actual
// frontend crypto + request shaping is verified against the actual backend
// handlers. This is the layer that turns "API tests pass AND component tests
// pass" into "the two halves actually agree" — the seam where shape drift
// between frontend and backend would otherwise slip through both suites.
const rootDir = fileURLToPath(new URL('.', import.meta.url));
const webappSrc = path.resolve(rootDir, 'webapp/src');

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      miniflare: {
        compatibilityDate: '2026-01-31',
        bindings: {
          JWT_SECRET: `ctest-${crypto.randomUUID()}-${crypto.randomUUID()}`,
        },
        d1Databases: ['DB'],
        r2Buckets: ['ATTACHMENTS'],
        kvNamespaces: ['ATTACHMENTS_KV'],
        durableObjects: {
          NOTIFICATIONS_HUB: 'NotificationsHub',
          BACKUP_TRANSFER_RUNNER: 'BackupTransferRunner',
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@/lib/demo': path.resolve(webappSrc, 'lib/demo.empty.ts'),
      '@/lib/demo-brand-icons': path.resolve(webappSrc, 'lib/demo.empty.ts'),
      '@': webappSrc,
      '@shared': path.resolve(rootDir, 'shared'),
    },
  },
  define: {
    __NODEWARDEN_DEMO__: 'false',
  },
  test: {
    name: 'contract',
    include: ['webapp/test/contract/**/*.test.ts'],
    setupFiles: ['webapp/test/contract/setup.ts'],
  },
});
