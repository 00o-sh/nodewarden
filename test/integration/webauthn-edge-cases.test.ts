import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate } from './helpers';
import { ORIGIN, RP_ID, b64url, makeAuthenticator } from './webauthn-authenticator';

// Edge-case error branches of the account-passkey endpoints, exercised against
// the real @simplewebauthn/server with the real software authenticator: the
// max-passkey cap, a replayed (already-consumed) registration challenge, and the
// PRF-encryption update's token/key-set validation. Nothing fabricated — every
// rejection comes from the real verifier or real validation.
let session: Session;
let token: string;
let mph: string;

async function registerPasskey() {
  const opts = (await (await api('POST', '/api/webauthn/attestation-options', token, { masterPasswordHash: mph })).json()) as any;
  const authn = await makeAuthenticator(RP_ID);
  const clientDataJSON = b64url(
    new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge: opts.options.challenge, origin: ORIGIN, crossOrigin: false }))
  );
  const deviceResponse = {
    id: b64url(authn.credentialId),
    rawId: b64url(authn.credentialId),
    type: 'public-key',
    clientExtensionResults: {},
    response: { clientDataJSON, attestationObject: b64url(authn.attestationObject()), transports: ['internal'] },
  };
  const create = { token: opts.token, name: 'PK', deviceResponse };
  const res = await api('POST', '/api/webauthn', token, create);
  return { res, create };
}

beforeAll(async () => {
  session = await authenticate('webauthnedge');
  token = session.accessToken;
  mph = session.account.masterPasswordHash;
});

describe('account passkey edge cases', () => {
  it('rejects a replayed (already-consumed) registration challenge', async () => {
    const { res, create } = await registerPasskey();
    expect(res.status).toBe(200);
    // Re-submitting the same create payload: the challenge is already consumed.
    const replay = await api('POST', '/api/webauthn', token, create);
    expect(replay.status).toBe(400);
    expect((await replay.text()).toLowerCase()).toContain('challenge');
  });

  it('rejects attestation options once the passkey cap is reached', async () => {
    // One is already registered above; register up to the cap of 5.
    for (let i = 1; i < 5; i++) {
      const { res } = await registerPasskey();
      expect(res.status).toBe(200);
    }
    const res = await api('POST', '/api/webauthn/attestation-options', token, { masterPasswordHash: mph });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('maximum');
  });

  it('rejects a PRF-encryption update with an invalid challenge token', async () => {
    const res = await api('PUT', '/api/webauthn', token, {
      token: 'not-a-valid-token',
      deviceResponse: { id: 'x', rawId: 'x', type: 'public-key', clientExtensionResults: {}, response: {} },
      encryptedUserKey: ENC_STRING,
      encryptedPublicKey: ENC_STRING,
      encryptedPrivateKey: ENC_STRING,
    });
    expect(res.status).toBe(400);
  });

  it('rejects a PRF-encryption update with a malformed key set', async () => {
    const res = await api('PUT', '/api/webauthn', token, {
      token: 'whatever',
      deviceResponse: {},
      encryptedUserKey: 'not-an-enc-string',
      encryptedPublicKey: 'not-an-enc-string',
      encryptedPrivateKey: 'not-an-enc-string',
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('key set');
  });

  it('rejects a PRF-encryption update with a missing key set', async () => {
    const res = await api('PUT', '/api/webauthn', token, {
      token: 'whatever',
      deviceResponse: {},
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('key set');
  });
});
