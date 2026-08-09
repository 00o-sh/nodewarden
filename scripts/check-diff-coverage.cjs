#!/usr/bin/env node
/*
 * Changed-line (diff) coverage gate — the fail-closed complement to the
 * ratcheting floor.
 *
 * The global ratchet only blocks coverage *regressions*; new code can still slip
 * in untested as long as overall % stays above the floor. This gate closes that
 * hole: every executable line a PR ADDS or MODIFIES under webapp/src must be
 * covered by the webapp test run, or CI fails. Bias is fail-closed — if we can't
 * prove a changed line is exercised, we block.
 *
 * Inputs:
 *   - git diff against the base ref (DIFF_COVERAGE_BASE, default origin/main)
 *   - coverage/webapp/coverage-final.json (istanbul; needs the 'json' reporter)
 *
 * Usage: node scripts/check-diff-coverage.cjs
 */
const { execFileSync } = require('node:child_process');

// Run git with an argv array (never a shell string) so values like the
// DIFF_COVERAGE_BASE env var can't be interpreted as shell — no command
// injection surface.
function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', ...opts });
}
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.DIFF_COVERAGE_BASE || 'origin/main';
const COVERAGE_FILE = path.resolve('coverage/webapp/coverage-final.json');
const FILE_RE = /^webapp\/src\/.*\.(ts|tsx)$/;
// Mirror the coverage-instrumentation `exclude` list in vitest.webapp.config.ts,
// plus type-only modules. Those files are deliberately never instrumented
// (entry/asset-only modules, type decls, the demo-mode shims, the i18n locale
// data, and the pure-type lib/types.ts), so they can never appear in the
// coverage report. Without matching the exclusion here the gate would flag any
// changed line in them as "untested" — a state no test could ever clear.
const EXCLUDE_RE = /^webapp\/src\/(?:main\.tsx$|.*\.d\.ts$|workers\/|lib\/(?:demo\.ts$|demo\.empty\.ts$|demo-brand-icons\.ts$|eff-word-list\.ts$|types\.ts$|i18n\/locales\/))/;
// Upstream-owned code pulled in by the sync that the fork's jsdom suite can't
// meaningfully exercise yet, excluded from the changed-line gate pending
// dedicated tests. Remove entries here as those tests land:
//   - VaultEditor / import-formats-browser: live camera + canvas + jsQR pipeline.
//   - App.tsx: new mainRoutesProps wiring lives in the root controller, which is
//     only tested at the child level (AppMainRoutes/AuthenticatedShell), not by
//     rendering the full controller.
//   - BackupCenterPage / ImportPage: the v1.7.3 sync added these components'
//     behavior and their happy paths + most branches are now covered, but a few
//     residual guards can't be exercised in jsdom — multi-hundred-MiB
//     import/archive size-limit throws (assertImportZipSize / assertImportTextFile
//     Size / fflate entry-size caps) and re-entrancy / disabled-button guards the
//     UI prevents from ever firing. Excluded pending fault-injection harnesses.
//   - The v1.7.3 sync's new bank-account / drivers-license / passport vault item
//     types (types 6/7/8) added many defensive per-field branch arms across
//     api/vault, api/auth, app-auth, vault-page-helpers, VaultDetailView,
//     VaultPage, VaultSidebar and SettingsPage. The behavior (all statements and
//     the primary branches) is covered by the ~2000 tests added in this sync;
//     the residue is exhaustive `dec ?? plain` fallback / `type===N && obj`
//     false-arm coverage. Excluded pending a dedicated per-field branch-matrix
//     test pass — REMOVE these entries as that lands.
//   - The v1.8.0 upstream sync added large new feature modules faster than the
//     fork's suite covers every changed line: the password generator
//     (password-generator, ssh-key-generator), Password Security scanning
//     (password-security, password-security-cache), offline/support wiring
//     (app-support), plus small changed-line residue in existing files
//     (crypto, i18n, account-passkeys, VaultListPanel, PublicSendPage,
//     SendsPage, useAdminActions, useAccountSecurityActions). Overall webapp
//     coverage floors still pass with these included; only the stricter
//     changed-line gate defers them here pending dedicated tests — REMOVE these
//     entries as that coverage lands. (eff-word-list is pure diceware data and
//     lives in EXCLUDE_RE.)
//   - Removed (coverage has landed, so changed lines are now gated): lib/crypto.ts
//     (98% lines / 95% branches), lib/account-passkeys.ts (98% / 94%),
//     lib/app-auth.ts (93% / 83%), lib/password-generator.ts (98% / 85%),
//     lib/ssh-key-generator.ts (100% / 85%), and lib/api/auth.ts (87% / 70%,
//     createAuthedFetch + registerAccount now unit-tested).
//   - Also removed: lib/api/vault.ts (97% / 86%), lib/import-formats-browser.ts
//     (100% / 91%), lib/password-security.ts (100% / 89%), and
//     lib/password-security-cache.ts (100% / 88%).
//   - Also removed: lib/app-support.ts (100% / 90%), lib/i18n.ts (99% / 93%),
//     hooks/useAdminActions.ts (100% branches) and hooks/useAccountSecurityActions.ts
//     (100% / 91%).
//   - Also removed the vault components: VaultEditor.tsx (97% / 88%),
//     VaultDetailView.tsx (100% / 93%), VaultListPanel.tsx (100% / 91%),
//     VaultSidebar.tsx (100% / 96%) and vault-page-helpers.tsx (99% / 98%).
//   - Also removed the page components: App.tsx (90/85), SettingsPage (97/89),
//     VaultPage (96/86), BackupCenterPage (96/83), ImportPage (89/86),
//     PublicSendPage (83/88), SendsPage (95/91), PasswordGeneratorPage (92/98),
//     PasswordSecurityPage (100/94), AppGlobalOverlays (100/98),
//     AppMainRoutes (100/95), AuthViews (100/98).
//
// The skip-list is now EMPTY: every instrumented webapp/src module has its
// changed lines gated. (PublicSendPage lines and BackupCenterPage branches sit
// ~83% only because of statically-dead IS_DEMO_MODE blocks and single-threaded
// re-entrancy guards, which real edits never touch; if one ever false-fires the
// diff gate, add a targeted EXCLUDE_RE entry rather than re-skipping the file.)
const FEATURE_SKIP_RE = /(?!)/; // empty — matches nothing; the gate now covers all of webapp/src

function fail(msg) {
  console.error(`\n✖ diff-coverage: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(COVERAGE_FILE)) {
  fail(`missing ${COVERAGE_FILE} — run "npm run coverage:webapp" first (needs the json reporter).`);
}

// Resolve a merge-base so we only look at lines this branch actually introduced.
let base = BASE;
try {
  base = git(['merge-base', BASE, 'HEAD']).trim() || BASE;
} catch {
  // Fall back to the raw ref (e.g. shallow CI checkout without history).
}

// Parse `git diff -U0` into { file -> Set(addedLineNumbers) }.
function changedLines() {
  let diff = '';
  try {
    diff = git(['diff', '--unified=0', '--no-color', `${base}...HEAD`], { maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    fail(`could not compute git diff against ${base}: ${err.message}`);
  }
  const byFile = new Map();
  let current = null;
  for (const line of diff.split('\n')) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      current = FILE_RE.test(fileMatch[1]) && !EXCLUDE_RE.test(fileMatch[1]) && !FEATURE_SKIP_RE.test(fileMatch[1]) ? fileMatch[1] : null;
      if (current && !byFile.has(current)) byFile.set(current, new Set());
      continue;
    }
    if (!current) continue;
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let i = 0; i < count; i += 1) byFile.get(current).add(start + i);
    }
  }
  return byFile;
}

// Build the set of UNCOVERED line numbers for a file from istanbul data:
// any statement OR branch location with a zero hit count marks its lines.
function uncoveredLines(entry) {
  const uncovered = new Set();
  const addRange = (loc) => {
    if (!loc || !loc.start || !loc.end) return;
    for (let ln = loc.start.line; ln <= loc.end.line; ln += 1) uncovered.add(ln);
  };
  for (const [id, count] of Object.entries(entry.s || {})) {
    if (count === 0 && entry.statementMap?.[id]) addRange(entry.statementMap[id]);
  }
  for (const [id, counts] of Object.entries(entry.b || {})) {
    const locs = entry.branchMap?.[id]?.locations || [];
    counts.forEach((c, i) => {
      if (c === 0 && locs[i]) addRange(locs[i]);
    });
  }
  return uncovered;
}

const coverage = JSON.parse(fs.readFileSync(COVERAGE_FILE, 'utf8'));
// Index coverage by repo-relative posix path.
const covByRel = new Map();
for (const [abs, entry] of Object.entries(coverage)) {
  const rel = path.relative(process.cwd(), abs).split(path.sep).join('/');
  covByRel.set(rel, entry);
}

const changed = changedLines();
if (changed.size === 0) {
  console.log('diff-coverage: no changed webapp/src lines — nothing to check.');
  process.exit(0);
}

const violations = [];
for (const [file, addedLines] of changed) {
  const entry = covByRel.get(file);
  if (!entry) {
    // File changed but not in the coverage report. If it's an instrumentable
    // source file, that means it has NO coverage at all — fail closed.
    violations.push({ file, lines: [...addedLines], reason: 'no coverage data (file untested)' });
    continue;
  }
  const uncovered = uncoveredLines(entry);
  const bad = [...addedLines].filter((ln) => uncovered.has(ln)).sort((a, b) => a - b);
  if (bad.length) violations.push({ file, lines: bad });
}

if (violations.length === 0) {
  console.log(`diff-coverage: all changed webapp/src lines are covered (base ${base.slice(0, 12)}). ✓`);
  process.exit(0);
}

console.error('\n✖ diff-coverage: changed lines without test coverage (fail-closed):\n');
for (const v of violations) {
  console.error(`  ${v.file}${v.reason ? ` — ${v.reason}` : ''}`);
  console.error(`    uncovered changed lines: ${v.lines.join(', ')}`);
}
console.error('\nAdd tests that exercise these lines, or the change cannot merge.');
process.exit(1);
