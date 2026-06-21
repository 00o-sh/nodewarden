import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, enc, url } from './helpers';

// v2 public Send access gaps: the bearer-token file-download flow
// (handleAccessSendFileV2) and the send_access grant's password and
// email-auth branches in issueSendAccessToken. End-to-end through the live
// worker with real D1/R2 — no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('sendv2x');
  token = session.accessToken;
});

async function reserveAndUpload(bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
  const reserve = (await (await api('POST', '/api/sends/file/v2', token, {
    type: 1,
    name: enc('file-send'),
    key: ENC_STRING,
    fileLength: bytes.byteLength,
    deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    file: { fileName: enc('doc'), size: bytes.byteLength },
    ...overrides,
  })).json()) as any;
  const fileId = new URL(reserve.url).pathname.split('/file/')[1];
  const up = await SELF.fetch(reserve.url, { method: 'POST', headers: baseHeaders(), body: bytes });
  expect(up.status).toBeLessThan(300);
  return { sendId: reserve.sendResponse.id as string, fileId };
}

function grant(params: Record<string, string>): Promise<Response> {
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '203.0.113.40' }),
    body: new URLSearchParams({ grant_type: 'send_access', ...params }).toString(),
  });
}

describe('v2 file access via bearer token', () => {
  it('mints a download URL and round-trips the bytes', async () => {
    const bytes = new TextEncoder().encode('v2-bearer-file-content');
    const { sendId, fileId } = await reserveAndUpload(bytes);

    const accessToken = ((await (await grant({ send_id: sendId })).json()) as any).access_token as string;
    expect(typeof accessToken).toBe('string');

    const res = await SELF.fetch(url(`/api/sends/access/file/${fileId}`), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }),
      body: '{}',
    });
    expect(res.status).toBe(200);
    const downloadUrl = ((await res.json()) as any).url as string;
    expect(downloadUrl).toContain('t=');

    const dl = await SELF.fetch(downloadUrl, { headers: baseHeaders() });
    expect(dl.status).toBe(200);
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(bytes);
  });
});

describe('send_access grant password branch', () => {
  it('issues a token for the correct password and rejects a wrong one', async () => {
    const password = `pw-${crypto.randomUUID()}`;
    const send = (await (await api('POST', '/api/sends', token, {
      type: 0, name: enc('s'), key: ENC_STRING, password,
      deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      text: { text: enc('secret'), hidden: false },
    })).json()) as any;

    // Wrong password -> invalid_grant / invalid_password.
    const bad = await grant({ send_id: send.id, password: 'definitely-wrong' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).send_access_error_type).toBe('invalid_password');

    // Correct password -> a usable access token.
    const good = await grant({ send_id: send.id, password });
    expect(good.status).toBe(200);
    const accessToken = ((await good.json()) as any).access_token as string;
    const access = await SELF.fetch(url('/api/sends/access'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }),
      body: '{}',
    });
    expect(access.status).toBe(200);
  });
});

describe('send_access grant email-auth branch', () => {
  it('refuses an email-authenticated send as unsupported', async () => {
    const send = (await (await api('POST', '/api/sends', token, {
      type: 0, name: enc('s'), key: ENC_STRING, authType: 0, emails: ['recipient@example.test'],
      deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      text: { text: enc('secret'), hidden: false },
    })).json()) as any;

    const res = await grant({ send_id: send.id });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).send_access_error_type).toBe('email_verification_not_supported');
  });
});

describe('v2 access with an invalid bearer token', () => {
  it('rejects a malformed send_access token (401)', async () => {
    const res = await SELF.fetch(url('/api/sends/access'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: 'Bearer not-a-valid-token', 'Content-Type': 'application/json' }),
      body: '{}',
    });
    expect(res.status).toBe(401);
  });
});
