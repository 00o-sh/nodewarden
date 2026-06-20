#!/usr/bin/env bash
# Publish the translated wiki pages under ../docs/wiki/ into the GitHub wiki.
#
# GitHub wikis are a SEPARATE git repository (`<repo>.wiki.git`) and have no
# REST/MCP API for content, and you cannot attach Actions workflows to the wiki
# repo itself. So the wiki is synced by pushing to it from elsewhere: either a
# workflow in THIS repo (.github/workflows/sync-wiki.yml) or this script run by
# hand.
#
# Prerequisites:
#   - The wiki must be enabled (Settings -> Features -> Wikis) and seeded with
#     at least one page via the web UI, otherwise the wiki repo won't exist.
#   - Push access to the wiki: a credential helper / SSH locally, or set
#     GH_TOKEN to a token with `contents: write` (the Actions GITHUB_TOKEN works).
#
# Usage:
#   scripts/publish-wiki.sh                       # 00o-sh/nodewarden, https auth
#   WIKI_REPO=you/yourfork scripts/publish-wiki.sh
#   GH_TOKEN=*** scripts/publish-wiki.sh          # token auth (CI)
set -euo pipefail

WIKI_REPO="${WIKI_REPO:-00o-sh/nodewarden}"
SRC_DIR="$(cd "$(dirname "$0")/../docs/wiki" && pwd)"

if [ -n "${GH_TOKEN:-}" ]; then
  WIKI_URL="https://x-access-token:${GH_TOKEN}@github.com/${WIKI_REPO}.wiki.git"
else
  WIKI_URL="https://github.com/${WIKI_REPO}.wiki.git"
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "Cloning ${WIKI_REPO}.wiki.git ..."
git clone "$WIKI_URL" "$WORKDIR/wiki"

# Mirror the translated pages over whatever is currently in the wiki: replace
# every tracked markdown page, but never publish docs/wiki/README.md (that file
# documents this directory, it is not a wiki page).
find "$WORKDIR/wiki" -maxdepth 1 -name '*.md' -delete
for f in "$SRC_DIR"/*.md; do
  [ "$(basename "$f")" = "README.md" ] && continue
  cp "$f" "$WORKDIR/wiki/"
done

cd "$WORKDIR/wiki"
if git diff --quiet; then
  echo "Wiki already up to date — nothing to push."
  exit 0
fi

git -c user.name="${GIT_AUTHOR_NAME:-github-actions[bot]}" \
    -c user.email="${GIT_AUTHOR_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}" \
    commit -am "Sync wiki from docs/wiki (English translation)"
git push origin HEAD
echo "Pushed translated wiki to ${WIKI_REPO}."
