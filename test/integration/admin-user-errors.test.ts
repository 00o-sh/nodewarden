import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, createCipher, enc, login, newAccount, register, url } from './helpers';

// Admin user-management error/edge branches, including the R2 blob-cleanup
// loops that run when a deleted user owns attachments and file sends.
let admin: Session;
let adminToken: string;
let adminId: string;

beforeAll(async () => {
  admin = await authenticate('adminerr');
  adminToken = admin.accessToken;
  adminId = ((await (await api('GET', '/api/accounts/profile', adminToken)).json()) as any).id ?? ((await (await api('GET', '/api/accounts/profile', adminToken)).json()) as any).Id;
});

async function makeUser(label: string): Promise<{ token: string; id: string }> {
  const invite = (await (await api('POST', '/api/admin/invites', adminToken, {})).json()) as any;
  const account = newAccount(label);
  expect((await register(account, invite.code)).status).toBe(200);
  const token = ((await (await login(account)).json()) as any).access_token;
  const profile = (await (await api('GET', '/api/accounts/profile', token)).json()) as any;
  return { token, id: profile.id ?? profile.Id };
}

describe('admin set user status — error branches', () => {
  it('rejects an invalid status, invalid JSON, and an unknown user', async () => {
    const { id } = await makeUser('adminerr-status');
    expect((await api('PUT', `/api/admin/users/${id}/status`, adminToken, { status: 'weird' })).status).toBe(400);

    const badJson = await SELF.fetch(url(`/api/admin/users/${id}/status`), {
      method: 'PUT',
      headers: baseHeaders({ Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }),
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);

    expect((await api('PUT', `/api/admin/users/${crypto.randomUUID()}/status`, adminToken, { status: 'banned' })).status).toBe(404);
  });

  it('forbids a non-admin from changing user status (403)', async () => {
    const { token, id } = await makeUser('adminerr-status-na');
    expect((await api('PUT', `/api/admin/users/${id}/status`, token, { status: 'banned' })).status).toBe(403);
  });
});

describe('admin delete user — error branches and blob cleanup', () => {
  it('deletes a user who owns an attachment and a file send (R2 cleanup runs)', async () => {
    const { token, id } = await makeUser('adminerr-del');

    // A cipher with an uploaded attachment.
    const cipher = await createCipher(token);
    const attachBytes = new TextEncoder().encode('owned-attachment');
    const reserve = await api('POST', `/api/ciphers/${cipher.id}/attachment/v2`, token, {
      fileName: ENC_STRING, key: ENC_STRING, fileSize: attachBytes.byteLength,
    });
    const { url: uploadUrl } = (await reserve.json()) as any;
    expect((await SELF.fetch(uploadUrl, { method: 'POST', headers: baseHeaders({ Authorization: `Bearer ${token}` }), body: attachBytes })).status).toBe(201);

    // A file send with uploaded bytes.
    const sendBytes = new TextEncoder().encode('owned-send-file');
    const fileReserve = (await (await api('POST', '/api/sends/file/v2', token, {
      type: 1, name: enc('s'), key: ENC_STRING,
      deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      fileLength: sendBytes.byteLength, file: { fileName: enc('doc'), size: sendBytes.byteLength },
    })).json()) as any;
    expect((await SELF.fetch(fileReserve.url, { method: 'POST', headers: baseHeaders(), body: sendBytes })).status).toBeLessThan(300);

    // Admin deletes the user; the handler cleans up both R2 blobs.
    const del = await api('DELETE', `/api/admin/users/${id}`, adminToken);
    expect(del.status).toBe(204);

    // The user is gone from the admin listing.
    const users = (await (await api('GET', '/api/admin/users', adminToken)).json()) as any;
    expect(JSON.stringify(users.data)).not.toContain(id);
  });

  it('rejects self-deletion, an unknown user, and a non-admin caller', async () => {
    expect((await api('DELETE', `/api/admin/users/${adminId}`, adminToken)).status).toBe(400);
    expect((await api('DELETE', `/api/admin/users/${crypto.randomUUID()}`, adminToken)).status).toBe(404);

    const { token, id } = await makeUser('adminerr-del-na');
    expect((await api('DELETE', `/api/admin/users/${id}`, token)).status).toBe(403);
  });
});
