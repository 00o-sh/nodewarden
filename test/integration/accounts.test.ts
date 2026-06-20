import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, freshToken } from './helpers';

let session: Session;
let token: string;
let masterPasswordHash: string;

beforeAll(async () => {
  session = await authenticate('account');
  masterPasswordHash = session.account.masterPasswordHash;
});

// Some account operations (key/api-key changes) rotate the security stamp and
// invalidate prior tokens, so refresh before each test.
beforeEach(async () => {
  token = await freshToken(session.account);
});

describe('profile', () => {
  it('returns the account profile', async () => {
    const res = await api('GET', '/api/accounts/profile', token);
    expect(res.status).toBe(200);
    const profile = (await res.json()) as any;
    expect(profile.object).toBe('profile');
    expect(profile.email).toBe(session.account.email);
  });

  it('updates the master password hint', async () => {
    const res = await api('PUT', '/api/accounts/profile', token, { masterPasswordHint: 'my hint' });
    expect(res.status).toBe(200);
  });

  it('exposes the revision date', async () => {
    const res = await api('GET', '/api/accounts/revision-date', token);
    expect(res.status).toBe(200);
  });
});

describe('password verification', () => {
  it('accepts the correct master password hash', async () => {
    const res = await api('POST', '/api/accounts/verify-password', token, { masterPasswordHash });
    expect(res.status).toBe(200);
  });

  it('toggles verify-devices with a valid secret', async () => {
    const res = await api('POST', '/api/accounts/verify-devices', token, {
      verifyDevices: false,
      secret: masterPasswordHash,
    });
    expect(res.status).toBe(200);
  });

  it('rejects verify-devices with a bad secret (400)', async () => {
    const res = await api('POST', '/api/accounts/verify-devices', token, {
      verifyDevices: true,
      secret: 'wrong',
    });
    expect(res.status).toBe(400);
  });
});

describe('encryption keys', () => {
  it('updates the key set with a valid password', async () => {
    const res = await api('POST', '/api/accounts/keys', token, {
      masterPasswordHash,
      key: ENC_STRING,
      encryptedPrivateKey: ENC_STRING,
      publicKey: 'cHVibGljLWtleQ==',
    });
    expect(res.status).toBe(200);
  });

  it('rejects key update with a bad password (400)', async () => {
    const res = await api('POST', '/api/accounts/keys', token, {
      masterPasswordHash: 'wrong',
      key: ENC_STRING,
    });
    expect(res.status).toBe(400);
  });
});

describe('two-factor / TOTP', () => {
  it('reports TOTP disabled by default', async () => {
    const res = await api('GET', '/api/accounts/totp', token);
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(false);
  });

  it('lists two-factor providers', async () => {
    const res = await api('GET', '/api/two-factor', token);
    expect(res.status).toBe(200);
  });

  it('returns an authenticator setup key for a verified user', async () => {
    const res = await api('POST', '/api/two-factor/get-authenticator', token, {
      secret: masterPasswordHash,
      masterPasswordHash,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // A base32 key the client uses to seed its authenticator.
    expect(typeof body.Key).toBe('string');
    expect(body.Object).toBe('twoFactorAuthenticator');
  });
});

describe('api key', () => {
  it('returns and rotates the API key', async () => {
    const first = await api('POST', '/api/accounts/api-key', token, { masterPasswordHash });
    expect(first.status).toBe(200);
    const firstKey = ((await first.json()) as any).apiKey;
    expect(typeof firstKey).toBe('string');

    const rotated = await api('POST', '/api/accounts/rotate-api-key', token, { masterPasswordHash });
    expect(rotated.status).toBe(200);
  });
});
