#!/usr/bin/env bash
# Boots the REAL NodeWarden worker (src/) for real-backend E2E: the actual
# Cloudflare Worker serving the built webapp AND the API on one origin, with a
# real (local Miniflare) D1 + R2, exactly like production. Unlike the demo-mode
# E2E, this exercises the true UI -> API -> D1 path incl. persistence.
#
# Fresh state every run (so "register the first admin" is deterministic and
# tests never depend on leftover data), isolated under /tmp so it never touches
# the developer's own `wrangler dev` state.
set -euo pipefail

STATE_DIR="${NW_E2E_STATE_DIR:-/tmp/nw-e2e-real-state}"
rm -rf "$STATE_DIR"

# A real (non-sample, >=32 char) JWT secret. .dev.vars is gitignored; create one
# if absent (CI starts without it).
if [ ! -f .dev.vars ]; then
  printf 'JWT_SECRET=%s\n' "$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")" > .dev.vars
fi

# The worker serves ./dist via the ASSETS binding; build it if missing.
if [ ! -d dist ] || [ -z "$(ls -A dist 2>/dev/null)" ]; then
  npm run build
fi

exec npx wrangler dev --local --persist-to "$STATE_DIR" --port 8787 --ip 127.0.0.1
