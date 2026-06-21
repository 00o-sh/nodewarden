#!/usr/bin/env node
// Reports per-locale translation coverage against the English base.
//
// Key parity is already enforced by i18n-validate.cjs, so every locale has the
// same set of keys. "Coverage" here therefore measures how many translatable
// keys actually differ from English; keys whose value still equals English are
// counted as untranslated. Keys that are intentionally English everywhere
// (protocol names, log enums, punctuation) are excluded from the denominator.
//
// Usage:
//   node scripts/i18n-report.cjs           # human-readable Markdown report
//   node scripts/i18n-report.cjs --json     # machine-readable JSON
//   node scripts/i18n-report.cjs --badge    # shields.io endpoint JSON (min locale)
const {
  localeFiles,
  readLocale,
  isIntentionallyEnglishKey,
  isVerifiedSameAsEnglish,
} = require('./i18n-utils.cjs');

const localeNames = Object.fromEntries(localeFiles.map(([locale, , , name]) => [locale, name]));
const locales = Object.fromEntries(
  localeFiles.map(([locale, fileName, variableName]) => [locale, readLocale(fileName, variableName)])
);

const base = locales.en;
const baseKeys = Object.keys(base);
const translatableKeys = baseKeys.filter((key) => !isIntentionallyEnglishKey(key));

const report = [];
for (const [locale, table] of Object.entries(locales)) {
  if (locale === 'en') continue;
  const missing = baseKeys.filter((key) => !(key in table));
  const untranslated = translatableKeys.filter(
    (key) => table[key] === base[key] && !isVerifiedSameAsEnglish(locale, key)
  );
  const translated = translatableKeys.length - untranslated.length;
  const pct = translatableKeys.length === 0 ? 100 : (translated / translatableKeys.length) * 100;
  report.push({
    locale,
    name: localeNames[locale] || locale,
    translated,
    translatable: translatableKeys.length,
    pct,
    untranslated,
    missing,
  });
}

const minPct = report.length ? Math.min(...report.map((r) => r.pct)) : 100;

function color(pct) {
  if (pct >= 99) return 'brightgreen';
  if (pct >= 90) return 'green';
  if (pct >= 75) return 'yellowgreen';
  if (pct >= 50) return 'yellow';
  return 'orange';
}

const mode = process.argv[2];

if (mode === '--badge') {
  // Headline = the weakest locale, so the badge never overstates completeness.
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      label: 'i18n',
      message: `${Math.round(minPct)}%`,
      color: color(minPct),
    })}\n`
  );
} else if (mode === '--json') {
  process.stdout.write(
    `${JSON.stringify(
      {
        base: 'en',
        totalKeys: baseKeys.length,
        translatableKeys: translatableKeys.length,
        intentionallyEnglishKeys: baseKeys.length - translatableKeys.length,
        minPct,
        locales: report,
      },
      null,
      2
    )}\n`
  );
} else {
  const lines = [];
  lines.push('# i18n coverage report');
  lines.push('');
  lines.push(
    `Base locale: \`en\` — ${baseKeys.length} keys ` +
      `(${translatableKeys.length} translatable, ${baseKeys.length - translatableKeys.length} intentionally English).`
  );
  lines.push('');
  lines.push('| Locale | Name | Coverage | Translated | Untranslated | Missing keys |');
  lines.push('|---|---|---:|---:|---:|---:|');
  for (const r of report) {
    lines.push(
      `| \`${r.locale}\` | ${r.name} | ${r.pct.toFixed(1)}% | ${r.translated}/${r.translatable} | ${r.untranslated.length} | ${r.missing.length} |`
    );
  }
  lines.push('');
  const withUntranslated = report.filter((r) => r.untranslated.length || r.missing.length);
  if (withUntranslated.length === 0) {
    lines.push('All locales are fully translated. 🎉');
  } else {
    lines.push('## Untranslated keys (value still equals English)');
    for (const r of withUntranslated) {
      lines.push('');
      lines.push(`### \`${r.locale}\` ${r.name} — ${r.untranslated.length} untranslated, ${r.missing.length} missing`);
      for (const key of r.missing) lines.push(`- ${key} (missing key)`);
      for (const key of r.untranslated) lines.push(`- ${key}`);
    }
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}
