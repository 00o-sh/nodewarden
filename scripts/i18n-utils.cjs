const fs = require('fs');
const path = require('path');
const vm = require('vm');

// CONTRACT:
// This list is the script-side locale source of truth. Keep it in sync with
// webapp/src/lib/i18n.ts whenever adding/removing a locale.
const localeDir = path.join(__dirname, '..', 'webapp', 'src', 'lib', 'i18n', 'locales');

const localeFiles = [
  ['en', 'en.ts', 'en', 'English'],
  ['zh-CN', 'zh-CN.ts', 'zhCN', 'Simplified Chinese'],
  ['zh-TW', 'zh-TW.ts', 'zhTW', 'Traditional Chinese'],
  ['ru', 'ru.ts', 'ru', 'Russian'],
  ['es', 'es.ts', 'es', 'Spanish'],
];

// CONTRACT:
// Keys that are intentionally identical to English in every locale (protocol
// names, log enums, punctuation, etc.). Shared by i18n-validate.cjs (so they
// don't trip the mostly-English guard) and i18n-report.cjs (so they don't count
// as untranslated). Keep this the single source of truth.
const intentionallyEnglishKeys = new Set([
  'txt_backup_destination_detail_note',
  'txt_backup_protocol_webdav',
  'txt_backup_protocol_s3',
  'txt_backup_recommend_group_webdav',
  'txt_backup_recommend_group_s3',
  'txt_backup_destination_name_default_webdav',
  'txt_backup_destination_name_default_s3',
  'txt_dash',
  'txt_text_3',
  // Brand / product names, abbreviations, and protocol identifiers that stay
  // English in every locale.
  'txt_ios', // "iOS"
  'txt_android', // "Android"
  'txt_totp', // "TOTP"
  'txt_uri_match_regular_expression', // "Regex"
  'txt_nodewarden_send', // "NodeWarden Send"
  'txt_backup_recommend_koofr_dav_self', // "Koofr"
  'txt_backup_s3_addressing_virtual_hosted_style', // "virtual-hosted-style"
]);

const intentionallyEnglishPrefixes = [
  'txt_log_action_',
  'txt_log_meta_',
  'txt_log_reason_',
  'txt_log_target_type_',
  'txt_log_trigger_',
];

function isIntentionallyEnglishKey(key) {
  return (
    intentionallyEnglishKeys.has(key) ||
    intentionallyEnglishPrefixes.some((prefix) => key.startsWith(prefix))
  );
}

// CONTRACT:
// Keys whose correct translation in a SPECIFIC locale happens to be byte-for-byte
// identical to English (e.g. Spanish "Total" / "No", or an A-Z sort label). Unlike
// intentionallyEnglishKeys, these ARE translated in other locales, so the exception
// is scoped per locale. Used by i18n-report.cjs so the coverage figure isn't
// dragged down by correct-but-identical strings.
const verifiedSameAsEnglishByLocale = {
  es: new Set([
    'txt_no', // "No"
    'txt_total', // "Total"
    'txt_actor', // "Actor"
    'txt_log_level_error', // "Error"
    'txt_log_level_info', // "Info"
    'txt_log_total', // " total"
    'txt_uri_match_host', // "Host"
    'txt_web', // "Web"
    'txt_sort_name', // "A-Z"
  ]),
  'zh-CN': new Set([
    'txt_sort_name', // "A-Z" (pinyin sort)
  ]),
  'zh-TW': new Set([
    'txt_sort_name', // "A-Z" (pinyin sort)
  ]),
};

function isVerifiedSameAsEnglish(locale, key) {
  const set = verifiedSameAsEnglishByLocale[locale];
  return Boolean(set && set.has(key));
}

function readLocale(fileName, variableName) {
  let code = fs.readFileSync(path.join(localeDir, fileName), 'utf8');
  code = code
    .replace(/const (\w+): Record<string, string> =/g, 'const $1 =')
    .replace(/export default \w+;\s*$/m, '');
  code += `\nresult = ${variableName};`;
  const sandbox = { result: null };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: fileName });
  return sandbox.result;
}

function writeLocale(fileName, variableName, table, header) {
  const body = JSON.stringify(table, null, 2);
  fs.writeFileSync(
    path.join(localeDir, fileName),
    `${header}\nconst ${variableName}: Record<string, string> = ${body};\n\nexport default ${variableName};\n`,
    'utf8'
  );
}

module.exports = {
  localeFiles,
  localeDir,
  readLocale,
  writeLocale,
  intentionallyEnglishKeys,
  intentionallyEnglishPrefixes,
  isIntentionallyEnglishKey,
  verifiedSameAsEnglishByLocale,
  isVerifiedSameAsEnglish,
};
