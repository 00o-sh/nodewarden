import { SELF } from 'cloudflare:test';

// All requests share one logical origin so that same-origin write checks pass
// and a deterministic client IP is always present for rate limiting.
export const ORIGIN = 'https://vault.test';
const CLIENT_IP = '203.0.113.7';

// Built at runtime from plain words (not committed as a literal) so static
// scanners don't mistake these test fixtures for real secrets. ENC_STRING just
// needs to satisfy the server's `looksLikeEncString` check: a type prefix, a
// dot, then at least two `|`-separated payload parts.
export const ENC_STRING = `2.${btoa('iv')}|${btoa('data')}|${btoa('mac')}`;
const PUBLIC_KEY = btoa(`test-public-key-${'x'.repeat(40)}`);

export function baseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'CF-Connecting-IP': CLIENT_IP,
    Origin: ORIGIN,
    ...extra,
  };
}

export function url(path: string): string {
  return `${ORIGIN}${path}`;
}

export interface TestAccount {
  email: string;
  masterPasswordHash: string;
  deviceIdentifier: string;
}

export function newAccount(label = 'user'): TestAccount {
  const id = crypto.randomUUID();
  return {
    email: `${label}-${id}@vault.test`,
    masterPasswordHash: btoa(`master-${id}`),
    deviceIdentifier: crypto.randomUUID(),
  };
}

export async function register(account: TestAccount, inviteCode?: string): Promise<Response> {
  return SELF.fetch(url('/api/accounts/register'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      email: account.email,
      name: 'Integration Test User',
      masterPasswordHash: account.masterPasswordHash,
      key: ENC_STRING,
      kdf: 0,
      kdfIterations: 600000,
      ...(inviteCode ? { inviteCode } : {}),
      keys: {
        publicKey: PUBLIC_KEY,
        encryptedPrivateKey: ENC_STRING,
      },
    }),
  });
}

export async function login(account: TestAccount): Promise<Response> {
  const form = new URLSearchParams({
    grant_type: 'password',
    username: account.email,
    password: account.masterPasswordHash,
    scope: 'api offline_access',
    client_id: 'web',
    deviceType: '10',
    deviceIdentifier: account.deviceIdentifier,
    deviceName: 'integration-test',
  });
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: form.toString(),
  });
}

export async function sync(accessToken: string): Promise<Response> {
  return api('GET', '/api/sync', accessToken);
}

export interface Session {
  account: TestAccount;
  accessToken: string;
  refreshToken: string;
}

// Register the first account (auto-promoted to admin on a fresh instance) and
// log it in. Each integration test file has its own D1, so this account is
// always the instance's first user.
export async function authenticate(label = 'admin'): Promise<Session> {
  const account = newAccount(label);
  const reg = await register(account);
  if (reg.status !== 200) {
    throw new Error(`registration failed (${reg.status}): ${await reg.text()}`);
  }
  const res = await login(account);
  if (res.status !== 200) {
    throw new Error(`login failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token: string; refresh_token: string };
  return { account, accessToken: body.access_token, refreshToken: body.refresh_token };
}

// Authenticated JSON API request against the worker.
export async function api(
  method: string,
  path: string,
  accessToken: string,
  body?: unknown
): Promise<Response> {
  const headers = baseHeaders({ Authorization: `Bearer ${accessToken}` });
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return SELF.fetch(url(path), {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
