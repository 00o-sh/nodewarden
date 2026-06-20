# Wiki (English translation)

This directory holds an English translation of the project Wiki, pulled from
the upstream `shuaiplus/NodeWarden` wiki and translated for the `00o-sh/nodewarden`
fork.

GitHub wikis are a **separate git repository** (`<repo>.wiki.git`) and have no
REST API for content, so the pages live here as plain Markdown for review and
are published to the actual wiki by the `Sync wiki` workflow (or the script it
runs).

## Pages

| File | Wiki page | Upstream source |
|---|---|---|
| `Home.md` | Home | `Home.md` |
| `Quick-Start.md` | Quick Start | `快速开始.md` |
| `Feature-Overview.md` | Feature Overview | `功能总览.md` |
| `Import-and-Export.md` | Import and Export | `导入与导出.md` |
| `Backup-and-Restore.md` | Backup and Restore | `备份与恢复.md` |
| `FAQ.md` | FAQ | `常见问题.md` |
| `_Sidebar.md` | (sidebar navigation) | `_Sidebar.md` |

Source: upstream wiki commit `000076b` (`Add initial Chinese wiki`).

## How to re-pull from upstream

The upstream wiki is public and clones anonymously:

```bash
git clone https://github.com/shuaiplus/NodeWarden.wiki.git
```

Translate each `*.md` page into English, keeping the English filenames above so
the page URLs and the cross-links in `Home.md` / `_Sidebar.md` stay valid.

## How to publish to the wiki

The wiki must first be enabled (repo **Settings → Features → Wikis**) and seeded
with one page via the web UI; only then does the `*.wiki.git` repo exist.

**Automatically:** the [`Sync wiki`](../../.github/workflows/sync-wiki.yml)
workflow publishes this directory to the GitHub wiki on every push to `main`
that touches `docs/wiki/**` (and can be run on demand from the Actions tab).
Actions can't run inside a wiki repo, so the sync lives in the main repo and
pushes into `<repo>.wiki.git` using the built-in `GITHUB_TOKEN`.

**Manually:** run the same script the workflow uses:

```bash
scripts/publish-wiki.sh
```

It clones `00o-sh/nodewarden.wiki.git`, replaces its Markdown pages with the
ones in this directory (excluding this `README.md`), and pushes. Run it from a
machine that can authenticate to GitHub, or set `GH_TOKEN`.

> Note: this can't be done from the remote Claude Code environment — its git
> proxy only routes the code repo, not the `*.wiki.git` repo.
