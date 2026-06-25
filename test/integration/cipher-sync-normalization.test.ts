import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, enc } from './helpers';

// cipherToResponse re-normalizes a stored cipher into a Bitwarden-compatible
// shape on every read. The create handler returns that exact formatted response,
// so each case here POSTs a cipher with a specific field shape and asserts the
// normalized output directly. Real worker + real D1, no mocks.
let token: string;

beforeAll(async () => {
  const session: Session = await authenticate('ciphersyncnorm');
  token = session.accessToken;
});

async function createCipher(body: Record<string, unknown>): Promise<any> {
  const res = await api('POST', '/api/ciphers', token, body);
  expect(res.status).toBe(200);
  return res.json();
}

describe('fido2 credential normalization', () => {
  it('keeps a complete credential, drops an incomplete one, and skips non-objects', async () => {
    const required = {
      credentialId: enc('cred'), keyType: enc('kt'), keyAlgorithm: enc('ka'),
      keyCurve: enc('kc'), keyValue: enc('kv'), rpId: enc('rp'),
      counter: enc('ct'), discoverable: enc('disc'),
    };
    const body = await createCipher({
      type: 1, name: ENC_STRING,
      login: {
        username: ENC_STRING, password: ENC_STRING, uris: [],
        fido2Credentials: [
          { ...required, userName: enc('user') }, // complete -> kept
          { ...required, discoverable: undefined }, // missing a required key -> dropped
          'not-an-object', // -> skipped
        ],
      },
    });
    expect(Array.isArray(body.login.fido2Credentials)).toBe(true);
    expect(body.login.fido2Credentials).toHaveLength(1);
    expect(body.login.fido2Credentials[0].credentialId).toBe(enc('cred'));
    expect(body.login.fido2Credentials[0].userName).toBe(enc('user'));
  });

  it('normalizes an empty credential list to null', async () => {
    const body = await createCipher({
      type: 1, name: ENC_STRING,
      login: { username: ENC_STRING, password: ENC_STRING, uris: [], fido2Credentials: [] },
    });
    expect(body.login.fido2Credentials).toBeNull();
  });
});

describe('login uri normalization', () => {
  it('keeps a uri+checksum pair, nulls a missing checksum, and keeps a match-only entry', async () => {
    const body = await createCipher({
      type: 1, name: ENC_STRING,
      login: {
        username: ENC_STRING, password: ENC_STRING,
        uris: [
          { uri: enc('u1'), uriChecksum: enc('c1') }, // kept as-is
          { uri: enc('u2') }, // no checksum -> uriChecksum null
          { match: 3 }, // match-only -> kept
        ],
      },
    });
    const uris = body.login.uris as Array<Record<string, unknown>>;
    expect(uris).toHaveLength(3);
    expect(uris[0]).toMatchObject({ uri: enc('u1'), uriChecksum: enc('c1') });
    expect(uris[1]).toMatchObject({ uri: enc('u2'), uriChecksum: null });
    expect(uris[2]).toMatchObject({ match: 3 });
  });
});

describe('secure note normalization', () => {
  it('echoes a provided secure-note type', async () => {
    const body = await createCipher({ type: 2, name: ENC_STRING, secureNote: { type: 7 } });
    expect(body.secureNote).toEqual({ type: 7 });
  });

  it('defaults a missing secure note to type 0', async () => {
    const body = await createCipher({ type: 2, name: ENC_STRING });
    expect(body.secureNote).toEqual({ type: 0 });
  });
});

describe('ssh-key fingerprint alias', () => {
  it('accepts the legacy "fingerprint" field and exposes it as keyFingerprint', async () => {
    const body = await createCipher({
      type: 5, name: ENC_STRING,
      sshKey: { privateKey: enc('priv'), publicKey: enc('pub'), fingerprint: enc('fp') },
    });
    expect(body.sshKey.keyFingerprint).toBe(enc('fp'));
    expect(body.sshKey.fingerprint).toBe(enc('fp'));
  });
});
