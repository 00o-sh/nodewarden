import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, randomBase32, url } from './helpers';

// Validation guards across the account profile, key-replacement, change-password
// and two-factor (authenticator / disable / TOTP) endpoints: malformed bodies,
// missing required fields, unsupported provider types, and failed verification.
// Real D1 + real TOTP secret handling, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('accounts2faguards');
  token = session.accessToken;
});

function raw(method: string, path: string, body: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method,
    headers: baseHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    body,
  });
}

describe('profile / keys / password guards', () => {
  it('400s a malformed profile update', async () => {
    expect((await raw('PUT', '/api/accounts/profile', '{bad')).status).toBe(400);
  });

  it('400s an over-long master password hint', async () => {
    const res = await api('PUT', '/api/accounts/profile', token, { masterPasswordHint: 'x'.repeat(121) });
    expect(res.status).toBe(400);
  });

  it('400s a malformed set-keys body', async () => {
    expect((await raw('POST', '/api/accounts/keys', '{bad')).status).toBe(400);
  });

  it('400s set-keys without a master password hash', async () => {
    expect((await api('POST', '/api/accounts/keys', token, {})).status).toBe(400);
  });

  it('400s a malformed change-password body', async () => {
    expect((await raw('POST', '/api/accounts/password', '{bad')).status).toBe(400);
  });
});

describe('verify-devices guards', () => {
  it('400s a malformed verify-devices body', async () => {
    expect((await raw('PUT', '/api/accounts/verify-devices', '{bad')).status).toBe(400);
  });

  it('400s a non-boolean verifyDevices value', async () => {
    expect((await api('PUT', '/api/accounts/verify-devices', token, { verifyDevices: 'yes' })).status).toBe(400);
  });

  it('400s verify-devices with failed user verification', async () => {
    const res = await api('PUT', '/api/accounts/verify-devices', token, {
      verifyDevices: true,
      masterPasswordHash: 'wrong-hash',
    });
    expect(res.status).toBe(400);
  });
});

describe('two-factor guards', () => {
  it('400s a two-factor authenticator setup missing required fields', async () => {
    const res = await api('PUT', '/api/two-factor/authenticator', token, {});
    expect(res.status).toBe(400);
  });

  it('400s disabling an unsupported two-factor provider', async () => {
    const res = await api('PUT', '/api/two-factor/disable', token, { type: 99 });
    expect(res.status).toBe(400);
  });

  it('400s disabling the authenticator with failed verification', async () => {
    const res = await api('PUT', '/api/two-factor/disable', token, { type: 0, masterPasswordHash: 'wrong-hash' });
    expect(res.status).toBe(400);
  });
});

describe('TOTP enable/disable guards', () => {
  it('400s enabling TOTP with an invalid secret', async () => {
    const res = await api('POST', '/api/accounts/totp', token, { enabled: true, secret: '@@@', token: '000000' });
    expect(res.status).toBe(400);
  });

  it('400s enabling TOTP without a token', async () => {
    const res = await api('POST', '/api/accounts/totp', token, { enabled: true, secret: randomBase32() });
    expect(res.status).toBe(400);
  });

  it('400s disabling TOTP without a master password hash', async () => {
    const res = await api('POST', '/api/accounts/totp', token, { enabled: false });
    expect(res.status).toBe(400);
  });

  it('400s disabling TOTP with a wrong master password hash', async () => {
    const res = await api('POST', '/api/accounts/totp', token, { enabled: false, masterPasswordHash: 'wrong-hash' });
    expect(res.status).toBe(400);
  });
});
