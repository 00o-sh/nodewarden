// CONTRACT:
// Locale bundles are standalone and loaded on demand. Adding a locale requires
// updating Locale, AVAILABLE_LOCALES, browser-language detection, localeLoaders,
// scripts/i18n-utils.cjs, and the locale file itself.
//
// Do not call t() at module scope for exported arrays/constants; async init can
// otherwise leave raw txt_* keys in the rendered UI.
export type Locale =
  | 'en'
  | 'zh-CN'
  | 'zh-TW'
  | 'ru'
  | 'es';

import enMessages from './i18n/locales/en';

const LOCALE_STORAGE_KEY = 'nodewarden.locale';

type MessageTable = Record<string, string>;

export const AVAILABLE_LOCALES: readonly { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'ru', label: 'Русский' },
  { value: 'es', label: 'Español' },
];

let locale: Locale = resolveInitialLocale();
let activeMessages: MessageTable = enMessages;
const loadedMessages = new Map<Locale, MessageTable>([['en', enMessages]]);

function isLocale(value: unknown): value is Locale {
  return AVAILABLE_LOCALES.some((item) => item.value === value);
}

function resolveInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // ignore storage errors
  }
  if (typeof navigator !== 'undefined') {
    const langs = Array.isArray(navigator.languages) ? navigator.languages : [navigator.language];
    for (const lang of langs) {
      const normalized = String(lang || '').toLowerCase();
      if (normalized === 'zh-tw' || normalized === 'zh-hk' || normalized === 'zh-mo' || normalized.includes('hant')) return 'zh-TW';
      if (normalized.startsWith('zh')) return 'zh-CN';
      if (normalized.startsWith('ru')) return 'ru';
      if (normalized.startsWith('es')) return 'es';
    }
  }
  return 'en';
}

const localeLoaders: Record<Locale, () => Promise<{ default: MessageTable }>> = {
  en: () => Promise.resolve({ default: enMessages }),
  'zh-CN': () => import('./i18n/locales/zh-CN'),
  'zh-TW': () => import('./i18n/locales/zh-TW'),
  ru: () => import('./i18n/locales/ru'),
  es: () => import('./i18n/locales/es'),
};

function localeToHtmlLang(value: Locale): string {
  return value;
}

function syncDocumentLanguage(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = localeToHtmlLang(locale);
}

async function loadLocaleMessages(next: Locale): Promise<MessageTable> {
  const cached = loadedMessages.get(next);
  if (cached) return cached;

  const mod = await localeLoaders[next]();
  loadedMessages.set(next, mod.default);
  return mod.default;
}

async function loadFallbackMessages(): Promise<MessageTable> {
  return enMessages;
}

export type I18nParams = Record<string, string | number | null | undefined>;

export async function initI18n(): Promise<void> {
  try {
    activeMessages = await loadLocaleMessages(locale);
  } catch (error) {
    console.error('Failed to load locale, falling back to English:', error);
    locale = 'en';
    activeMessages = await loadFallbackMessages();
  } finally {
    syncDocumentLanguage();
  }
}

export function t(key: string, params?: I18nParams): string {
  const template = activeMessages[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
}

// Server error messages (returned in API response bodies) mapped to i18n keys.
const SERVER_ERROR_KEYS: Record<string, string> = {
  'Account is disabled': 'txt_server_error_account_disabled',
  'Client IP is required': 'txt_server_error_client_ip_required',
  'ClientId or clientSecret is incorrect. Try again': 'txt_server_error_client_credentials_incorrect',
  'Email already registered': 'txt_server_error_email_already_registered',
  'Email and password are required': 'txt_server_error_email_password_required',
  'Email is required': 'txt_server_error_email_required',
  'Invite code is invalid or expired': 'txt_server_error_invite_invalid_or_expired',
  'Invite code is required': 'txt_server_error_invite_required',
  'Invalid refresh token': 'txt_server_error_invalid_refresh_token',
  'Invalid request payload': 'txt_server_error_invalid_request_payload',
  'JWT_SECRET is not set': 'txt_server_error_jwt_secret_missing',
  'JWT_SECRET is using the default/sample value. Please change it.': 'txt_server_error_jwt_secret_default',
  'JWT_SECRET must be at least 32 characters': 'txt_server_error_jwt_secret_too_short',
  'Parameter error': 'txt_server_error_parameter_error',
  'Refresh token is required': 'txt_server_error_refresh_token_required',
  'Registration is temporarily unavailable, retry once': 'txt_server_error_registration_retry',
  'TOTP token is required': 'txt_server_error_totp_token_required',
  'Two factor required.': 'txt_server_error_two_factor_required',
  'Two-step token is invalid. Try again.': 'txt_server_error_two_factor_invalid',
  'Username or password is incorrect. Try again': 'txt_server_error_username_password_incorrect',
};

// Client-thrown Error messages (from webapp/src/lib/**) mapped to i18n keys, so a
// caught error surfaced in a toast is localized instead of shown in English. The
// interpolated "Import exceeds maximum of N items" message is matched by regex below.
const CLIENT_ERROR_KEYS: Record<string, string> = {
  "Archive item failed": "txt_err_archive_item_failed",
  "Attachment decryption failed": "txt_err_attachment_decryption_failed",
  "Attachment id is required": "txt_err_attachment_id_is_required",
  "Bulk archive failed": "txt_err_bulk_archive_failed",
  "Bulk delete failed": "txt_err_bulk_delete_failed",
  "Bulk delete folders failed": "txt_err_bulk_delete_folders_failed",
  "Bulk delete sends failed": "txt_err_bulk_delete_sends_failed",
  "Bulk move failed": "txt_err_bulk_move_failed",
  "Bulk permanent delete failed": "txt_err_bulk_permanent_delete_failed",
  "Bulk restore failed": "txt_err_bulk_restore_failed",
  "Bulk unarchive failed": "txt_err_bulk_unarchive_failed",
  "Cannot export Ed25519 private key": "txt_err_cannot_export_ed25519_private_key",
  "Cannot export Ed25519 public key": "txt_err_cannot_export_ed25519_public_key",
  "Change master password failed": "txt_err_change_master_password_failed",
  "Cipher id is required": "txt_err_cipher_id_is_required",
  "Create attachment failed": "txt_err_create_attachment_failed",
  "Create file send failed": "txt_err_create_file_send_failed",
  "Create file send failed: missing upload URL": "txt_err_create_file_send_failed_missing_upload_url",
  "Create folder failed": "txt_err_create_folder_failed",
  "Create invite failed": "txt_err_create_invite_failed",
  "Create item failed": "txt_err_create_item_failed",
  "Create send failed": "txt_err_create_send_failed",
  "Current administrator profile is missing a private key": "txt_err_current_administrator_profile_is_missing_a_priva",
  "Current administrator profile is missing an id": "txt_err_current_administrator_profile_is_missing_an_id",
  "Current session is missing unlocked vault keys": "txt_err_current_session_is_missing_unlocked_vault_keys",
  "Delete all invites failed": "txt_err_delete_all_invites_failed",
  "Delete folder failed": "txt_err_delete_folder_failed",
  "Delete item failed": "txt_err_delete_item_failed",
  "Delete user failed": "txt_err_delete_user_failed",
  "Deletion days is required": "txt_err_deletion_days_is_required",
  "Demo mode is not available in this build.": "txt_err_demo_mode_is_not_available_in_this_build",
  "Download attachment failed": "txt_err_download_attachment_failed",
  "Email is required": "txt_err_email_is_required",
  "Encrypted export requires encrypted import flow.": "txt_err_encrypted_export_requires_encrypted_import_flow",
  "Encrypted organization export is not supported yet.": "txt_err_encrypted_organization_export_is_not_supported_y",
  "Failed to clear audit logs": "txt_err_failed_to_clear_audit_logs",
  "Failed to load TOTP status": "txt_err_failed_to_load_totp_status",
  "Failed to load account passkeys": "txt_err_failed_to_load_account_passkeys",
  "Failed to load audit log settings": "txt_err_failed_to_load_audit_log_settings",
  "Failed to load audit logs": "txt_err_failed_to_load_audit_logs",
  "Failed to load invites": "txt_err_failed_to_load_invites",
  "Failed to load profile": "txt_err_failed_to_load_profile",
  "Failed to load revision date": "txt_err_failed_to_load_revision_date",
  "Failed to load sends": "txt_err_failed_to_load_sends",
  "Failed to load users": "txt_err_failed_to_load_users",
  "Failed to load vault": "txt_err_failed_to_load_vault",
  "Failed to save audit log settings": "txt_err_failed_to_save_audit_log_settings",
  "File is required": "txt_err_file_is_required",
  "File password is required": "txt_err_file_password_is_required",
  "Folder id is required": "txt_err_folder_id_is_required",
  "Invalid Bitwarden JSON": "txt_err_invalid_bitwarden_json",
  "Invalid KeePass XML structure": "txt_err_invalid_keepass_xml_structure",
  "Invalid XML file": "txt_err_invalid_xml_file",
  "Invalid attachment download response": "txt_err_invalid_attachment_download_response",
  "Invalid attachment name": "txt_err_invalid_attachment_name",
  "Invalid deletion days": "txt_err_invalid_deletion_days",
  "Invalid encrypted file data": "txt_err_invalid_encrypted_file_data",
  "Invalid expiration days": "txt_err_invalid_expiration_days",
  "Invalid file name": "txt_err_invalid_file_name",
  "Invalid max access count": "txt_err_invalid_max_access_count",
  "Invalid passkey assertion options": "txt_err_invalid_passkey_assertion_options",
  "Invalid passkey creation options": "txt_err_invalid_passkey_creation_options",
  "Invalid profile": "txt_err_invalid_profile",
  "Invalid profile key": "txt_err_invalid_profile_key",
  "Invalid revision date": "txt_err_invalid_revision_date",
  "MAC mismatch": "txt_err_mac_mismatch",
  "Missing MAC for authenticated cipher": "txt_err_missing_mac_for_authenticated_cipher",
  "Missing file URL": "txt_err_missing_file_url",
  "Missing profile key": "txt_err_missing_profile_key",
  "No portable backup settings wrap is available for the current administrator": "txt_err_no_portable_backup_settings_wrap_is_available_fo",
  "Offline unlock is not available on this device.": "txt_err_offline_unlock_is_not_available_on_this_device",
  "Output entropy of hash function is too small": "txt_err_output_entropy_of_hash_function_is_too_small",
  "Permanent delete item failed": "txt_err_permanent_delete_item_failed",
  "Revoke invite failed": "txt_err_revoke_invite_failed",
  "Send key unavailable": "txt_err_send_key_unavailable",
  "Send text is required": "txt_err_send_text_is_required",
  "Unable to import an encrypted Proton Pass export.": "txt_err_unable_to_import_an_encrypted_proton_pass_export",
  "Unable to import an encrypted passky backup.": "txt_err_unable_to_import_an_encrypted_passky_backup",
  "Unarchive item failed": "txt_err_unarchive_item_failed",
  "Unauthorized": "txt_err_unauthorized",
  "Unsupported file encryption type": "txt_err_unsupported_file_encryption_type",
  "Update folder failed": "txt_err_update_folder_failed",
  "Update item failed": "txt_err_update_item_failed",
  "Update send failed": "txt_err_update_send_failed",
  "Update user status failed": "txt_err_update_user_status_failed",
  "Updating file content is not supported yet": "txt_err_updating_file_content_is_not_supported_yet",
  "Vault key unavailable": "txt_err_vault_key_unavailable",
  "invalid encrypted string": "txt_err_invalid_encrypted_string",
  "prelogin failed": "txt_err_prelogin_failed",
  "unsupported enc type": "txt_err_unsupported_enc_type",
};

function lookupErrorKey(message: string): string | null {
  return CLIENT_ERROR_KEYS[message] ?? SERVER_ERROR_KEYS[message] ?? null;
}

function localizeKnownError(message: string): string | null {
  const rateLimitMatch = message.match(/^Rate limit exceeded\. Try again in (\d+) seconds\.$/i);
  if (rateLimitMatch) return t('txt_rate_limit_try_again_seconds', { seconds: rateLimitMatch[1] });
  const importMatch = message.match(/^Import exceeds maximum of (\d+) items$/);
  if (importMatch) return t('txt_err_import_exceeds_max', { count: importMatch[1] });
  const key = lookupErrorKey(message);
  return key ? t(key) : null;
}

// For a server-provided message string (e.g. an API response body's `message`).
// Falls back to `fallback` only when empty; an unmapped message is returned as-is,
// preserving the previous behavior.
export function translateServerError(message: string | null | undefined, fallback: string): string {
  const normalized = String(message || '').trim();
  if (!normalized) return fallback;
  return localizeKnownError(normalized) ?? normalized;
}

// For a caught error/exception. Maps known English messages to localized text;
// already-localized or unknown messages are returned as-is; a non-Error (no
// message) yields the contextual `fallback`.
export function translateError(error: unknown, fallback: string): string {
  const message = (error instanceof Error ? error.message : '').trim();
  if (!message) return fallback;
  return localizeKnownError(message) ?? message;
}

export function getLocale(): Locale {
  return locale;
}

export async function setLocale(next: Locale): Promise<void> {
  let nextMessages: MessageTable;
  try {
    nextMessages = await loadLocaleMessages(next);
  } catch (error) {
    console.error('Failed to load selected locale, falling back to English:', error);
    next = 'en';
    nextMessages = await loadFallbackMessages();
  }
  locale = next;
  activeMessages = nextMessages;
  syncDocumentLanguage();
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // ignore storage errors
  }
}
