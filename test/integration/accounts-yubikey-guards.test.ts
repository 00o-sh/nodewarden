import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, authenticate, baseHeaders, url } from './helpers';

// Cheap guard branches on the YubiKey settings endpoints that reject a malformed
// JSON body before any verification or storage work. The first-registered
// account is an admin, so the admin-only config endpoint is reachable.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('yubiguard');
  token = session.accessToken;
});

function rawAuthed(method: string, path: string, body: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method,
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body,
  });
}

describe('YubiKey settings endpoints reject malformed JSON', () => {
  it('400s get-yubikey with a broken body', async () => {
    const res = await rawAuthed('POST', '/api/two-factor/get-yubikey', '{not json');
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid json');
  });

  it('400s the yubikey config endpoint with a broken body', async () => {
    const res = await rawAuthed('PUT', '/api/two-factor/yubikey/config', '{not json');
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid json');
  });

  it('400s the yubikey enroll endpoint with a broken body', async () => {
    const res = await rawAuthed('PUT', '/api/two-factor/yubikey', '{not json');
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid json');
  });
});
