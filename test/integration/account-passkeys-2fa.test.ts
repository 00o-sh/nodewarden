import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, TestAccount, api, authenticate, baseHeaders, newAccount, url } from './helpers';
import { ORIGIN, RP_ID, b64url, makeAuthenticator } from './webauthn-authenticator';

// Two-factor WebAuthn (passkey-based 2FA) management + login, driven against the
// real @simplewebauthn/server with the real software authenticator. These
// endpoints (get-webauthn status, get-webauthn-challenge, PUT/DELETE
// /api/two-factor/webauthn) and the identity 2FA-assertion path are otherwise
// unexercised. Nothing is mocked: every verification comes from the real library
// and real D1. Passkeys only — no TOTP/YubiKey code is touched here.

let admin: Session;
let userCounter = 0;
const PUBLIC_KEY = btoa(`test-public-key-${'x'.repeat(40)}`);

interface User {
  account: TestAccount;
  token: string;
  mph: string;
  ip: string;
}

// Each user registers + logs in from its own client IP so the shared
// registration/login rate-limit counter (keyed by IP) never trips across the
// many accounts this suite creates.
function userIp(): string {
  userCounter += 1;
  return `198.51.101.${userCounter}`;
}

// Create a fresh (non-admin) user via an admin invite so each describe block
// gets its own passkey budget (the 2FA cap is 5 per user).
async function makeUser(label: string): Promise<User> {
  const invite = (await (await api('POST', '/api/admin/invites', admin.accessToken, {
    masterPasswordHash: admin.account.masterPasswordHash,
  })).json()) as any;
  const account = newAccount(label);
  const ip = userIp();
  const reg = await SELF.fetch(url('/api/accounts/register'), {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip, Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: account.email,
      name: 'Two-Factor Passkey User',
      masterPasswordHash: account.masterPasswordHash,
      key: ENC_STRING,
      kdf: 0,
      kdfIterations: 600000,
      inviteCode: invite.code,
      keys: { publicKey: PUBLIC_KEY, encryptedPrivateKey: ENC_STRING },
    }),
  });
  expect(reg.status).toBe(200);
  const loginRes = await SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip, Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      username: account.email,
      password: account.masterPasswordHash,
      scope: 'api offline_access',
      client_id: 'web',
      deviceType: '10',
      deviceIdentifier: account.deviceIdentifier,
      deviceName: 'twofa-passkey-test',
    }).toString(),
  });
  expect(loginRes.status).toBe(200);
  const token = ((await loginRes.json()) as any).access_token;
  return { account, token, mph: account.masterPasswordHash, ip };
}

function createClientData(challenge: string): string {
  return b64url(
    new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge, origin: ORIGIN, crossOrigin: false }))
  );
}

// Fetch a TwoFactorCreate challenge and register a 2FA passkey with a real
// authenticator. Returns the authenticator so callers can sign later assertions.
async function register2faPasskey(user: User, name?: string): Promise<Awaited<ReturnType<typeof makeAuthenticator>>> {
  const challengeRes = await api('POST', '/api/two-factor/get-webauthn-challenge', user.token, { masterPasswordHash: user.mph });
  expect(challengeRes.status).toBe(200);
  const options = (await challengeRes.json()) as any;
  const authn = await makeAuthenticator(RP_ID);
  const res = await api('PUT', '/api/two-factor/webauthn', user.token, {
    masterPasswordHash: user.mph,
    ...(name ? { name } : {}),
    deviceResponse: {
      id: b64url(authn.credentialId),
      rawId: b64url(authn.credentialId),
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: createClientData(options.challenge), attestationObject: b64url(authn.attestationObject()), transports: ['internal'] },
    },
  });
  if (res.status !== 200) throw new Error(`2fa register failed ${res.status}: ${await res.text()}`);
  return authn;
}

// Password-grant login carrying a 2FA provider/token, from a distinct IP so the
// login lockout counter never trips between tests.
function login2fa(account: TestAccount, provider: string, twoFactorToken: string, ip: string): Promise<Response> {
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip, Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      username: account.email,
      password: account.masterPasswordHash,
      scope: 'api offline_access',
      client_id: 'web',
      deviceType: '10',
      deviceIdentifier: crypto.randomUUID(),
      deviceName: 'twofa-passkey-test',
      twoFactorProvider: provider,
      twoFactorToken,
    }).toString(),
  });
}

beforeAll(async () => {
  admin = await authenticate('acctpk2fa-admin');
});

describe('two-factor webauthn status (get-webauthn)', () => {
  it('400s on a non-JSON payload', async () => {
    const user = await makeUser('tfwa-status-badbody');
    const res = await SELF.fetch(url('/api/two-factor/get-webauthn'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' }),
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('400s with a wrong master password', async () => {
    const user = await makeUser('tfwa-status-badpw');
    const res = await api('POST', '/api/two-factor/get-webauthn', user.token, { masterPasswordHash: 'wrong' });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('user verification failed');
  });

  it('reports disabled before any 2FA passkey is registered', async () => {
    const user = await makeUser('tfwa-status-empty');
    const res = await api('POST', '/api/two-factor/get-webauthn', user.token, { masterPasswordHash: user.mph });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.Enabled).toBe(false);
    expect(body.Object).toBe('twoFactorWebAuthn');
    expect(body.Keys).toEqual([]);
  });

  it('reports enabled and lists keys once a 2FA passkey is registered', async () => {
    const user = await makeUser('tfwa-status-enabled');
    await register2faPasskey(user, 'Yubikey Bio');
    const res = await api('POST', '/api/two-factor/get-webauthn', user.token, { masterPasswordHash: user.mph });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.Enabled).toBe(true);
    expect(body.Keys.length).toBe(1);
    expect(body.Keys[0].Id).toBe(1);
    expect(body.Keys[0].Name).toBe('Yubikey Bio');
    expect(body.Keys[0].Migrated).toBe(false);
  });
});

describe('two-factor webauthn challenge (get-webauthn-challenge)', () => {
  it('400s with a wrong master password', async () => {
    const user = await makeUser('tfwa-chal-badpw');
    const res = await api('POST', '/api/two-factor/get-webauthn-challenge', user.token, { masterPasswordHash: 'nope' });
    expect(res.status).toBe(400);
  });

  it('400s on a non-JSON payload', async () => {
    const user = await makeUser('tfwa-chal-badbody');
    const res = await SELF.fetch(url('/api/two-factor/get-webauthn-challenge'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' }),
      body: '{bad',
    });
    expect(res.status).toBe(400);
  });

  it('returns registration options with a challenge for a verified user', async () => {
    const user = await makeUser('tfwa-chal-ok');
    const res = await api('POST', '/api/two-factor/get-webauthn-challenge', user.token, { masterPasswordHash: user.mph });
    expect(res.status).toBe(200);
    const options = (await res.json()) as any;
    expect(typeof options.challenge).toBe('string');
    expect(options.rp.id).toBe(RP_ID);
  });
});

describe('two-factor webauthn registration (PUT /api/two-factor/webauthn)', () => {
  it('registers a 2FA passkey verified by the real library and enables 2FA', async () => {
    const user = await makeUser('tfwa-reg-ok');
    const authn = await register2faPasskey(user);
    expect(authn).toBeTruthy();

    const status = await api('POST', '/api/two-factor/get-webauthn', user.token, { masterPasswordHash: user.mph });
    expect(((await status.json()) as any).Enabled).toBe(true);
  });

  it('400s with a wrong master password', async () => {
    const user = await makeUser('tfwa-reg-badpw');
    const res = await api('PUT', '/api/two-factor/webauthn', user.token, {
      masterPasswordHash: 'wrong',
      deviceResponse: { id: 'a', rawId: 'a', type: 'public-key', response: { clientDataJSON: 'x', attestationObject: 'y' } },
    });
    expect(res.status).toBe(400);
  });

  it('400s on a non-JSON payload', async () => {
    const user = await makeUser('tfwa-reg-badbody');
    const res = await SELF.fetch(url('/api/two-factor/webauthn'), {
      method: 'PUT',
      headers: baseHeaders({ Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' }),
      body: 'nope',
    });
    expect(res.status).toBe(400);
  });

  it('400s when the registration response is malformed', async () => {
    const user = await makeUser('tfwa-reg-malformed');
    // A valid challenge is fetched, but the deviceResponse lacks attestationObject
    // so normalizeRegistrationResponse rejects it.
    await api('POST', '/api/two-factor/get-webauthn-challenge', user.token, { masterPasswordHash: user.mph });
    const res = await api('PUT', '/api/two-factor/webauthn', user.token, {
      masterPasswordHash: user.mph,
      deviceResponse: { id: 'a', rawId: 'a', type: 'public-key', response: { clientDataJSON: 'x' } },
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid passkey registration response');
  });

  it('400s when the registration challenge was never issued', async () => {
    const user = await makeUser('tfwa-reg-nochallenge');
    // A structurally valid response, but the clientData challenge was never stored
    // as a TwoFactorCreate challenge -> consumeAccountPasskeyChallenge misses.
    const authn = await makeAuthenticator(RP_ID);
    const fakeChallenge = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const res = await api('PUT', '/api/two-factor/webauthn', user.token, {
      masterPasswordHash: user.mph,
      deviceResponse: {
        id: b64url(authn.credentialId),
        rawId: b64url(authn.credentialId),
        type: 'public-key',
        clientExtensionResults: {},
        response: { clientDataJSON: createClientData(fakeChallenge), attestationObject: b64url(authn.attestationObject()), transports: ['internal'] },
      },
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('challenge');
  });

  it('400s when the attestation cannot be verified (wrong rp id)', async () => {
    const user = await makeUser('tfwa-reg-badattest');
    const options = (await (await api('POST', '/api/two-factor/get-webauthn-challenge', user.token, { masterPasswordHash: user.mph })).json()) as any;
    // The authenticator binds its authData to a DIFFERENT rp id, so the stored
    // challenge is consumed but the real verifier rejects the rpIdHash mismatch.
    const authn = await makeAuthenticator('evil.example');
    const res = await api('PUT', '/api/two-factor/webauthn', user.token, {
      masterPasswordHash: user.mph,
      deviceResponse: {
        id: b64url(authn.credentialId),
        rawId: b64url(authn.credentialId),
        type: 'public-key',
        clientExtensionResults: {},
        response: { clientDataJSON: createClientData(options.challenge), attestationObject: b64url(authn.attestationObject()), transports: ['internal'] },
      },
    });
    expect(res.status).toBe(400);
  });

  it('409s when re-registering an already-registered credential', async () => {
    const user = await makeUser('tfwa-reg-dupe');
    const authn = await register2faPasskey(user);
    // Fresh challenge, same credential id -> already registered.
    const options = (await (await api('POST', '/api/two-factor/get-webauthn-challenge', user.token, { masterPasswordHash: user.mph })).json()) as any;
    const res = await api('PUT', '/api/two-factor/webauthn', user.token, {
      masterPasswordHash: user.mph,
      deviceResponse: {
        id: b64url(authn.credentialId),
        rawId: b64url(authn.credentialId),
        type: 'public-key',
        clientExtensionResults: {},
        response: { clientDataJSON: createClientData(options.challenge), attestationObject: b64url(authn.attestationObject()), transports: ['internal'] },
      },
    });
    expect(res.status).toBe(409);
  });
});

describe('two-factor webauthn login (real assertion)', () => {
  it('challenges with the webauthn provider and completes login via a signed assertion', async () => {
    const user = await makeUser('tfwa-login-ok');
    const authn = await register2faPasskey(user);

    // 1. A plain password login now requires a second factor and advertises the
    //    webauthn provider (7) with assertion options (buildTwoFactorPasskeyAssertionOptions).
    const challenge = await login2fa(user.account, '', '', '198.51.100.21');
    expect(challenge.status).toBe(400);
    const body = (await challenge.json()) as any;
    expect(body.TwoFactorProviders).toContain('7');
    const options = body.TwoFactorProviders2['7'];
    expect(typeof options.challenge).toBe('string');

    // 2. Sign the assertion challenge and exchange it for tokens
    //    (assertTwoFactorPasskeyCredential).
    const deviceResponse = await authn.assertion(options.challenge);
    const res = await login2fa(user.account, '7', JSON.stringify(deviceResponse), '198.51.100.22');
    expect(res.status).toBe(200);
    expect(typeof ((await res.json()) as any).access_token).toBe('string');
  });

  it('rejects a forged assertion signature', async () => {
    const user = await makeUser('tfwa-login-forged');
    const authn = await register2faPasskey(user);
    const challenge = await login2fa(user.account, '', '', '198.51.100.31');
    const options = ((await challenge.json()) as any).TwoFactorProviders2['7'];
    const deviceResponse = await authn.assertion(options.challenge);
    deviceResponse.response.signature = deviceResponse.response.signature.slice(0, -4) + 'AAAA';
    const res = await login2fa(user.account, '7', JSON.stringify(deviceResponse), '198.51.100.32');
    expect(res.status).toBe(400);
  });

  it('rejects a non-JSON 2FA webauthn token', async () => {
    const user = await makeUser('tfwa-login-badjson');
    await register2faPasskey(user);
    const res = await login2fa(user.account, '7', 'not-json', '198.51.100.41');
    expect(res.status).toBe(400);
  });
});

describe('two-factor webauthn deletion (DELETE /api/two-factor/webauthn)', () => {
  it('400s with a wrong master password', async () => {
    const user = await makeUser('tfwa-del-badpw');
    await register2faPasskey(user);
    const res = await api('DELETE', '/api/two-factor/webauthn', user.token, { masterPasswordHash: 'wrong', id: 1 });
    expect(res.status).toBe(400);
  });

  it('400s on a non-JSON payload', async () => {
    const user = await makeUser('tfwa-del-badbody');
    const res = await SELF.fetch(url('/api/two-factor/webauthn'), {
      method: 'DELETE',
      headers: baseHeaders({ Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' }),
      body: 'x',
    });
    expect(res.status).toBe(400);
  });

  it('400s on an invalid key id', async () => {
    const user = await makeUser('tfwa-del-badid');
    await register2faPasskey(user);
    const res = await api('DELETE', '/api/two-factor/webauthn', user.token, { masterPasswordHash: user.mph, id: 0 });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid key id');
  });

  it('refuses to delete the only remaining 2FA passkey', async () => {
    const user = await makeUser('tfwa-del-last');
    await register2faPasskey(user);
    const res = await api('DELETE', '/api/two-factor/webauthn', user.token, { masterPasswordHash: user.mph, id: 1 });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('unable to delete');
  });

  it('400s deleting an out-of-range index', async () => {
    const user = await makeUser('tfwa-del-oor');
    await register2faPasskey(user);
    await register2faPasskey(user);
    const res = await api('DELETE', '/api/two-factor/webauthn', user.token, { masterPasswordHash: user.mph, id: 99 });
    expect(res.status).toBe(400);
  });

  it('deletes a 2FA passkey when more than one is registered', async () => {
    const user = await makeUser('tfwa-del-ok');
    await register2faPasskey(user, 'First');
    await register2faPasskey(user, 'Second');
    const before = (await (await api('POST', '/api/two-factor/get-webauthn', user.token, { masterPasswordHash: user.mph })).json()) as any;
    expect(before.Keys.length).toBe(2);

    const res = await api('DELETE', '/api/two-factor/webauthn', user.token, { masterPasswordHash: user.mph, id: 1 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.Keys.length).toBe(1);
    expect(body.Enabled).toBe(true);
  });
});
