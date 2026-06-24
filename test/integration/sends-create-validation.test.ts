import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate } from './helpers';

// Field-validation branches of handleCreateSend (text) and handleCreateFileSendV2,
// exercised through the real authenticated API with genuinely-invalid payloads.
let session: Session;
let token: string;

const futureDeletion = () => new Date(Date.now() + 7 * 86_400_000).toISOString();
const base = () => ({
  type: 0,
  name: ENC_STRING,
  key: ENC_STRING,
  deletionDate: futureDeletion(),
  text: { text: ENC_STRING, hidden: false },
});

beforeAll(async () => {
  session = await authenticate('sendsvalidation');
  token = session.accessToken;
});

async function expect400(body: unknown, fragment: string) {
  const res = await api('POST', '/api/sends', token, body);
  expect(res.status).toBe(400);
  expect((await res.text()).toLowerCase()).toContain(fragment);
}

describe('handleCreateSend validation', () => {
  it('requires a key', async () => {
    const { key, ...rest } = base();
    await expect400(rest, 'key is required');
  });

  it('rejects an unparseable deletionDate', async () => {
    await expect400({ ...base(), deletionDate: 'not-a-date' }, 'invalid deletiondate');
  });

  it('requires send data', async () => {
    const { text, ...rest } = base();
    await expect400({ ...rest, text: null }, 'send data not provided');
  });

  it('rejects an unparseable expirationDate', async () => {
    await expect400({ ...base(), expirationDate: 'not-a-date' }, 'invalid expirationdate');
  });

  it('rejects an invalid authType', async () => {
    await expect400({ ...base(), authType: 7 }, 'invalid authtype');
  });

  it('rejects invalid emails', async () => {
    await expect400({ ...base(), emails: 12345 }, 'invalid emails');
  });
});

describe('handleCreateFileSendV2 validation', () => {
  it('rejects a non-file send type', async () => {
    const res = await api('POST', '/api/sends/file/v2', token, { type: 0, fileLength: 8 });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('not a file');
  });

  it('rejects a file that exceeds the storage limit', async () => {
    const res = await api('POST', '/api/sends/file/v2', token, { type: 1, fileLength: 9_007_199_254_740_000 });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('storage limit exceeded');
  });
});
