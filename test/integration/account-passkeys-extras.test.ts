import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate } from './helpers';
import { ORIGIN, RP_ID, b64url, makeAuthenticator } from './webauthn-authenticator';

// Extra account-passkey registration branches using the real software
// authenticator: re-registering an existing credential (409) and the
// invalid-PRF-key-set guard (400, which fires before attestation verification).
// Real @simplewebauthn/server verification, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('passkeyextras');
  token = session.accessToken;
});

async function attestationOptions(): Promise<{ challenge: string; token: string }> {
  const res = await api('POST', '/api/webauthn/attestation-options', token, {
    masterPasswordHash: session.account.masterPasswordHash,
  });
  const body = (await res.json()) as any;
  return { challenge: body.options.challenge, token: body.token };
}

function clientData(challenge: string): string {
  return b64url(new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge, origin: ORIGIN, crossOrigin: false })));
}

async function registerWith(authn: Awaited<ReturnType<typeof makeAuthenticator>>, extra: Record<string, unknown> = {}): Promise<Response> {
  const opts = await attestationOptions();
  return api('POST', '/api/webauthn', token, {
    token: opts.token,
    name: 'Passkey',
    deviceResponse: {
      id: b64url(authn.credentialId),
      rawId: b64url(authn.credentialId),
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: clientData(opts.challenge), attestationObject: b64url(authn.attestationObject()), transports: ['internal'] },
    },
    ...extra,
  });
}

describe('account passkey registration extras', () => {
  it('409s when re-registering an already-registered credential', async () => {
    const authn = await makeAuthenticator(RP_ID);
    expect((await registerWith(authn)).status).toBe(200);
    // Same credential id, fresh challenge -> the credential already exists.
    expect((await registerWith(authn)).status).toBe(409);
  });

  it('400s a registration with an invalid PRF key set', async () => {
    const authn = await makeAuthenticator(RP_ID);
    const res = await registerWith(authn, {
      encryptedUserKey: 'plain', encryptedPublicKey: 'plain', encryptedPrivateKey: 'plain',
    });
    expect(res.status).toBe(400);
  });
});
