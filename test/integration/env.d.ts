/// <reference types="@cloudflare/vitest-pool-workers" />

// Types for the bindings exposed to integration tests via `cloudflare:test`.
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    ATTACHMENTS: R2Bucket;
    JWT_SECRET: string;
  }
}
