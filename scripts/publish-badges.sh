#!/usr/bin/env bash
# Publishes shields.io "endpoint" JSON badges to an orphan `badges` branch. The
# READMEs render them via img.shields.io/endpoint, so the badges update
# automatically with no external service.
#
# All badges are written in a single orphan commit, so this is the only writer
# of the `badges` branch — keep all badge files here to avoid clobbering.
#
#   - coverage.json     : API (backend) line coverage from
#                         coverage/coverage-summary.json (produced by
#                         `npm run coverage`).
#   - coverage-web.json : frontend (webapp) line coverage from
#                         coverage/webapp/coverage-summary.json (produced by
#                         `npm run coverage:webapp`). Tracked separately from the
#                         API number, hence two badges. Skipped if absent.
#   - i18n.json         : weakest-locale translation coverage from i18n-report.cjs.
#
# Requires GH_TOKEN (a token with contents:write) and GITHUB_REPOSITORY.
set -euo pipefail

# Map a coverage percentage to a shields.io colour.
badge_color() {
  local pct="$1"
  if   [ "$pct" -ge 90 ]; then echo brightgreen
  elif [ "$pct" -ge 80 ]; then echo green
  elif [ "$pct" -ge 70 ]; then echo yellowgreen
  elif [ "$pct" -ge 60 ]; then echo yellow
  else                         echo orange
  fi
}

WORKDIR="$(mktemp -d)"

# API (backend) coverage badge.
PCT=$(node -e "console.log(Math.round(require('./coverage/coverage-summary.json').total.lines.pct))")
printf '{"schemaVersion":1,"label":"API coverage","message":"%s%%","color":"%s"}\n' "$PCT" "$(badge_color "$PCT")" \
  > "$WORKDIR/coverage.json"

# Frontend (webapp) coverage badge — only if the summary was produced.
WEB_PCT=""
if [ -f ./coverage/webapp/coverage-summary.json ]; then
  WEB_PCT=$(node -e "console.log(Math.round(require('./coverage/webapp/coverage-summary.json').total.lines.pct))")
  printf '{"schemaVersion":1,"label":"Web coverage","message":"%s%%","color":"%s"}\n' "$WEB_PCT" "$(badge_color "$WEB_PCT")" \
    > "$WORKDIR/coverage-web.json"
fi

# i18n badge: the script computes the weakest-locale percentage itself.
node scripts/i18n-report.cjs --badge > "$WORKDIR/i18n.json"

# Replace the `badges` branch with a single fresh commit (no history buildup,
# and a force push creates the branch if it does not exist yet).
cd "$WORKDIR"
git init -q
git checkout -q -b badges
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add coverage.json i18n.json
[ -n "$WEB_PCT" ] && git add coverage-web.json
git commit -q -m "chore: badges (API ${PCT}%${WEB_PCT:+, web ${WEB_PCT}%})"
git push -q -f "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" badges

echo "Published badges: API ${PCT}%${WEB_PCT:+, web ${WEB_PCT}%}, i18n $(node -e "process.stdout.write(require('$WORKDIR/i18n.json').message)")"
