#!/usr/bin/env bash
# Publishes a shields.io "endpoint" JSON describing the current line coverage to
# an orphan `badges` branch. The READMEs render it via img.shields.io/endpoint,
# so the coverage badge updates automatically with no external service.
#
# Reads coverage/coverage-summary.json (produced by `npm run coverage`).
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

# Replace the `badges` branch with a single fresh commit (no history buildup,
# and a force push creates the branch if it does not exist yet).
cd "$WORKDIR"
git init -q
git checkout -q -b badges
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add coverage.json
git commit -q -m "chore: coverage badge ${PCT}%"
git push -q -f "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" badges

echo "Published coverage badge: ${PCT}% (${COLOR})"
