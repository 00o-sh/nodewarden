import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';
import { ORIGIN, RP_ID, b64url, makeAuthenticator } from './webauthn-authenticator';

// These suites drive the real software authenticator from
// ./webauthn-authenticator against the real @simplewebauthn/server — no mocked
// verification. If the CBOR/authData/clientData/signature were wrong, the
// library would reject it and the tests would fail.

async function registerPasskey(token: string, account: Session['account']) {
  const opts = (await (await api('POST', '/api/webauthn/attestation-options', token, {
    masterPasswordHash: account.masterPasswordHash,
  })).json()) as any;
  const authn = await makeAuthenticator(RP_ID);
  const clientDataJSON = b64url(
    new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge: opts.options.challenge, origin: ORIGIN, crossOrigin: false }))
  );
  const res = await api('POST', '/api/webauthn', token, {
    token: opts.token,
    name: 'Login Passkey',
    deviceResponse: {
      id: b64url(authn.credentialId),
      rawId: b64url(authn.credentialId),
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON, attestationObject: b64url(authn.attestationObject()), transports: ['internal'] },
    },
  });
  if (res.status !== 200) throw new Error(`register failed ${res.status}: ${await res.text()}`);
  return authn;
}

let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('webauthn');
  token = session.accessToken;
});

describe('WebAuthn passkey registration (real authenticator)', () => {
  it('registers a passkey verified by the real @simplewebauthn/server', async () => {
    // 1. Ask the server for attestation options (returns a challenge + token).
    const optsRes = await api('POST', '/api/webauthn/attestation-options', token, {
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(optsRes.status).toBe(200);
    const { options, token: challengeToken } = (await optsRes.json()) as any;
    const challenge: string = options.challenge;

    // 2. Build a REAL registration response with a genuine key + COSE/CBOR.
    const authn = await makeAuthenticator(RP_ID);
    const clientDataJSON = b64url(
      new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge, origin: ORIGIN, crossOrigin: false }))
    );
    const deviceResponse = {
      id: b64url(authn.credentialId),
      rawId: b64url(authn.credentialId),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON,
        attestationObject: b64url(authn.attestationObject()),
        transports: ['internal'],
      },
    };

    // 3. Submit it; the real library verifies the attestation.
    const createRes = await api('POST', '/api/webauthn', token, {
      token: challengeToken,
      name: 'Test Passkey',
      deviceResponse,
    });
    expect(createRes.status).toBe(200);

    // 4. The credential is now listed for the account.
    const list = await api('GET', '/api/webauthn', token);
    expect(list.status).toBe(200);
    expect(JSON.stringify(await list.json())).toContain('Test Passkey');
  });

  it('rejects a registration whose clientData challenge does not match (400)', async () => {
    const optsRes = await api('POST', '/api/webauthn/attestation-options', token, {
      masterPasswordHash: session.account.masterPasswordHash,
    });
    const { token: challengeToken } = (await optsRes.json()) as any;

    const authn = await makeAuthenticator(RP_ID);
    const clientDataJSON = b64url(
      new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge: b64url(crypto.getRandomValues(new Uint8Array(32))), origin: ORIGIN, crossOrigin: false }))
    );
    const createRes = await api('POST', '/api/webauthn', token, {
      token: challengeToken,
      name: 'Bad Passkey',
      deviceResponse: {
        id: b64url(authn.credentialId),
        rawId: b64url(authn.credentialId),
        type: 'public-key',
        clientExtensionResults: {},
        response: { clientDataJSON, attestationObject: b64url(authn.attestationObject()), transports: ['internal'] },
      },
    });
    expect(createRes.status).toBe(400);
  });

  it('rejects passkey setup with a wrong master password (400)', async () => {
    const res = await api('POST', '/api/webauthn/attestation-options', token, { masterPasswordHash: 'wrong' });
    expect(res.status).toBe(400);
  });
});

describe('WebAuthn passkey login (real assertion signature)', () => {
  it('logs in via the webauthn grant with a real signed assertion', async () => {
    const authn = await registerPasskey(token, session.account);

    // 1. Get a login assertion challenge (public endpoint).
    const optsRes = await SELF.fetch(url('/identity/accounts/webauthn/assertion-options'), {
      method: 'GET',
      headers: baseHeaders(),
    });
    expect(optsRes.status).toBe(200);
    const { options, token: challengeToken } = (await optsRes.json()) as any;

    // 2. Sign a real assertion with the authenticator's private key.
    const deviceResponse = await authn.assertion(options.challenge);

    // 3. Exchange it for tokens via the webauthn grant.
    const grant = await SELF.fetch(url('/identity/connect/token'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({
        grant_type: 'webauthn',
        token: challengeToken,
        deviceResponse: JSON.stringify(deviceResponse),
        deviceType: '10',
        deviceIdentifier: crypto.randomUUID(),
        deviceName: 'passkey-test',
      }).toString(),
    });
    expect(grant.status).toBe(200);
    expect(typeof ((await grant.json()) as any).access_token).toBe('string');
  });

  it('rejects an assertion with a forged signature (400)', async () => {
    await registerPasskey(token, session.account);
    const optsRes = await SELF.fetch(url('/identity/accounts/webauthn/assertion-options'), { headers: baseHeaders() });
    const { options, token: challengeToken } = (await optsRes.json()) as any;
    const authn = await makeAuthenticator(RP_ID);
    const deviceResponse = await authn.assertion(options.challenge);
    // Corrupt the signature.
    deviceResponse.response.signature = deviceResponse.response.signature.slice(0, -4) + 'AAAA';
    const grant = await SELF.fetch(url('/identity/connect/token'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({
        grant_type: 'webauthn',
        token: challengeToken,
        deviceResponse: JSON.stringify(deviceResponse),
        deviceType: '10',
        deviceIdentifier: crypto.randomUUID(),
        deviceName: 'passkey-test',
      }).toString(),
    });
    expect(grant.status).not.toBe(200);
  });
});
