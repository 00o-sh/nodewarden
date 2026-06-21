import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, randomBase32, url } from './helpers';

// Validation / error branches of the account key, password, and TOTP handlers.
// All of these fail before persisting, so they never rotate the security stamp
// and the token stays valid throughout.
let session: Session;
let token: string;
let mph: string;

beforeAll(async () => {
  session = await authenticate('accterr');
  token = session.accessToken;
  mph = session.account.masterPasswordHash;
});

function rawPost(path: string, body: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body,
  });
}

describe('set keys — error branches', () => {
  it('requires the master password and rejects a wrong one', async () => {
    expect((await api('POST', '/api/accounts/keys', token, { publicKey: 'bmV3' })).status).toBe(400);
    expect((await api('POST', '/api/accounts/keys', token, { masterPasswordHash: btoa('wrong'), key: ENC_STRING })).status).toBe(400);
  });

  it('rejects a non-encrypted private key and invalid JSON', async () => {
    expect((await api('POST', '/api/accounts/keys', token, { masterPasswordHash: mph, encryptedPrivateKey: 'not-enc' })).status).toBe(400);
    expect((await rawPost('/api/accounts/keys', 'not-json')).status).toBe(400);
  });
});

describe('change password — error branches', () => {
  it('requires current and new hashes', async () => {
    expect((await api('POST', '/api/accounts/password', token, { newMasterPasswordHash: 'x' })).status).toBe(400);
    expect((await api('POST', '/api/accounts/password', token, { masterPasswordHash: mph })).status).toBe(400);
  });

  it('rejects non-encrypted new keys and bad KDF params', async () => {
    expect((await api('POST', '/api/accounts/password', token, { masterPasswordHash: mph, newMasterPasswordHash: 'x', newKey: 'not-enc' })).status).toBe(400);
    expect((await api('POST', '/api/accounts/password', token, { masterPasswordHash: mph, newMasterPasswordHash: 'x', newEncryptedPrivateKey: 'not-enc' })).status).toBe(400);
    expect((await api('POST', '/api/accounts/password', token, { masterPasswordHash: mph, newMasterPasswordHash: 'x', kdf: 0, kdfIterations: 1 })).status).toBe(400);
    expect((await rawPost('/api/accounts/password', '{bad')).status).toBe(400);
  });
});

describe('set TOTP status — error branches', () => {
  it('validates the enable payload', async () => {
    expect((await api('POST', '/api/accounts/totp', token, { enabled: true, secret: '!!!', token: '000000' })).status).toBe(400);
    expect((await api('POST', '/api/accounts/totp', token, { enabled: true, secret: randomBase32() })).status).toBe(400);
    expect((await api('POST', '/api/accounts/totp', token, { enabled: 'maybe' })).status).toBe(400);
    expect((await rawPost('/api/accounts/totp', 'nope')).status).toBe(400);
  });
});

describe('TOTP recovery code — error branches', () => {
  it('requires the master password and rejects a wrong one', async () => {
    expect((await api('POST', '/api/accounts/totp/recovery-code', token, {})).status).toBe(400);
    expect((await api('POST', '/api/accounts/totp/recovery-code', token, { masterPasswordHash: btoa('wrong') })).status).toBe(400);
  });
});
