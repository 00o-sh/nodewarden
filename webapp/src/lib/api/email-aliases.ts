import { t } from '@/lib/i18n';
import type { AliasApiToken, AliasGeneratorSettings, EmailAlias } from '@/lib/types';
import { parseErrorMessage, parseJson, type AuthedFetch } from './shared';

export interface CreateAliasInput {
  domain?: string;
  format?: string;
  localPart?: string;
  destination?: string;
  description?: string;
}

export async function listEmailAliases(authedFetch: AuthedFetch): Promise<EmailAlias[]> {
  const resp = await authedFetch('/api/email-aliases');
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, t('txt_alias_load_failed')));
  const body = await parseJson<{ data: EmailAlias[] }>(resp);
  return body?.data ?? [];
}

export async function createEmailAlias(authedFetch: AuthedFetch, input: CreateAliasInput): Promise<EmailAlias> {
  const resp = await authedFetch('/api/email-aliases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, t('txt_alias_create_failed')));
  const body = await parseJson<EmailAlias>(resp);
  if (!body) throw new Error(t('txt_alias_create_failed'));
  return body;
}

export async function updateEmailAlias(
  authedFetch: AuthedFetch,
  id: string,
  update: { active?: boolean; description?: string | null }
): Promise<EmailAlias> {
  const resp = await authedFetch(`/api/email-aliases/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, t('txt_alias_update_failed')));
  const body = await parseJson<EmailAlias>(resp);
  if (!body) throw new Error(t('txt_alias_update_failed'));
  return body;
}

export async function deleteEmailAlias(authedFetch: AuthedFetch, id: string): Promise<void> {
  const resp = await authedFetch(`/api/email-aliases/${id}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, t('txt_alias_delete_failed')));
}

export async function listAliasApiTokens(authedFetch: AuthedFetch): Promise<AliasApiToken[]> {
  const resp = await authedFetch('/api/email-aliases/tokens');
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, t('txt_alias_token_load_failed')));
  const body = await parseJson<{ data: AliasApiToken[] }>(resp);
  return body?.data ?? [];
}

// Returns the plaintext token, which is only ever available at creation time.
export async function createAliasApiToken(authedFetch: AuthedFetch, name: string): Promise<{ token: AliasApiToken; secret: string }> {
  const resp = await authedFetch('/api/email-aliases/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, t('txt_alias_token_create_failed')));
  const body = await parseJson<AliasApiToken & { token: string }>(resp);
  if (!body) throw new Error(t('txt_alias_token_create_failed'));
  const { token: secret, ...token } = body;
  return { token: token as AliasApiToken, secret };
}

export async function deleteAliasApiToken(authedFetch: AuthedFetch, id: string): Promise<void> {
  const resp = await authedFetch(`/api/email-aliases/tokens/${id}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, t('txt_alias_token_delete_failed')));
}

export async function getAliasSettings(authedFetch: AuthedFetch): Promise<AliasGeneratorSettings> {
  const resp = await authedFetch('/api/email-aliases/settings');
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, t('txt_alias_settings_load_failed')));
  const body = await parseJson<AliasGeneratorSettings>(resp);
  if (!body) throw new Error(t('txt_alias_settings_load_failed'));
  return body;
}

export async function saveAliasSettings(
  authedFetch: AuthedFetch,
  settings: { enabled: boolean; domains: string[]; defaultDomain: string | null; defaultDestination: string | null; recipients: string[] }
): Promise<AliasGeneratorSettings> {
  const resp = await authedFetch('/api/email-aliases/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, t('txt_alias_settings_save_failed')));
  const body = await parseJson<AliasGeneratorSettings>(resp);
  if (!body) throw new Error(t('txt_alias_settings_save_failed'));
  return body;
}
