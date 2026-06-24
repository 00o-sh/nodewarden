import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';

// Guard branches of the text-send create endpoint (POST /api/sends): malformed
// JSON, an invalid send type, and the file-type redirect. Real D1, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('sendtextcreate');
  token = session.accessToken;
});

describe('text send create guards', () => {
  it('400s a malformed JSON body', async () => {
    const res = await SELF.fetch(url('/api/sends'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
      body: '{bad',
    });
    expect(res.status).toBe(400);
  });

  it('400s an invalid send type', async () => {
    const res = await api('POST', '/api/sends', token, { type: 99, name: ENC_STRING, key: ENC_STRING });
    expect(res.status).toBe(400);
  });

  it('400s a file-type send (must use file/v2)', async () => {
    const res = await api('POST', '/api/sends', token, {
      type: 1, name: ENC_STRING, key: ENC_STRING,
      deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    expect(res.status).toBe(400);
  });
});
