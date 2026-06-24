import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, randomBase32, totpToken, url } from './helpers';

// TOTP recovery-code retrieval, the standalone recover-2fa endpoint (guards +
// success), and API-key rotation. Real D1 + real TOTP/PBKDF2, no mocks.
let session: Session;
let token: string;
let mph: string;
let recoveryCode: string;

let recoverIpCounter = 0;
function nextIp(): string {
  recoverIpCounter += 1;
  return `198.51.${Math.floor(recoverIpCounter / 254)}.${(recoverIpCounter % 254) + 1}`;
}

function recover2fa(body: Record<string, unknown>, ip = nextIp()): Promise<Response> {
  return SELF.fetch(url('/api/accounts/recover-2fa'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }),
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  session = await authenticate('acctrec');
  token = session.accessToken;
  mph = session.account.masterPasswordHash;

  const secret = randomBase32();
  const enable = await api('POST', '/api/accounts/totp', token, { enabled: true, secret, token: await totpToken(secret), masterPasswordHash: mph });
  expect(enable.status).toBe(200);
  recoveryCode = ((await enable.json()) as any).recoveryCode;
  expect(typeof recoveryCode).toBe('string');
});

describe('TOTP recovery code retrieval', () => {
  it('returns the recovery code for the correct master password', async () => {
    const res = await api('POST', '/api/accounts/totp/recovery-code', token, { masterPasswordHash: mph });
    expect(res.status).toBe(200);
    expect((await res.json() as any).code).toBe(recoveryCode);
  });

  it('rejects a missing or wrong master password', async () => {
    expect((await api('POST', '/api/accounts/totp/recovery-code', token, {})).status).toBe(400);
    expect((await api('POST', '/api/accounts/totp/recovery-code', token, { masterPasswordHash: 'nope' })).status).toBe(400);
  });
});

describe('api key rotation', () => {
  it('rotates the api key when the master password is correct', async () => {
    const before = ((await (await api('POST', '/api/accounts/api-key', token, { masterPasswordHash: mph })).json()) as any).apiKey;
    const rotate = await api('POST', '/api/accounts/rotate-api-key', token, { masterPasswordHash: mph });
    expect(rotate.status).toBe(200);
    const after = ((await (await api('POST', '/api/accounts/api-key', token, { masterPasswordHash: mph })).json()) as any).apiKey;
    expect(after).not.toBe(before);
  });
});

describe('recover-2fa guards', () => {
  it('403s without a client IP', async () => {
    // No CF-Connecting-IP / X-Forwarded-For at all (baseHeaders would inject one).
    const res = await SELF.fetch(url('/api/accounts/recover-2fa'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://vault.test' },
      body: JSON.stringify({ email: session.account.email, masterPasswordHash: mph, recoveryCode }),
    });
    expect(res.status).toBe(403);
  });

  it('400s on missing fields', async () => {
    expect((await recover2fa({ email: session.account.email })).status).toBe(400);
  });

  it('400s for an unknown account', async () => {
    expect((await recover2fa({ email: `ghost-${crypto.randomUUID()}@vault.test`, masterPasswordHash: mph, recoveryCode })).status).toBe(400);
  });

  it('400s for a wrong recovery code', async () => {
    expect((await recover2fa({ email: session.account.email, masterPasswordHash: mph, recoveryCode: 'wrong-code' })).status).toBe(400);
  });
});

describe('recover-2fa success (runs last — disables TOTP and rotates the stamp)', () => {
  it('disables TOTP and returns a new recovery code', async () => {
    const res = await recover2fa({ email: session.account.email, masterPasswordHash: mph, recoveryCode });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.twoFactorEnabled).toBe(false);
    expect(typeof body.newRecoveryCode).toBe('string');
    expect(body.newRecoveryCode).not.toBe(recoveryCode);
  });
});
