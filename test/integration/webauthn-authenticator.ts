// A REAL software WebAuthn authenticator shared by the passkey test suites: a
// genuine P-256 key pair, a correctly encoded COSE public key, and structurally
// valid authenticatorData + attestation/assertion objects (fmt 'none'). The real
// @simplewebauthn/server verifies everything — nothing here is mocked. If the
// CBOR/authData/clientData/signature were wrong, the library would reject it and
// the tests would fail.
import { ORIGIN } from './helpers';

export const RP_ID = new URL(ORIGIN).host; // 'vault.test'
export { ORIGIN };

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

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
export function b64urlToBytes(input: string): Uint8Array {
  const norm = input.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(norm + '='.repeat((4 - (norm.length % 4 || 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export interface SoftwareAuthenticator {
  keyPair: CryptoKeyPair;
  credentialId: Uint8Array;
  attestationObject(): Uint8Array;
  assertion(challenge: string): Promise<{
    id: string;
    rawId: string;
    type: string;
    clientExtensionResults: Record<string, unknown>;
    response: { authenticatorData: string; clientDataJSON: string; signature: string };
  }>;
}

export async function makeAuthenticator(rpId: string = RP_ID): Promise<SoftwareAuthenticator> {
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

  // Assertion: UP|UV flags, no attested credential data, real signature over
  // authenticatorData || SHA-256(clientDataJSON).
  async function assertion(challenge: string) {
    const authenticatorData = authData(0x05, 1);
    const cdj = new TextEncoder().encode(
      JSON.stringify({ type: 'webauthn.get', challenge, origin: ORIGIN, crossOrigin: false })
    );
    const cdjHash = new Uint8Array(await crypto.subtle.digest('SHA-256', cdj));
    const signed = Uint8Array.from([...authenticatorData, ...cdjHash]);
    const rawSig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, signed));
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
