import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, createCipher, enc, sync } from './helpers';

// Ciphers with fully-populated, type-specific fields so the response
// normalization/compatibility paths (login URIs + checksums, fido2 credentials,
// card/identity field sanitization, ssh-key fingerprint aliasing, custom fields)
// actually execute — the existing type tests use empty/minimal payloads.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('cipherrich');
  token = session.accessToken;
});

async function syncCipher(id: string): Promise<any> {
  const body = (await (await sync(token)).json()) as any;
  return body.ciphers.find((c: any) => c.id === id);
}

describe('rich cipher field normalization', () => {
  it('normalizes a login with cipher key, varied URIs, and fido2 credentials', async () => {
    const created = await createCipher(token, {
      key: enc('cipher-key'),
      login: {
        username: enc('user'),
        password: enc('pass'),
        totp: enc('totp'),
        uris: [
          { uri: enc('uri-1'), uriChecksum: enc('checksum-1'), match: null }, // valid checksum -> kept
          { uri: enc('uri-2'), match: 0 }, // uri without checksum -> kept, checksum nulled
          { match: 3 }, // match-only entry -> kept
        ],
        fido2Credentials: [
          {
            credentialId: enc('cid'),
            keyType: enc('kt'),
            keyAlgorithm: enc('ka'),
            keyCurve: enc('kc'),
            keyValue: enc('kv'),
            rpId: enc('rp'),
            counter: enc('cnt'),
            discoverable: enc('disc'),
            userHandle: enc('uh'),
            userName: enc('un'),
            rpName: enc('rpn'),
            userDisplayName: enc('udn'),
          },
          { credentialId: 'incomplete' }, // missing required fields -> dropped
        ],
      },
    });

    const c = await syncCipher(created.id);
    expect(c).toBeTruthy();
    expect(Array.isArray(c.login.uris)).toBe(true);
    expect(c.login.uris.length).toBeGreaterThanOrEqual(3);
    expect(c.login.fido2Credentials.length).toBe(1);
  });

  it('sanitizes all card fields', async () => {
    const created = await createCipher(token, {
      type: 3,
      login: null,
      card: {
        cardholderName: enc('name'),
        brand: enc('Visa'),
        number: enc('4111'),
        expMonth: enc('12'),
        expYear: enc('2030'),
        code: enc('123'),
      },
    });
    const c = await syncCipher(created.id);
    expect(c.card.number).toBe(enc('4111'));
    expect(c.card.code).toBe(enc('123'));
  });

  it('sanitizes all identity fields', async () => {
    const created = await createCipher(token, {
      type: 4,
      login: null,
      identity: {
        title: enc('Mr'), firstName: enc('Jo'), middleName: enc('Q'), lastName: enc('Public'),
        address1: enc('1 St'), address2: enc('Apt 2'), address3: enc('x'), city: enc('Town'),
        state: enc('ST'), postalCode: enc('00000'), country: enc('US'),
      },
    });
    const c = await syncCipher(created.id);
    expect(c.identity.firstName).toBe(enc('Jo'));
    expect(c.identity.country).toBe(enc('US'));
  });

  it('normalizes an ssh key and exposes both fingerprint aliases', async () => {
    const created = await createCipher(token, {
      type: 5,
      login: null,
      sshKey: { privateKey: enc('priv'), publicKey: enc('pub'), keyFingerprint: enc('fp') },
    });
    const c = await syncCipher(created.id);
    expect(c.sshKey.keyFingerprint).toBe(enc('fp'));
    expect(c.sshKey.fingerprint).toBe(enc('fp'));
  });

  it('preserves custom fields and password history', async () => {
    const created = await createCipher(token, {
      fields: [
        { type: 0, name: enc('field-name'), value: enc('field-value') },
        { type: 1, name: enc('hidden'), value: enc('secret') },
      ],
      passwordHistory: [{ password: enc('old-pass'), lastUsedDate: new Date().toISOString() }],
    });
    const c = await syncCipher(created.id);
    expect(Array.isArray(c.fields)).toBe(true);
    expect(c.fields.length).toBe(2);
    expect(Array.isArray(c.passwordHistory)).toBe(true);
  });
});

describe('cipher field compatibility validation', () => {
  it('rejects a non-encrypted cipher name (400)', async () => {
    const res = await api('POST', '/api/ciphers', token, {
      type: 1,
      name: 'plain-text-name',
      login: { username: enc('u'), password: enc('p'), uris: [] },
    });
    expect(res.status).toBe(400);
  });

  it('rejects a non-encrypted login password (400)', async () => {
    const res = await api('POST', '/api/ciphers', token, {
      type: 1,
      name: enc('item'),
      login: { username: enc('u'), password: 'plaintext', uris: [] },
    });
    expect(res.status).toBe(400);
  });
});
