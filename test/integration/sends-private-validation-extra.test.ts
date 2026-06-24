import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';

// Further sends-private validation branches: password-auth without a password,
// malformed file-send JSON, an invalid file-send expirationDate, and a public
// file upload presenting an empty token. Real authenticated API, no mocks.
let session: Session;
let token: string;

const futureDeletion = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

beforeAll(async () => {
  session = await authenticate('sendsprivextra');
  token = session.accessToken;
});

describe('sends-private validation', () => {
  it('requires a password when authType is Password', async () => {
    const res = await api('POST', '/api/sends', token, {
      type: 0, name: ENC_STRING, key: ENC_STRING, deletionDate: futureDeletion(),
      text: { text: ENC_STRING, hidden: false }, authType: 1,
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('password is required');
  });

  it('400s a malformed file-send JSON body', async () => {
    const res = await SELF.fetch(url('/api/sends/file/v2'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
      body: '{bad',
    });
    expect(res.status).toBe(400);
  });

  it('400s an invalid file-send expirationDate', async () => {
    const res = await api('POST', '/api/sends/file/v2', token, {
      type: 1, name: ENC_STRING, key: ENC_STRING, fileLength: 8, deletionDate: futureDeletion(),
      expirationDate: 'not-a-date', file: { fileName: ENC_STRING, size: 8 },
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('expirationdate');
  });

  it('401s a public file upload with an empty token', async () => {
    const res = await SELF.fetch(url(`/api/sends/${crypto.randomUUID()}/file/${crypto.randomUUID()}?token=`), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/octet-stream' }),
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(401);
  });
});
