import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, url } from './helpers';

// Additional public send-access branches: malformed JSON bodies are tolerated
// (treated as empty) on text and file access, and a password-protected send
// locks out after repeated wrong-password attempts. Real worker + D1, no mocks.
let session: Session;
let token: string;
let textAccessId: string;
let fileSendId: string;
let fileId: string;
let pwAccessId: string;

const futureDeletion = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

function accessPost(path: string, ip: string, body: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip, Origin: 'https://vault.test', 'Content-Type': 'application/json' },
    body,
  });
}

beforeAll(async () => {
  session = await authenticate('sendspublicextra');
  token = session.accessToken;

  const text = (await (await api('POST', '/api/sends', token, {
    type: 0, name: ENC_STRING, key: ENC_STRING, deletionDate: futureDeletion(),
    text: { text: ENC_STRING, hidden: false },
  })).json()) as any;
  textAccessId = text.accessId;

  const fileReserve = (await (await api('POST', '/api/sends/file/v2', token, {
    type: 1, name: ENC_STRING, key: ENC_STRING, fileLength: 16, deletionDate: futureDeletion(),
    file: { fileName: ENC_STRING, size: 16 },
  })).json()) as any;
  fileSendId = fileReserve.sendResponse.id;
  fileId = new URL(fileReserve.url).pathname.split('/file/')[1];

  const pw = (await (await api('POST', '/api/sends', token, {
    type: 0, name: ENC_STRING, key: ENC_STRING, deletionDate: futureDeletion(),
    text: { text: ENC_STRING, hidden: false }, authType: 1, password: 'super-secret-hash',
  })).json()) as any;
  pwAccessId = pw.accessId;
});

describe('public send access tolerant/lockout branches', () => {
  it('treats a malformed JSON body as empty on text send access', async () => {
    const res = await accessPost(`/api/sends/access/${textAccessId}`, '203.0.113.20', '{bad');
    expect(res.status).toBe(200);
  });

  it('treats a malformed JSON body as empty on file send access', async () => {
    const res = await accessPost(`/api/sends/${fileSendId}/access/file/${fileId}`, '203.0.113.21', '{bad');
    expect(res.status).toBe(200);
  });

  it('locks out a password-protected send after repeated wrong passwords', async () => {
    const ip = '203.0.113.22';
    let last: Response | null = null;
    // Each wrong password records a failed attempt; the send-password lockout
    // (10 attempts) eventually returns 429 before re-checking the password.
    for (let i = 0; i < 12; i++) {
      last = await accessPost(`/api/sends/access/${pwAccessId}`, ip, JSON.stringify({ password: 'wrong' }));
    }
    expect(last!.status).toBe(429);
  });
});
