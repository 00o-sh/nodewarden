import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ENC_STRING, baseHeaders, url } from './helpers';

// Field-validation guards of the registration endpoint. These fire before any
// account is created, so they are exercised directly with bad payloads (no
// fixture user needed). Real D1, no mocks.
let ipCounter = 0;
function register(body: unknown, raw = false): Promise<Response> {
  ipCounter += 1;
  return SELF.fetch(url('/api/accounts/register'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/json', 'CF-Connecting-IP': `198.51.101.${ipCounter}` }),
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

const validKeys = { publicKey: ENC_STRING, encryptedPrivateKey: ENC_STRING };

describe('register validation guards', () => {
  it('400s a malformed JSON body', async () => {
    expect((await register('{bad', true)).status).toBe(400);
  });

  it('400s missing required fields', async () => {
    expect((await register({})).status).toBe(400);
  });

  it('400s an invalid email address', async () => {
    expect((await register({ email: 'notanemail', masterPasswordHash: 'h', key: ENC_STRING, keys: validKeys })).status).toBe(400);
  });

  it('400s missing public/private keys', async () => {
    expect((await register({ email: 'a@example.com', masterPasswordHash: 'h', key: ENC_STRING })).status).toBe(400);
  });

  it('400s a key that is not a valid encrypted string', async () => {
    expect((await register({ email: 'a@example.com', masterPasswordHash: 'h', key: 'plain-key', keys: validKeys })).status).toBe(400);
  });

  it('400s an over-long master password hint', async () => {
    expect((await register({
      email: 'a@example.com', masterPasswordHash: 'h', key: ENC_STRING, keys: validKeys,
      masterPasswordHint: 'x'.repeat(121),
    })).status).toBe(400);
  });

  it('400s invalid Argon2id KDF parameters', async () => {
    expect((await register({
      email: 'a@example.com', masterPasswordHash: 'h', key: ENC_STRING, keys: validKeys,
      kdf: 1, kdfIterations: 1,
    })).status).toBe(400);
  });
});
