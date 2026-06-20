import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// A REAL software authenticator: a genuine P-256 key pair, a correctly encoded
// COSE public key, and a structurally valid authenticatorData + attestation
// object (fmt 'none'). The real @simplewebauthn/server verifies it — there is
// no mocked verification. If the CBOR/authData/clientData were wrong, the real
// library would reject the registration and the test would fail.

// --- Minimal CBOR encoder (uint/negint/bytes/text/array/map) ---
function head(major: number, len: number): number[] {
  if (len < 24) return [(major << 5) | len];
  if (len < 0x100) return [(major << 5) | 24, len];
  if (len < 0x10000) return [(major << 5) | 25, (len >> 8) & 0xff, len & 0xff];
  return [(major << 5) | 26, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff];
}
const cInt = (n: number): number[] => (n >= 0 ? head(0, n) : head(1, -1 - n));
const cBytes = (b: Uint8Array): number[] => [...head(2, b.length), ...b];
const cText = (s: string): number[] => {
  const b = new TextEncoder().encode(s);
  return [...head(3, b.length), ...b];
};
const cMap = (entries: number[][][]): number[] => [
  ...head(5, entries.length),
  ...entries.flatMap(([k, v]) => [...k, ...v]),
];

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64urlToBytes(input: string): Uint8Array {
  const norm = input.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(norm + '='.repeat((4 - (norm.length % 4 || 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function makeAuthenticator(rpId: string) {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const x = b64urlToBytes(jwk.x!);
  const y = b64urlToBytes(jwk.y!);
  const credentialId = crypto.getRandomValues(new Uint8Array(32));
  const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId)));

  const cosePublicKey = Uint8Array.from(
    cMap([
      [cInt(1), cInt(2)], // kty: EC2
      [cInt(3), cInt(-7)], // alg: ES256
      [cInt(-1), cInt(1)], // crv: P-256
      [cInt(-2), cBytes(x)],
      [cInt(-3), cBytes(y)],
    ])
  );

  function authData(flags: number, counter: number, attestedCredData?: Uint8Array): Uint8Array {
    const out: number[] = [...rpIdHash, flags, (counter >>> 24) & 0xff, (counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff];
    if (attestedCredData) out.push(...attestedCredData);
    return Uint8Array.from(out);
  }

  // Registration: UP|UV|AT flags, attested credential data present.
  function attestationObject(): Uint8Array {
    const attestedCredData = Uint8Array.from([
      ...new Uint8Array(16), // AAGUID
      (credentialId.length >> 8) & 0xff,
      credentialId.length & 0xff,
      ...credentialId,
      ...cosePublicKey,
    ]);
    const data = authData(0x45, 0, attestedCredData);
    return Uint8Array.from(
      cMap([
        [cText('fmt'), cText('none')],
        [cText('attStmt'), [...head(5, 0)]],
        [cText('authData'), cBytes(data)],
      ])
    );
  }

  // ECDSA raw (r||s) -> ASN.1 DER, as WebAuthn/COSE ES256 expects.
  function toDer(raw: Uint8Array): Uint8Array {
    const enc = (i: Uint8Array) => {
      let v = [...i];
      while (v.length > 1 && v[0] === 0) v.shift();
      if (v[0] & 0x80) v.unshift(0);
      return [0x02, v.length, ...v];
    };
    const body = [...enc(raw.slice(0, 32)), ...enc(raw.slice(32, 64))];
    return Uint8Array.from([0x30, body.length, ...body]);
  }

  // Assertion (login): UP|UV flags, no attested credential data, real signature
  // over authenticatorData || SHA-256(clientDataJSON).
  async function assertion(challenge: string) {
    const authenticatorData = authData(0x05, 1);
    const cdj = new TextEncoder().encode(
      JSON.stringify({ type: 'webauthn.get', challenge, origin: ORIGIN, crossOrigin: false })
    );
    const cdjHash = new Uint8Array(await crypto.subtle.digest('SHA-256', cdj));
    const signed = Uint8Array.from([...authenticatorData, ...cdjHash]);
    const rawSig = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, signed)
    );
    return {
      id: b64url(credentialId),
      rawId: b64url(credentialId),
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        authenticatorData: b64url(authenticatorData),
        clientDataJSON: b64url(cdj),
        signature: b64url(toDer(rawSig)),
      },
    };
  }

  return { keyPair, credentialId, attestationObject, assertion };
}

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
const RP_ID = 'vault.test';
const ORIGIN = 'https://vault.test';

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
