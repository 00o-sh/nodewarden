import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, login, newAccount, register } from './helpers';
import { ORIGIN, RP_ID, b64url, makeAuthenticator } from './webauthn-authenticator';

// Account passkey *management* against the real @simplewebauthn/server: register
// a credential with the real software authenticator, then drive the
// update-assertion-options, PRF-encryption update (verified by a real signed
// assertion), and delete flows. The create/list/login flows are covered by
// webauthn-register; this fills in the management endpoints.
let session: Session;
let token: string;
let mph: string;

beforeAll(async () => {
  session = await authenticate('acctpk');
  token = session.accessToken;
  mph = session.account.masterPasswordHash;
});

// Register an account passkey via the real attestation flow; returns the
// authenticator (to sign later assertions) and the credential's db id.
async function registerPasskey(authToken: string, masterPasswordHash: string) {
  const opts = (await (await api('POST', '/api/webauthn/attestation-options', authToken, {
    masterPasswordHash,
  })).json()) as any;
  const authn = await makeAuthenticator(RP_ID);
  const clientDataJSON = b64url(
    new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge: opts.options.challenge, origin: ORIGIN, crossOrigin: false }))
  );
  const res = await api('POST', '/api/webauthn', authToken, {
    token: opts.token,
    name: 'Managed Passkey',
    deviceResponse: {
      id: b64url(authn.credentialId),
      rawId: b64url(authn.credentialId),
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON, attestationObject: b64url(authn.attestationObject()), transports: ['internal'] },
    },
  });
  if (res.status !== 200) throw new Error(`register failed ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as any;
  return { authn, id: (body.id ?? body.Id) as string };
}

describe('account passkey update-assertion-options', () => {
  it('returns assertion options for an authenticated user with a passkey', async () => {
    await registerPasskey(token, mph);
    const res = await api('POST', '/api/webauthn/assertion-options', token, { masterPasswordHash: mph });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.options.challenge).toBeTruthy();
    expect(typeof body.token).toBe('string');
  });

  it('rejects assertion options with a wrong master password (400)', async () => {
    const res = await api('POST', '/api/webauthn/assertion-options', token, { masterPasswordHash: 'wrong' });
    expect(res.status).toBe(400);
  });

  it('404s when the account has no passkeys registered', async () => {
    const invite = (await (await api('POST', '/api/admin/invites', token, {})).json()) as any;
    const user = newAccount('acctpk-nopk');
    expect((await register(user, invite.code)).status).toBe(200);
    const userToken = ((await (await login(user)).json()) as any).access_token;

    const res = await api('POST', '/api/webauthn/assertion-options', userToken, { masterPasswordHash: user.masterPasswordHash });
    expect(res.status).toBe(404);
  });
});

describe('account passkey PRF-encryption update (real assertion)', () => {
  it('updates the encrypted key set after a verified assertion', async () => {
    const { authn } = await registerPasskey(token, mph);

    // Get an UpdateKeySet assertion challenge, then sign it for real.
    const opts = (await (await api('POST', '/api/webauthn/assertion-options', token, { masterPasswordHash: mph })).json()) as any;
    const deviceResponse = await authn.assertion(opts.options.challenge);

    const res = await api('PUT', '/api/webauthn', token, {
      token: opts.token,
      deviceResponse,
      encryptedUserKey: ENC_STRING,
      encryptedPublicKey: ENC_STRING,
      encryptedPrivateKey: ENC_STRING,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).success).toBe(true);
  });

  it('rejects an encryption update with an incomplete key set (400)', async () => {
    const res = await api('PUT', '/api/webauthn', token, {
      token: 'irrelevant',
      deviceResponse: {},
      encryptedUserKey: ENC_STRING,
      // missing encryptedPublicKey / encryptedPrivateKey
    });
    expect(res.status).toBe(400);
  });

  it('rejects an encryption update whose assertion cannot be verified (400)', async () => {
    const { authn } = await registerPasskey(token, mph);
    const opts = (await (await api('POST', '/api/webauthn/assertion-options', token, { masterPasswordHash: mph })).json()) as any;
    const deviceResponse = await authn.assertion(opts.options.challenge);
    // Corrupt the signature so the real library rejects it.
    deviceResponse.response.signature = deviceResponse.response.signature.slice(0, -4) + 'AAAA';

    const res = await api('PUT', '/api/webauthn', token, {
      token: opts.token,
      deviceResponse,
      encryptedUserKey: ENC_STRING,
      encryptedPublicKey: ENC_STRING,
      encryptedPrivateKey: ENC_STRING,
    });
    expect(res.status).toBe(400);
  });
});

describe('account passkey delete', () => {
  it('deletes a passkey with the correct master password', async () => {
    const { id } = await registerPasskey(token, mph);

    const del = await api('POST', `/api/webauthn/${id}/delete`, token, { masterPasswordHash: mph });
    expect(del.status).toBe(200);
    expect(((await del.json()) as any).success).toBe(true);

    const list = (await (await api('GET', '/api/webauthn', token)).json()) as any;
    expect(JSON.stringify(list.data)).not.toContain(id);
  });

  it('rejects delete with a wrong master password (400)', async () => {
    const { id } = await registerPasskey(token, mph);
    const res = await api('POST', `/api/webauthn/${id}/delete`, token, { masterPasswordHash: 'wrong' });
    expect(res.status).toBe(400);
  });

  it('404s deleting an unknown passkey id', async () => {
    const res = await api('POST', `/api/webauthn/${crypto.randomUUID()}/delete`, token, { masterPasswordHash: mph });
    expect(res.status).toBe(404);
  });
});
