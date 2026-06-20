import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, login, newAccount, register } from './helpers';

// Admin backup-settings read paths and authorization. The remote upload/restore
// paths hit external WebDAV/S3 and are intentionally out of scope.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('backup');
  token = session.accessToken;
});

describe('admin backup settings', () => {
  it('returns the current (unconfigured) backup settings for an admin', async () => {
    const res = await api('GET', '/api/admin/backup/settings', token);
    expect(res.status).toBe(200);
  });

  it('returns the repair state for an admin', async () => {
    const res = await api('GET', '/api/admin/backup/settings/repair', token);
    expect(res.status).toBe(200);
  });

  it('forbids a non-admin from reading backup settings (403)', async () => {
    const invite = (await (await api('POST', '/api/admin/invites', token, {})).json()) as any;
    const user = newAccount('nonadmin');
    expect((await register(user, invite.code)).status).toBe(200);
    const userToken = ((await (await login(user)).json()) as any).access_token;

    const res = await api('GET', '/api/admin/backup/settings', userToken);
    expect(res.status).toBe(403);
  });
});
