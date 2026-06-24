import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, enc, url } from './helpers';

// Accessing a password-protected file send through the non-v2 file endpoint:
// wrong passwords are rejected and repeated failures from one client trip the
// per-IP send-password lockout (429). Real file send + R2 + D1 lockout, no mocks.
let session: Session;
let token: string;
let sendId: string;
let fileId: string;

beforeAll(async () => {
  session = await authenticate('sendfilepw');
  token = session.accessToken;
  const bytes = new TextEncoder().encode('secret-file');
  const reserve = (await (await api('POST', '/api/sends/file/v2', token, {
    type: 1, name: enc('file'), key: ENC_STRING, fileLength: bytes.byteLength,
    deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    file: { fileName: enc('doc'), size: bytes.byteLength }, password: 'the-real-password',
  })).json()) as any;
  sendId = reserve.sendResponse.id;
  fileId = new URL(reserve.url).pathname.split('/file/')[1];
  await SELF.fetch(reserve.url, { method: 'POST', headers: baseHeaders(), body: bytes });
});

function accessFile(password: string, ip: string): Promise<Response> {
  return SELF.fetch(url(`/api/sends/${sendId}/access/file/${fileId}`), {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip, Origin: 'https://vault.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

describe('password-protected file send access', () => {
  it('rejects a wrong password', async () => {
    const res = await accessFile('nope', '198.51.111.1');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('locks out after repeated wrong passwords from one client', async () => {
    const ip = '198.51.111.2';
    let last: Response | null = null;
    for (let i = 0; i < 12; i++) {
      last = await accessFile('still-wrong', ip);
    }
    expect(last!.status).toBe(429);
  });
});
