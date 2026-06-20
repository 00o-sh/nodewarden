import { SELF } from 'cloudflare:test';

// All requests share one logical origin so that same-origin write checks pass
// and a deterministic client IP is always present for rate limiting.
export const ORIGIN = 'https://vault.test';
const CLIENT_IP = '203.0.113.7';

// Minimal value that satisfies the server's `looksLikeEncString` check
// (a type prefix, a dot, then at least two `|`-separated payload parts).
export const ENC_STRING = '2.aGVsbG8=|d29ybGQ=|bWFj';
const PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA';

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
  return SELF.fetch(url('/api/sync'), {
    method: 'GET',
    headers: baseHeaders({ Authorization: `Bearer ${accessToken}` }),
  });
}
