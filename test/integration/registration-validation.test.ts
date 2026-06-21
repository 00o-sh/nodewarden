import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, TestAccount, api, authenticate, baseHeaders, newAccount, url } from './helpers';

// Mirrors the (module-local) public key the helpers' register() uses.
const PUBLIC_KEY = btoa(`test-public-key-${'x'.repeat(40)}`);

// Registration validation branches the happy-path suite misses: invalid email,
// missing/invalid key material, an over-long hint, bad KDF params, and the
// duplicate-email conflict. Real D1, no mocks.
let admin: Session;
let adminToken: string;

beforeAll(async () => {
  admin = await authenticate('regval');
  adminToken = admin.accessToken;
});

// The register endpoint is per-IP rate-limited, so each call uses a unique IP.
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.${Math.floor(ipCounter / 254)}.${(ipCounter % 254) + 1}`;
}

function registerRaw(overrides: Record<string, unknown>, account: TestAccount = newAccount('regval-x')): Promise<Response> {
  return SELF.fetch(url('/api/accounts/register'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/json', 'CF-Connecting-IP': nextIp() }),
    body: JSON.stringify({
      email: account.email,
      name: 'X',
      masterPasswordHash: account.masterPasswordHash,
      key: ENC_STRING,
      kdf: 0,
      kdfIterations: 600000,
      keys: { publicKey: PUBLIC_KEY, encryptedPrivateKey: ENC_STRING },
      ...overrides,
    }),
  });
}

describe('registration validation', () => {
  it('rejects an invalid email', async () => {
    expect((await registerRaw({ email: 'no-at-sign' })).status).toBe(400);
  });

  it('rejects missing public/private key material', async () => {
    expect((await registerRaw({ keys: { publicKey: PUBLIC_KEY } })).status).toBe(400);
    expect((await registerRaw({ keys: { encryptedPrivateKey: ENC_STRING } })).status).toBe(400);
  });

  it('rejects an invalid encrypted key string', async () => {
    expect((await registerRaw({ key: 'not-an-enc-string' })).status).toBe(400);
  });

  it('rejects an invalid encrypted private key string', async () => {
    expect((await registerRaw({ keys: { publicKey: PUBLIC_KEY, encryptedPrivateKey: 'not-enc' } })).status).toBe(400);
  });

  it('rejects an over-long master password hint', async () => {
    expect((await registerRaw({ masterPasswordHint: 'x'.repeat(121) })).status).toBe(400);
  });

  it('rejects invalid KDF parameters', async () => {
    // PBKDF2 below the 100k-iteration minimum.
    expect((await registerRaw({ kdf: 0, kdfIterations: 1000 })).status).toBe(400);
  });

  it('409s registering an already-used email', async () => {
    const invite1 = (await (await api('POST', '/api/admin/invites', adminToken, {})).json()) as any;
    const account = newAccount('regval-dup');
    expect((await registerRaw({ inviteCode: invite1.code }, account)).status).toBe(200);

    // Same email again, with a fresh invite -> conflict.
    const invite2 = (await (await api('POST', '/api/admin/invites', adminToken, {})).json()) as any;
    expect((await registerRaw({ inviteCode: invite2.code }, account)).status).toBe(409);
  });
});
