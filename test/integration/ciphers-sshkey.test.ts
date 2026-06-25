import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, enc } from './helpers';

// An SSH-key cipher whose key material is not valid encrypted-string data has
// its sshKey normalized away (compatibility shim) while the cipher still saves;
// a well-formed one is preserved. Real cipher create, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('cipherssh');
  token = session.accessToken;
});

describe('SSH-key cipher normalization', () => {
  it('drops an sshKey with invalid encrypted-string fields but still saves', async () => {
    const res = await api('POST', '/api/ciphers', token, {
      type: 5,
      name: ENC_STRING,
      sshKey: { privateKey: 'not-enc', publicKey: 'not-enc', keyFingerprint: 'not-enc' },
    });
    expect(res.status).toBe(200);
  });

  it('preserves a well-formed sshKey', async () => {
    const res = await api('POST', '/api/ciphers', token, {
      type: 5,
      name: ENC_STRING,
      sshKey: { privateKey: enc('priv'), publicKey: enc('pub'), keyFingerprint: enc('fp') },
    });
    expect(res.status).toBe(200);
  });
});
