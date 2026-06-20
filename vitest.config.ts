import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The server code targets the Cloudflare Workers/Web platform and relies on
    // standard Web APIs (crypto.subtle, btoa/atob, URL, Request/Response, etc.).
    // Node 18+ exposes all of these as globals, so the default node environment
    // is sufficient for these unit tests.
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false,
  },
});
