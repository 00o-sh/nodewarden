import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// Minimal, FAST vitest project for mutation testing (Stryker) of the auth
// orchestration module (lib/app-auth.ts). Kept separate from
// vitest.mutation.config.ts (crypto core) so each Stryker run only loads the
// test files that can kill its mutants, keeping per-mutant re-runs quick.
// Mirrors the jsdom project's plugins/aliases/env.
const rootDir = fileURLToPath(new URL('.', import.meta.url));
const webappSrc = path.resolve(rootDir, 'webapp/src');

export default defineConfig({
  plugins: [preact()],
  define: { __NODEWARDEN_DEMO__: 'false' },
  resolve: {
    alias: {
      '@/lib/demo': path.resolve(webappSrc, 'lib/demo.empty.ts'),
      '@/lib/demo-brand-icons': path.resolve(webappSrc, 'lib/demo.empty.ts'),
      '@': webappSrc,
      '@shared': path.resolve(rootDir, 'shared'),
    },
  },
  test: {
    name: 'mutation-auth',
    environment: 'jsdom',
    globals: true,
    include: [
      // The login / unlock / registration orchestration suite — the primary
      // killers for app-auth.ts mutants.
      'webapp/test/unit/app-auth.test.ts',
      // Dedicated mutation-killers: black-box assertions on the observable
      // outputs of app-auth's internal helpers (JWT-exp / session-refresh
      // decisions, 2FA-provider parsing, transient-profile shaping) driven
      // through the public API.
      'webapp/test/unit/app-auth-mutation.test.ts',
      // Offline unlock drives performUnlock / hydrateLockedSession's offline path.
      'webapp/test/unit/offline-auth.test.ts',
    ],
    setupFiles: ['webapp/test/setup.ts'],
  },
});
