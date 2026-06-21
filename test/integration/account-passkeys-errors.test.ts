import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';
import { ORIGIN, RP_ID, b64url, makeAuthenticator } from './webauthn-authenticator';

// Account-passkey handler error branches not covered by the happy-path
// registration/management suites. Uses the real software authenticator only to
// seed a credential; the assertions themselves drive validation paths.
let session: Session;
let token: string;
let mph: string;

beforeAll(async () => {
  session = await authenticate('acctpk-err');
  token = session.accessToken;
  mph = session.account.masterPasswordHash;
});

async function registerPasskey(): Promise<string> {
  const opts = (await (await api('POST', '/api/webauthn/attestation-options', token, { masterPasswordHash: mph })).json()) as any;
  const authn = await makeAuthenticator(RP_ID);
  const clientDataJSON = b64url(
    new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge: opts.options.challenge, origin: ORIGIN, crossOrigin: false }))
  );
  const res = await api('POST', '/api/webauthn', token, {
    token: opts.token,
    name: 'Err Passkey',
    deviceResponse: {
      id: b64url(authn.credentialId), rawId: b64url(authn.credentialId), type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON, attestationObject: b64url(authn.attestationObject()), transports: ['internal'] },
    },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as any).id as string;
}

describe('attestation-options errors', () => {
  it('400s on a non-JSON payload', async () => {
    const res = await SELF.fetch(url('/api/webauthn/attestation-options'), {
      method: 'POST', headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('400s with a wrong master password', async () => {
    const res = await api('POST', '/api/webauthn/attestation-options', token, { masterPasswordHash: 'wrong-secret' });
    expect(res.status).toBe(400);
  });
});

describe('update-assertion-options errors', () => {
  it('404s for an unknown requested credential id', async () => {
    await registerPasskey();
    const res = await api('POST', '/api/webauthn/assertion-options', token, {
      masterPasswordHash: mph, credentialId: crypto.randomUUID(),
    });
    expect(res.status).toBe(404);
  });
});

describe('create-credential errors', () => {
  it('400s with an invalid challenge token', async () => {
    const res = await api('POST', '/api/webauthn', token, {
      token: 'not-a-valid-token',
      name: 'X',
      deviceResponse: { id: 'a', rawId: 'a', type: 'public-key', response: {} },
    });
    expect(res.status).toBe(400);
  });

  it('400s when the registration response is malformed despite a valid challenge token', async () => {
    const opts = (await (await api('POST', '/api/webauthn/attestation-options', token, { masterPasswordHash: mph })).json()) as any;
    const res = await api('POST', '/api/webauthn', token, {
      token: opts.token,
      name: 'Bad',
      encryptedUserKey: '2.a|b|c', encryptedPublicKey: '4.x', encryptedPrivateKey: '2.d|e|f',
      // Missing attestationObject -> normalizeRegistrationResponse rejects it.
      deviceResponse: { id: 'a', rawId: 'a', type: 'public-key', response: { clientDataJSON: 'x' } },
    });
    expect(res.status).toBe(400);
  });
});

describe('credential listing', () => {
  it('lists the registered account passkeys', async () => {
    const id = await registerPasskey();
    const res = await api('GET', '/api/webauthn', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const list = body.data ?? body.Data ?? body;
    expect(JSON.stringify(list)).toContain(id);
  });
});
