import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Frontend lint gate. Deliberately scoped to the webapp (and its tests/e2e):
// the backend (src/, test/, shared/) is covered by its own suite and is out of
// scope for the frontend testing effort, so it is not linted here. Rules are the
// typescript-eslint "recommended" set with a few that the existing frontend code
// legitimately relies on relaxed — tighten these over time (the same ratcheting
// philosophy as the coverage floors).
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'webapp/public/**',
      // Everything outside the webapp is not part of this gate.
      'src/**',
      'shared/**',
      'test/**',
      'scripts/**',
      '*.config.{js,ts}',
      '*.cjs',
      '*.mjs',
    ],
  },
  {
    files: ['webapp/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.browser,
        // Build-time define injected by Vite (see webapp/vite.config.ts).
        __NODEWARDEN_DEMO__: 'readonly',
      },
    },
    rules: {
      // The frontend intentionally uses `any` at dynamic boundaries (server
      // payloads, importer parsing). Keep it visible as a warning, not a
      // hard failure.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow intentionally-unused args/vars when prefixed with `_`.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Empty catch blocks are used deliberately for best-effort cleanup.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Importer/crypto parsing matches literal control characters by design.
      'no-control-regex': 'off',
      // Pre-existing patterns in the frontend flagged for later review; surfaced
      // as warnings so they don't block the gate but stay visible.
      'no-unsafe-finally': 'warn',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'warn',
    },
  },
  {
    // Tests and E2E run in Node/jsdom with vitest + playwright globals.
    files: ['webapp/test/**/*.{ts,tsx}', 'webapp/e2e/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
);
