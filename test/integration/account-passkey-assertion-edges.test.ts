import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate } from './helpers';
import { ORIGIN, RP_ID, b64url, makeAuthenticator } from './webauthn-authenticator';

// Assertion-path error branches of the PRF-encryption update, reached with a
// real registered passkey and a real UpdateKeySet token: a structurally invalid
// assertion response is rejected, and replaying an already-consumed assertion
// challenge is rejected. Real @simplewebauthn/server + real authenticator.
let session: Session;
let token: string;
let mph: string;

async function registerPasskey() {
  const opts = (await (await api('POST', '/api/webauthn/attestation-options', token, { masterPasswordHash: mph })).json()) as any;
  const authn = await makeAuthenticator(RP_ID);
  const clientDataJSON = b64url(
    new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge: opts.options.challenge, origin: ORIGIN, crossOrigin: false }))
  );
  const res = await api('POST', '/api/webauthn', token, {
    token: opts.token,
    name: 'PK',
    deviceResponse: {
      id: b64url(authn.credentialId), rawId: b64url(authn.credentialId), type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON, attestationObject: b64url(authn.attestationObject()), transports: ['internal'] },
    },
  });
  expect(res.status).toBe(200);
  return authn;
}

beforeAll(async () => {
  session = await authenticate('pkassertedges');
  token = session.accessToken;
  mph = session.account.masterPasswordHash;
});

describe('PRF-encryption update assertion edges', () => {
  it('rejects a structurally invalid assertion response', async () => {
    await registerPasskey();
    const opts = (await (await api('POST', '/api/webauthn/assertion-options', token, { masterPasswordHash: mph })).json()) as any;
    const res = await api('PUT', '/api/webauthn', token, {
      token: opts.token,
      deviceResponse: { not: 'a-real-assertion' },
      encryptedUserKey: ENC_STRING,
      encryptedPublicKey: ENC_STRING,
      encryptedPrivateKey: ENC_STRING,
    });
    expect(res.status).toBe(400);
  });

  it('rejects replaying an already-consumed assertion challenge', async () => {
    const authn = await registerPasskey();
    const opts = (await (await api('POST', '/api/webauthn/assertion-options', token, { masterPasswordHash: mph })).json()) as any;
    const deviceResponse = await authn.assertion(opts.options.challenge);
    const payload = {
      token: opts.token, deviceResponse,
      encryptedUserKey: ENC_STRING, encryptedPublicKey: ENC_STRING, encryptedPrivateKey: ENC_STRING,
    };
    // First use consumes the challenge.
    expect((await api('PUT', '/api/webauthn', token, payload)).status).toBe(200);
    // Replaying the same token + assertion is rejected.
    expect((await api('PUT', '/api/webauthn', token, payload)).status).toBe(400);
  });
});
