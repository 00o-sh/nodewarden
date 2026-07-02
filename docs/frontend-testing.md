# Frontend testing strategy

Goal: **when a PR's checks are green, we are confident the frontend can merge.**
No suite makes that literally 100% — the practical bar is that every layer the
frontend can break is gated as a required check, and the seam between the
frontend and the *real* backend is tested rather than mocked.

The backend (`src/`) already has its own unit + integration suite with a 95%
coverage ratchet (`vitest.config.ts`, the `test` job in
`.github/workflows/test.yml`). This document covers the **frontend** (`webapp/`):
Preact + wouter + @tanstack/react-query, built with Vite.

## The layers

| Layer | Runs in | Config | What it proves |
|-------|---------|--------|----------------|
| **Static** | — | `eslint.config.js`, `tsc` | Lint + types are sound before anything runs |
| **Unit** | jsdom/Node | `vitest.webapp-jsdom.config.ts` | Pure logic: crypto, importers, utils, api helpers |
| **Component** | jsdom | `vitest.webapp-jsdom.config.ts` | Components/hooks render and behave correctly |
| **Contract** | real Workers runtime | `vitest.contract.config.ts` | The webapp api client agrees with the real backend |
| **E2E** | real browser (Chromium) | `playwright.config.ts` | Critical journeys work in the fully built app |

`vitest.webapp.config.ts` is the **coverage orchestrator**: it runs the jsdom
project *and* the contract project under one istanbul report, so coverage of the
`api/` clients — which are only exercised end-to-end against the real worker —
counts toward the webapp coverage floor (the same way the backend merges its
node + workerd projects).

### Static gates

- **ESLint** (`npm run lint`) — typescript-eslint recommended, scoped to
  `webapp/`. Blocking.
- **Typecheck** (`npm run typecheck:webapp`) — `tsc --noEmit` over the webapp.
  **Blocking.** Enabling it originally surfaced pre-existing errors (a real
  latent bug where `BackupCenterPage`'s delete-destination path called
  `onSaveSettings` without the master password, plus two TS-strictness issues);
  those are now fixed, so the gate guards against type regressions.

### Unit tests — `webapp/test/unit/`

The highest-stakes, cheapest-to-test surface. Includes:

- **Crypto** (`crypto.test.ts`) — real WebCrypto round-trips for the Bitwarden
  AES-CBC-HMAC format, PBKDF2/HKDF derivation, MAC-tamper rejection, and the
  RFC 6238 TOTP test vector. For a password manager this is the surface that
  most needs to be correct.
- **Importers** (`import-formats.test.ts`) — the CSV parser plus format parsers
  (Bitwarden, Chrome, …) over fixture data.
- **Utilities** (`website-utils.test.ts`, `api-shared.test.ts`).

### Component tests — `webapp/test/component/`

`@testing-library/preact` in jsdom: render a component/hook, drive it, assert
the DOM and callbacks. Start with high-traffic, high-risk components and grow.

### Contract tests — `webapp/test/contract/` (the key layer)

These run the webapp's **own** `lib/api/*` client against the **real worker**
(workerd via Miniflare — the same runtime the backend integration suite uses).
The client's global `fetch` is routed to the live worker
(`webapp/test/contract/setup.ts`), so real frontend crypto and request shaping
are verified against real backend handlers.

`auth-flow.test.ts` runs a full account lifecycle — register → prelogin →
password login → authenticated profile read → vault-key unlock — entirely
through the frontend client. **This is what turns "the backend's API tests pass
*and* the frontend's component tests pass" into "the two halves actually
agree."** Request/response shape drift between frontend and backend fails here,
where neither the unit nor component suite would catch it.

### E2E smoke — `webapp/e2e/`

Playwright against the **demo build** (`npm run build:demo` / `dev:demo`), which
stubs the backend so journeys are deterministic and network-free while still
exercising the fully wired app in a real browser. Keep these few and critical
(boot, log in, see the vault). Chromium is provided by the environment /
`npx playwright install chromium` in CI.

## Running locally

```bash
npm run lint                 # ESLint (webapp)
npm run typecheck:webapp     # tsc --noEmit (webapp)
npm run test:webapp          # unit + component
npm run coverage:webapp      # the above + coverage ratchet
npm run test:contract        # frontend client vs real worker
npm run build && npm run build:demo
npm run test:e2e             # Playwright (set PLAYWRIGHT_CHROMIUM_PATH to reuse a
                             # pre-installed Chromium, e.g. in a managed sandbox)
```

## The coverage ratchet

`vitest.webapp.config.ts` enforces minimum coverage over `webapp/src`. The floor
is seeded **just below** what today's tests achieve, so it can only move up.
Raise it as tests land; it is intentionally low now because the suite covers a
slice of the webapp — the gate prevents regression, it is not a claim of broad
coverage. Target: parity with the backend (lines 95 / statements 92 /
functions 95 / branches 80).

The two suites also publish **separate coverage badges** — "API coverage"
(backend) and "Web coverage" (frontend) — so the frontend number is tracked on
its own and never drags the backend's down (they were never the same number).


1. The `frontend` job in `.github/workflows/test.yml` runs every blocking layer.
2. Add these as **required status checks** in branch protection for `main` so a
   PR physically cannot merge unless they pass:
   - `test` (backend), `frontend` (this job), and the security workflow as desired.
3. Keep raising the coverage floor as the suite grows.

## Fail-closed gating — making "green = safe"

The bar this suite is held to: **if the `frontend` job is green, the change is
safe to merge.** We bias fail-closed — it is better to block a safe change than
to let an unsafe one through. Concretely:

- **Real-backend E2E** (`playwright.realbackend.config.ts`,
  `webapp/e2e-real/`) drives the *production stack* — the real worker serving the
  built webapp + API on one origin, backed by a real local D1/R2 — through
  register → login → vault CRUD with genuine client-side crypto, and asserts
  **persistence across a full reload (with unlock) and a fresh login session**.
  Demo-mode E2E (stubbed backend) cannot prove this; this is the strongest
  green-means-safe signal. (`scripts/e2e-real-server.sh` boots a fresh-state
  worker per run.)
- **Changed-line coverage gate** (`scripts/check-diff-coverage.cjs`,
  `npm run coverage:diff`): the ratchet only blocks coverage *regressions*; this
  blocks **new untested code** — every executable line a PR adds/changes under
  `webapp/src` must be exercised, or CI fails. Fail-closed: a changed source
  file with no coverage data at all is treated as a violation.
- **No flake-pass**: Playwright `retries: 0` in CI, so a flake turns the gate
  red instead of passing on a retry.

### What green still does NOT guarantee

Green means "no known regression in the tested surface + the core real-stack
journeys work." It is **not** a substitute for human review of
security-sensitive diffs. Crypto, authentication, key handling, and access
control changes should get human eyes **regardless of green** — do not wire up
auto-merge-on-green for those. Coverage % measures execution, not assertion
quality; a line can be covered without being meaningfully checked.

## Mutation testing the crypto (assertion quality)

Coverage proves a line *ran*; it does not prove a test would *catch a bug* in it.
For the security-critical crypto we check that directly with mutation testing
(Stryker): `npm run mutation:crypto` deliberately mutates
`webapp/src/lib/{crypto,decrypt-cipher,vault-decrypt}.ts` and confirms a test
fails for each change. Surviving mutants are assertions too loose to notice the
bug.

This is a **local / periodic QA tool, not a CI gate** (too slow to run per PR).
The crypto suite has been hardened against it with known-answer vectors
(PBKDF2-HMAC-SHA256, HKDF multi-block, RFC 6238 TOTP at multiple times) plus
explicit MAC-enforcement, malformed-input, and boundary tests — so an output- or
guard-changing mutation in the core encrypt/decrypt/derive paths fails a test.
(The score reported by `stryker.crypto.config.json`'s minimal runner is a *lower
bound*: it runs only the crypto unit tests for speed, so mutants the full suite
would also kill show as uncovered. Remaining survivors are equivalent mutants —
e.g. the constant-time length pre-check — and legacy cipher-string types the app
never emits.)
