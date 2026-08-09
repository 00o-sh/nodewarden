#!/usr/bin/env node
/*
 * Stale-override detector — keeps the package.json `overrides` block honest.
 *
 * We pin a single version of certain transitive packages via `overrides` so the
 * whole tree dedupes onto one copy (security-review surface, bundle size, etc.).
 * The hazard is drift: an override is a MANUAL pin that Renovate stops nagging
 * about once its bump PR is closed as "blocked" (see issue #234 — the `undici`
 * pin sat at 7.x for months after jsdom had already moved to `undici@^8`). A pin
 * that has fallen *below* what packages in the tree now ask for is invisible in
 * normal installs because overrides always win — npm silently forces the stale
 * version instead of erroring.
 *
 * This script reads the committed `overrides` block and `package-lock.json` and,
 * for every consumer that declares one of the overridden packages, compares the
 * version the override actually forces against that consumer's declared range:
 *
 *   - HELD BACK  — the forced version is *older* than a consumer's range allows
 *                  (e.g. consumer wants `^8.9.0`, override forces `7.29.0`).
 *                  This is the actionable "the ecosystem moved past our pin, bump
 *                  it" signal. It is what opens/updates the tracking issue.
 *
 *   - FORCING AHEAD — the forced version is *newer* than a consumer's range
 *                  (e.g. miniflare declares `7.29.0`, override forces `8.10.0`).
 *                  This is usually a deliberate, test-verified decision, so it is
 *                  reported for visibility but never triggers the issue on its own
 *                  (otherwise every intentional override would nag forever).
 *
 * The check is fully static: it never touches the network and only reads files,
 * so it is safe and fast to run nightly.
 *
 * Usage:
 *   node scripts/check-stale-overrides.cjs [--markdown|--json]
 *                                          [--manifest <path>] [--lockfile <path>]
 *
 * Output formats:
 *   (default)   human-readable report to stdout
 *   --markdown  GitHub-issue-ready markdown body (used by the nightly workflow)
 *   --json      machine-readable findings
 *
 * Exit codes (so the workflow can decide whether to open an issue without
 * failing the job):
 *   0  no held-back overrides (tree is healthy)
 *   2  at least one held-back override found
 *   1  usage / input error
 */
const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');

function parseArgs(argv) {
  const opts = { format: 'text', manifest: 'package.json', lockfile: 'package-lock.json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--markdown') opts.format = 'markdown';
    else if (a === '--json') opts.format = 'json';
    else if (a === '--manifest') opts.manifest = argv[++i];
    else if (a === '--lockfile') opts.lockfile = argv[++i];
    else {
      process.stderr.write(`Unknown argument: ${a}\n`);
      process.exit(1);
    }
  }
  return opts;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (err) {
    process.stderr.write(`Cannot read ${file}: ${err.message}\n`);
    process.exit(1);
  }
}

// Flatten the `overrides` block into a list of top-level package pins we can
// analyse. Nested/scoped overrides (an object value that pins a *child* only
// within one parent's subtree, e.g. `{"@vitest/coverage-istanbul": {"@babel/core":
// "..."}}`) and "$name" reference specs are not resolvable from the lockfile
// alone, so we surface them as "unanalyzed" rather than pretend they were checked.
function collectOverrides(overrides) {
  const analyzable = [];
  const skipped = [];
  for (const [name, spec] of Object.entries(overrides || {})) {
    if (typeof spec === 'string' && !spec.startsWith('$')) analyzable.push({ name, spec });
    else skipped.push({ name, reason: typeof spec === 'object' ? 'scoped/nested override' : `reference spec "${spec}"` });
  }
  return { analyzable, skipped };
}

// Resolve which installed copy of `depName` a package at `consumerPath` actually
// gets, using npm's nearest-ancestor node_modules rule against the lockfile
// `packages` map. Returns the resolved lockfile entry (with a synthetic `path`),
// or null if not found.
function resolveInstalled(packages, consumerPath, depName) {
  // Walk from the consumer's own node_modules up through each enclosing
  // node_modules, ending at the root ("node_modules/<dep>").
  let base = consumerPath;
  for (;;) {
    const candidate = base ? `${base}/node_modules/${depName}` : `node_modules/${depName}`;
    if (packages[candidate]) return { path: candidate, ...packages[candidate] };
    if (!base) return null;
    // Strip the trailing `/node_modules/<pkg>` segment to move one level out.
    const idx = base.lastIndexOf('/node_modules/');
    base = idx === -1 ? '' : base.slice(0, idx);
  }
}

const DEP_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];

function analyze(manifest, lock) {
  const { analyzable, skipped } = collectOverrides(manifest.overrides);
  const packages = lock.packages || {};
  const overrideNames = new Set(analyzable.map((o) => o.name));
  const specByName = new Map(analyzable.map((o) => [o.name, o.spec]));

  // finding buckets keyed by override package name
  const heldBack = new Map(); // name -> { spec, consumers: [{consumer, range, forced}] }
  const forcingAhead = new Map();

  for (const [pkgPath, entry] of Object.entries(packages)) {
    for (const field of DEP_FIELDS) {
      const deps = entry[field];
      if (!deps) continue;
      for (const [depName, range] of Object.entries(deps)) {
        if (!overrideNames.has(depName)) continue;
        const installed = resolveInstalled(packages, pkgPath, depName);
        if (!installed || !installed.version) continue;
        const forced = installed.version;
        // A bare "*"/"latest"/workspace/link range is satisfied by anything —
        // it can never be "held back", so skip it.
        if (semver.satisfies(forced, range, { includePrerelease: true })) continue;

        const consumerName = pkgPath === '' ? '(root)' : pkgPath.replace(/^.*node_modules\//, '');
        const record = { consumer: consumerName, consumerPath: pkgPath || '(root)', range, forced };

        if (semver.validRange(range) && semver.ltr(forced, range)) {
          // forced version is older than the range wants -> stale pin
          if (!heldBack.has(depName)) heldBack.set(depName, { spec: specByName.get(depName), consumers: [] });
          heldBack.get(depName).consumers.push(record);
        } else if (semver.validRange(range) && semver.gtr(forced, range)) {
          if (!forcingAhead.has(depName)) forcingAhead.set(depName, { spec: specByName.get(depName), consumers: [] });
          forcingAhead.get(depName).consumers.push(record);
        }
        // (ranges that don't parse are ignored — nothing actionable we can say)
      }
    }
  }

  return { heldBack, forcingAhead, skipped };
}

function toPlain(map) {
  return [...map.entries()].map(([name, v]) => ({ name, spec: v.spec, consumers: v.consumers }));
}

function renderText({ heldBack, forcingAhead, skipped }) {
  const lines = [];
  if (heldBack.size === 0) {
    lines.push('✓ No stale (held-back) overrides found.');
  } else {
    lines.push(`✗ ${heldBack.size} stale override(s) — the pin is older than a consumer requires:\n`);
    for (const [name, v] of heldBack) {
      lines.push(`  ${name} (override pins "${v.spec}")`);
      for (const c of v.consumers) {
        lines.push(`    - ${c.consumer} declares "${c.range}" but the override forces ${c.forced}`);
      }
    }
  }
  if (forcingAhead.size > 0) {
    lines.push('\nℹ Overrides forcing a version NEWER than a consumer declares (verify still intentional):');
    for (const [name, v] of forcingAhead) {
      for (const c of v.consumers) {
        lines.push(`  - ${name}: ${c.consumer} declares "${c.range}", override forces ${c.forced}`);
      }
    }
  }
  if (skipped.length > 0) {
    lines.push('\nNot analyzed (scoped/reference overrides):');
    for (const s of skipped) lines.push(`  - ${s.name} (${s.reason})`);
  }
  return lines.join('\n');
}

function renderMarkdown({ heldBack, forcingAhead, skipped }) {
  const md = [];
  md.push('## Stale override(s) detected', '');
  md.push(
    'The nightly override audit (`scripts/check-stale-overrides.cjs`) found `overrides` in `package.json` that pin a package **below** what other packages in the tree now require. Because overrides always win, npm forces the stale version silently instead of erroring.',
    '',
  );
  for (const [name, v] of heldBack) {
    md.push(`### \`${name}\` — override pins \`${v.spec}\``, '');
    md.push('| Consumer | Declares | Override forces |', '| --- | --- | --- |');
    for (const c of v.consumers) {
      md.push(`| \`${c.consumer}\` | \`${c.range}\` | \`${c.forced}\` |`);
    }
    md.push('');
    md.push(
      `**Action:** bump the \`${name}\` override (and any dependency whose range demands it) so the pin satisfies the ranges above, then verify the test suites that exercise \`${name}\`.`,
      '',
    );
  }
  if (forcingAhead.size > 0) {
    md.push('<details><summary>ℹ Overrides forcing a version newer than a consumer declares (informational — often intentional)</summary>', '');
    for (const [name, v] of forcingAhead) {
      for (const c of v.consumers) {
        md.push(`- \`${name}\`: \`${c.consumer}\` declares \`${c.range}\`, override forces \`${c.forced}\``);
      }
    }
    md.push('', '</details>', '');
  }
  if (skipped.length > 0) {
    md.push('<details><summary>Not analyzed (scoped/reference overrides)</summary>', '');
    for (const s of skipped) md.push(`- \`${s.name}\` (${s.reason})`);
    md.push('', '</details>', '');
  }
  md.push('---', '_Generated by the nightly override audit workflow._');
  return md.join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const manifest = readJson(opts.manifest);
  const lock = readJson(opts.lockfile);
  const result = analyze(manifest, lock);

  if (opts.format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          heldBack: toPlain(result.heldBack),
          forcingAhead: toPlain(result.forcingAhead),
          skipped: result.skipped,
        },
        null,
        2,
      ) + '\n',
    );
  } else if (opts.format === 'markdown') {
    // Only emit a body when there is something worth opening an issue about.
    if (result.heldBack.size > 0) process.stdout.write(renderMarkdown(result) + '\n');
  } else {
    process.stdout.write(renderText(result) + '\n');
  }

  process.exit(result.heldBack.size > 0 ? 2 : 0);
}

main();
