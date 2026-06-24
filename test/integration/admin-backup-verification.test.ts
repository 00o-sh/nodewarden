import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// The admin backup endpoints all gate on a master-password (or passkey)
// verification step added upstream. A present-but-wrong masterPasswordHash must
// be rejected with 400 "Invalid password" by every endpoint, before any backup
// work happens. Real auth + D1 verification (auth.verifyPassword), no mocks.
let session: Session;
let token: string;

const wrong = { masterPasswordHash: 'definitely-the-wrong-password' };

beforeAll(async () => {
  session = await authenticate('adminbackupverify');
  token = session.accessToken;
});

describe('admin backup endpoints reject a wrong master password', () => {
  it('400s settings update', async () => {
    const res = await api('PUT', '/api/admin/backup/settings', token, { destinations: [], ...wrong });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid password');
  });

  it('400s settings repair', async () => {
    const res = await api('POST', '/api/admin/backup/settings/repair', token, { destinations: [], ...wrong });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid password');
  });

  it('400s a configured run', async () => {
    const res = await api('POST', '/api/admin/backup/run', token, { ...wrong });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid password');
  });

  it('400s a local export', async () => {
    const res = await api('POST', '/api/admin/backup/export', token, { includeAttachments: false, ...wrong });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid password');
  });

  it('400s a remote restore', async () => {
    const res = await api('POST', '/api/admin/backup/remote/restore', token, { path: 'nodewarden_backup.zip', ...wrong });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid password');
  });

  it('400s a local import', async () => {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'application/zip' }), 'backup.zip');
    form.set('masterPasswordHash', wrong.masterPasswordHash);
    const res = await SELF.fetch(url('/api/admin/backup/import'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}` }),
      body: form,
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid password');
  });
});
