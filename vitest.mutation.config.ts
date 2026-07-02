import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// Minimal, FAST vitest project for mutation testing (Stryker): only the
// security-critical modules' unit tests, so Stryker can re-run the suite per
// mutant quickly. Mirrors the jsdom project's plugins/aliases/env.
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
    name: 'mutation',
    environment: 'jsdom',
    globals: true,
    include: [
      'webapp/test/unit/crypto.test.ts',
      'webapp/test/unit/crypto-hardening.test.ts',
      'webapp/test/unit/decrypt-cipher.test.ts',
      'webapp/test/unit/vault-decrypt.test.ts',
    ],
    setupFiles: ['webapp/test/setup.ts'],
  },
});
