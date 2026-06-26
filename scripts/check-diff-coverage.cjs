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
      current = FILE_RE.test(fileMatch[1]) ? fileMatch[1] : null;
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
