import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// The jsdom half of the frontend suite: pure-logic unit tests and rendered-DOM
// component/hook tests. Run directly (npm run test:webapp) for a fast inner
// loop. Coverage is orchestrated by vitest.webapp.config.ts, which runs this
// project AND the workerd contract project under one istanbul report so api/
// coverage (exercised only against the real worker) counts too.
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
  },
});
