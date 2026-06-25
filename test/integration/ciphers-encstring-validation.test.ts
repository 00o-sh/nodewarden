import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate } from './helpers';

// validateCipherEncryptedFieldsForCompatibility rejects any encrypted field that
// is longer than its Bitwarden-compatible cap, on both create and update. Each
// case sends an otherwise-valid login cipher with exactly one over-length field,
// so the 400 is attributable to that field. Driven through the real worker and
// real D1, no mocks.
let token: string;
let cipherId: string;

// A structurally valid type-2 EncString (iv|data|mac) whose total length is
// guaranteed to exceed `cap` (the per-field maximum), so optionalEncStringWithin
// returns null and the validator reports the field.
function overLengthEnc(cap: number): string {
  return `2.${btoa('iv')}|${'A'.repeat(cap + 16)}|${btoa('mac')}`;
}

function baseLogin(): Record<string, unknown> {
  return { username: ENC_STRING, password: ENC_STRING, uris: [] as unknown[] };
}

async function expectRejected(res: Response, fragment: string): Promise<void> {
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error?: string };
  expect(body.error).toContain(fragment);
}

beforeAll(async () => {
  const session: Session = await authenticate('cipherencstring');
  token = session.accessToken;
  const created = (await (await api('POST', '/api/ciphers', token, {
    type: 1, name: ENC_STRING, login: baseLogin(),
  })).json()) as { id: string };
  cipherId = created.id;
});

describe('cipher encrypted-field length validation (create)', () => {
  it('rejects an over-length name', async () => {
    const res = await api('POST', '/api/ciphers', token, { type: 1, name: overLengthEnc(1000), login: baseLogin() });
    await expectRejected(res, 'Cipher name must be an encrypted string up to 1000 characters.');
  });

  it('rejects over-length notes', async () => {
    const res = await api('POST', '/api/ciphers', token, { type: 1, name: ENC_STRING, notes: overLengthEnc(10000), login: baseLogin() });
    await expectRejected(res, 'Cipher notes must be an encrypted string up to 10000 characters.');
  });

  it('rejects an over-length login username', async () => {
    const res = await api('POST', '/api/ciphers', token, { type: 1, name: ENC_STRING, login: { ...baseLogin(), username: overLengthEnc(1000) } });
    await expectRejected(res, 'Login username must be an encrypted string up to 1000 characters.');
  });

  it('rejects an over-length login password', async () => {
    const res = await api('POST', '/api/ciphers', token, { type: 1, name: ENC_STRING, login: { ...baseLogin(), password: overLengthEnc(5000) } });
    await expectRejected(res, 'Login password must be an encrypted string up to 5000 characters.');
  });

  it('rejects an over-length login totp', async () => {
    const res = await api('POST', '/api/ciphers', token, { type: 1, name: ENC_STRING, login: { ...baseLogin(), totp: overLengthEnc(1000) } });
    await expectRejected(res, 'Login TOTP must be an encrypted string up to 1000 characters.');
  });

  it('rejects an over-length login uri (scalar)', async () => {
    const res = await api('POST', '/api/ciphers', token, { type: 1, name: ENC_STRING, login: { ...baseLogin(), uri: overLengthEnc(10000) } });
    await expectRejected(res, 'Login URI must be an encrypted string up to 10000 characters.');
  });

  it('rejects an over-length uris[].uri', async () => {
    const res = await api('POST', '/api/ciphers', token, { type: 1, name: ENC_STRING, login: { ...baseLogin(), uris: [{ uri: overLengthEnc(10000) }] } });
    await expectRejected(res, 'Login URI must be an encrypted string up to 10000 characters.');
  });

  it('rejects an over-length uris[].uriChecksum', async () => {
    const res = await api('POST', '/api/ciphers', token, { type: 1, name: ENC_STRING, login: { ...baseLogin(), uris: [{ uri: ENC_STRING, uriChecksum: overLengthEnc(10000) }] } });
    await expectRejected(res, 'Login URI checksum must be an encrypted string up to 10000 characters.');
  });
});

describe('cipher encrypted-field length validation (update)', () => {
  it('rejects an over-length name on update', async () => {
    const res = await api('PUT', `/api/ciphers/${cipherId}`, token, { type: 1, name: overLengthEnc(1000), login: baseLogin() });
    await expectRejected(res, 'Cipher name must be an encrypted string up to 1000 characters.');
  });
});
