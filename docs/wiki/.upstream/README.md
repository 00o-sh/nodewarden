# Upstream wiki snapshot

This directory is a **verbatim snapshot of the upstream Chinese wiki**
(`shuaiplus/NodeWarden`) as of the commit recorded in `UPSTREAM_COMMIT`. It is
the baseline the [`Sync upstream wiki`](../../../.github/workflows/sync-upstream-wiki.yml)
workflow diffs against to detect when upstream has changed.

These files are **not** published to our wiki — `scripts/publish-wiki.sh` only
copies the top-level `docs/wiki/*.md` pages, not this subdirectory.

When upstream changes, the workflow opens a tracking issue. To resolve it:

1. Re-translate the changed pages into `docs/wiki/*.md`.
2. Refresh this snapshot (copy the new upstream `*.md` here and update
   `UPSTREAM_COMMIT` to the new SHA) in the same PR.

Merging that PR advances the baseline and lets the `Sync wiki` workflow publish
the updated English pages.
