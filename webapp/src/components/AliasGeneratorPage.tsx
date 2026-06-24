import { useEffect, useState } from 'preact/hooks';
import { Copy, Plus, RefreshCw, Save, Trash2, Wand2 } from 'lucide-preact';
import LoadingState from '@/components/LoadingState';
import { t } from '@/lib/i18n';
import { translateError } from '@/lib/i18n';
import type { AuthedFetch } from '@/lib/api/shared';
import type { AliasApiToken, AliasGeneratorSettings, EmailAlias } from '@/lib/types';
import {
  createAliasApiToken,
  createEmailAlias,
  deleteAliasApiToken,
  deleteEmailAlias,
  getAliasSettings,
  listAliasApiTokens,
  listEmailAliases,
  saveAliasSettings,
  updateEmailAlias,
} from '@/lib/api/email-aliases';

interface AliasGeneratorPageProps {
  authedFetch: AuthedFetch;
  isAdmin: boolean;
  onNotify: (type: 'success' | 'error' | 'warning', text: string) => void;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export default function AliasGeneratorPage(props: AliasGeneratorPageProps) {
  const { authedFetch, isAdmin, onNotify } = props;
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<AliasGeneratorSettings | null>(null);
  const [aliases, setAliases] = useState<EmailAlias[]>([]);
  const [tokens, setTokens] = useState<AliasApiToken[]>([]);

  const [domain, setDomain] = useState('');
  const [format, setFormat] = useState('random_characters');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);

  const [tokenName, setTokenName] = useState('');
  const [newSecret, setNewSecret] = useState<string | null>(null);

  // Admin settings form state.
  const [formEnabled, setFormEnabled] = useState(false);
  const [formDomains, setFormDomains] = useState('');
  const [formDefaultDomain, setFormDefaultDomain] = useState('');
  const [formDefaultDestination, setFormDefaultDestination] = useState('');
  const [formRecipients, setFormRecipients] = useState('');

  function applySettingsForm(s: AliasGeneratorSettings) {
    setFormEnabled(s.enabled);
    setFormDomains(s.domains.join('\n'));
    setFormDefaultDomain(s.defaultDomain || '');
    setFormDefaultDestination(s.defaultDestination || '');
    setFormRecipients(s.recipients.join('\n'));
  }

  async function refresh() {
    setLoading(true);
    try {
      const s = await getAliasSettings(authedFetch);
      setSettings(s);
      applySettingsForm(s);
      if (!domain && s.defaultDomain) setDomain(s.defaultDomain);
      const [a, tk] = await Promise.all([listEmailAliases(authedFetch), listAliasApiTokens(authedFetch)]);
      setAliases(a);
      setTokens(tk);
    } catch (error) {
      onNotify('error', translateError(error, t('txt_alias_load_failed')));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onGenerate() {
    setBusy(true);
    try {
      const created = await createEmailAlias(authedFetch, {
        domain: domain || undefined,
        format,
        destination: destination || undefined,
      });
      setAliases((prev) => [created, ...prev]);
      const copied = await copyText(created.address);
      onNotify('success', copied ? t('txt_alias_created_copied') : t('txt_alias_created_toast'));
    } catch (error) {
      onNotify('error', translateError(error, t('txt_alias_create_failed')));
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(alias: EmailAlias) {
    try {
      const updated = await updateEmailAlias(authedFetch, alias.id, { active: !alias.active });
      setAliases((prev) => prev.map((a) => (a.id === alias.id ? updated : a)));
    } catch (error) {
      onNotify('error', translateError(error, t('txt_alias_update_failed')));
    }
  }

  async function onDelete(alias: EmailAlias) {
    try {
      await deleteEmailAlias(authedFetch, alias.id);
      setAliases((prev) => prev.filter((a) => a.id !== alias.id));
      onNotify('success', t('txt_alias_deleted_toast'));
    } catch (error) {
      onNotify('error', translateError(error, t('txt_alias_delete_failed')));
    }
  }

  async function onCopyAddress(address: string) {
    onNotify((await copyText(address)) ? 'success' : 'error', t('txt_alias_copied'));
  }

  async function onCreateToken() {
    try {
      const { token, secret } = await createAliasApiToken(authedFetch, tokenName.trim() || t('txt_alias_token_default_name'));
      setTokens((prev) => [token, ...prev]);
      setNewSecret(secret);
      setTokenName('');
    } catch (error) {
      onNotify('error', translateError(error, t('txt_alias_token_create_failed')));
    }
  }

  async function onDeleteToken(id: string) {
    try {
      await deleteAliasApiToken(authedFetch, id);
      setTokens((prev) => prev.filter((tk) => tk.id !== id));
      onNotify('success', t('txt_alias_token_revoked_toast'));
    } catch (error) {
      onNotify('error', translateError(error, t('txt_alias_token_delete_failed')));
    }
  }

  function splitLines(value: string): string[] {
    return value
      .split(/[\n,]/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async function onSaveSettings() {
    setBusy(true);
    try {
      const domains = splitLines(formDomains);
      const saved = await saveAliasSettings(authedFetch, {
        enabled: formEnabled,
        domains,
        defaultDomain: formDefaultDomain.trim() || null,
        defaultDestination: formDefaultDestination.trim() || null,
        recipients: splitLines(formRecipients),
      });
      setSettings(saved);
      applySettingsForm(saved);
      onNotify('success', t('txt_alias_settings_saved_toast'));
    } catch (error) {
      onNotify('error', translateError(error, t('txt_alias_settings_save_failed')));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !settings) {
    return <LoadingState card lines={6} />;
  }

  const enabled = settings?.enabled ?? false;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const recipientChoices = settings?.recipients ?? [];

  return (
    <div className="stack">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>{t('txt_alias_page_title')}</h2>
            <p className="muted">{t('txt_alias_page_subtitle')}</p>
          </div>
          <button type="button" className="btn btn-secondary small" onClick={() => void refresh()}>
            <RefreshCw size={14} className="btn-icon" />
            {t('txt_refresh')}
          </button>
        </div>

        {!enabled ? (
          <p className="muted">{isAdmin ? t('txt_alias_disabled_admin') : t('txt_alias_disabled_notice')}</p>
        ) : (
          <div className="field-grid">
            <label className="field">
              <span>{t('txt_alias_domain')}</span>
              <select className="input" value={domain} onChange={(e) => setDomain((e.target as HTMLSelectElement).value)}>
                {(settings?.domains ?? []).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('txt_alias_format')}</span>
              <select className="input" value={format} onChange={(e) => setFormat((e.target as HTMLSelectElement).value)}>
                <option value="random_characters">{t('txt_alias_format_random_chars')}</option>
                <option value="random_words">{t('txt_alias_format_random_words')}</option>
                <option value="uuid">{t('txt_alias_format_uuid')}</option>
              </select>
            </label>
            {isAdmin && recipientChoices.length > 0 && (
              <label className="field">
                <span>{t('txt_alias_destination')}</span>
                <select className="input" value={destination} onChange={(e) => setDestination((e.target as HTMLSelectElement).value)}>
                  <option value="">{t('txt_alias_destination_default')}</option>
                  {recipientChoices.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="field">
              <span>&nbsp;</span>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onGenerate()}>
                <Wand2 size={14} className="btn-icon" />
                {t('txt_alias_generate')}
              </button>
            </div>
          </div>
        )}
      </section>

      {enabled && (
        <section className="card">
          <h3>{t('txt_alias_your_aliases')}</h3>
          {aliases.length === 0 ? (
            <p className="muted">{t('txt_alias_none')}</p>
          ) : (
            <ul className="alias-list">
              {aliases.map((alias) => (
                <li key={alias.id} className="alias-row">
                  <div className="alias-row-main">
                    <code className="alias-address">{alias.address}</code>
                    {alias.description && <span className="muted alias-desc">{alias.description}</span>}
                    <span className={`badge ${alias.active ? 'badge-success' : 'badge-muted'}`}>
                      {alias.active ? t('txt_alias_active') : t('txt_alias_inactive')}
                    </span>
                  </div>
                  <div className="alias-row-actions">
                    <button type="button" className="btn btn-secondary small" onClick={() => void onCopyAddress(alias.address)}>
                      <Copy size={14} className="btn-icon" />
                      {t('txt_copy')}
                    </button>
                    <button type="button" className="btn btn-secondary small" onClick={() => void onToggle(alias)}>
                      {alias.active ? t('txt_alias_disable') : t('txt_alias_enable')}
                    </button>
                    <button type="button" className="btn btn-danger small" onClick={() => void onDelete(alias)}>
                      <Trash2 size={14} className="btn-icon" />
                      {t('txt_delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card">
        <h3>{t('txt_alias_tokens_title')}</h3>
        <p className="muted">{t('txt_alias_tokens_desc')}</p>
        <div className="field-grid">
          <label className="field field-span-2">
            <span>{t('txt_alias_token_name')}</span>
            <input
              className="input"
              type="text"
              value={tokenName}
              placeholder={t('txt_alias_token_default_name')}
              onInput={(e) => setTokenName((e.target as HTMLInputElement).value)}
            />
          </label>
          <div className="field">
            <span>&nbsp;</span>
            <button type="button" className="btn btn-primary" onClick={() => void onCreateToken()}>
              <Plus size={14} className="btn-icon" />
              {t('txt_create')}
            </button>
          </div>
        </div>

        {newSecret && (
          <div className="alias-secret-notice">
            <p>{t('txt_alias_token_secret_notice')}</p>
            <code className="alias-secret">{newSecret}</code>
            <button type="button" className="btn btn-secondary small" onClick={() => void copyText(newSecret).then((ok) => onNotify(ok ? 'success' : 'error', t('txt_alias_copied')))}>
              <Copy size={14} className="btn-icon" />
              {t('txt_copy')}
            </button>
          </div>
        )}

        {tokens.length > 0 && (
          <ul className="alias-list">
            {tokens.map((tk) => (
              <li key={tk.id} className="alias-row">
                <div className="alias-row-main">
                  <strong>{tk.name}</strong>
                  <span className="muted">
                    {tk.lastUsedAt ? t('txt_alias_token_last_used', { date: new Date(tk.lastUsedAt).toLocaleString() }) : t('txt_alias_token_never_used')}
                  </span>
                </div>
                <button type="button" className="btn btn-danger small" onClick={() => void onDeleteToken(tk.id)}>
                  {t('txt_revoke')}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="alias-setup">
          <h4>{t('txt_alias_client_setup_title')}</h4>
          <p className="muted">{t('txt_alias_client_setup_desc')}</p>
          <ol className="alias-setup-steps">
            <li>{t('txt_alias_setup_step_service')}</li>
            <li>{t('txt_alias_setup_step_url', { url: origin })}</li>
            <li>{t('txt_alias_setup_step_token')}</li>
            <li>{t('txt_alias_setup_step_domain')}</li>
          </ol>
        </div>
      </section>

      {isAdmin && (
        <section className="card">
          <h3>{t('txt_alias_settings_title')}</h3>
          <p className="muted">
            {settings?.cloudflareConfigured ? t('txt_alias_settings_cf_configured') : t('txt_alias_settings_cf_missing')}
          </p>
          <label className="field alias-toggle-field">
            <input type="checkbox" checked={formEnabled} onChange={(e) => setFormEnabled((e.target as HTMLInputElement).checked)} />
            <span>{t('txt_alias_settings_enabled')}</span>
          </label>
          <label className="field">
            <span>{t('txt_alias_settings_domains')}</span>
            <textarea className="input textarea" value={formDomains} onInput={(e) => setFormDomains((e.target as HTMLTextAreaElement).value)} rows={3} />
            <span className="field-help">{t('txt_alias_settings_domains_help')}</span>
          </label>
          <label className="field">
            <span>{t('txt_alias_settings_default_domain')}</span>
            <input className="input" type="text" value={formDefaultDomain} onInput={(e) => setFormDefaultDomain((e.target as HTMLInputElement).value)} />
          </label>
          <label className="field">
            <span>{t('txt_alias_settings_default_destination')}</span>
            <input className="input" type="email" value={formDefaultDestination} onInput={(e) => setFormDefaultDestination((e.target as HTMLInputElement).value)} />
          </label>
          <label className="field">
            <span>{t('txt_alias_settings_recipients')}</span>
            <textarea className="input textarea" value={formRecipients} onInput={(e) => setFormRecipients((e.target as HTMLTextAreaElement).value)} rows={3} />
            <span className="field-help">{t('txt_alias_settings_recipients_help')}</span>
          </label>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onSaveSettings()}>
            <Save size={14} className="btn-icon" />
            {t('txt_save')}
          </button>
        </section>
      )}
    </div>
  );
}
