import { defineConfig } from 'vitest/config';

// Two test projects:
//   - "unit":        fast pure-function tests in the Node environment.
//   - "integration": API contract/flow tests that run inside the real
//                    Cloudflare Workers runtime (Miniflare) with live D1/R2
//                    bindings, driving the actual worker `fetch` handler.
export default defineConfig({
  test: {
    projects: ['vitest.unit.config.ts', 'vitest.workers.config.ts'],
  },
});
