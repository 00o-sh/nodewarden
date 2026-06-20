#!/usr/bin/env bash
# Publishes shields.io "endpoint" JSON badges to an orphan `badges` branch. The
# READMEs render them via img.shields.io/endpoint, so the badges update
# automatically with no external service.
#
# Both badges are written in a single orphan commit, so this is the only writer
# of the `badges` branch — keep all badge files here to avoid clobbering.
#
#   - coverage.json : line coverage from coverage/coverage-summary.json
#                     (produced by `npm run coverage`).
#   - i18n.json     : weakest-locale translation coverage from i18n-report.cjs.
#
# Requires GH_TOKEN (a token with contents:write) and GITHUB_REPOSITORY.
set -euo pipefail

PCT=$(node -e "console.log(Math.round(require('./coverage/coverage-summary.json').total.lines.pct))")

if   [ "$PCT" -ge 90 ]; then COLOR=brightgreen
elif [ "$PCT" -ge 80 ]; then COLOR=green
elif [ "$PCT" -ge 70 ]; then COLOR=yellowgreen
elif [ "$PCT" -ge 60 ]; then COLOR=yellow
else                         COLOR=orange
fi

WORKDIR="$(mktemp -d)"
printf '{"schemaVersion":1,"label":"coverage","message":"%s%%","color":"%s"}\n' "$PCT" "$COLOR" \
  > "$WORKDIR/coverage.json"

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
git commit -q -m "chore: badges (coverage ${PCT}%)"
git push -q -f "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" badges

echo "Published badges: coverage ${PCT}% (${COLOR}), i18n $(node -e "process.stdout.write(require('$WORKDIR/i18n.json').message)")"
