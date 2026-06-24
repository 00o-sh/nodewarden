import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate } from './helpers';

// Backup destination configuration: normalization, validation, and persistence
// of the settings (the schedule is disabled so no remote I/O ever runs).
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('backupcfg');
  token = session.accessToken;
});

function webdavSettings(overrides: Record<string, unknown> = {}) {
  return {
    masterPasswordHash: session.account.masterPasswordHash,
    destinations: [
      {
        type: 'webdav',
        label: 'My WebDAV',
        destination: {
          baseUrl: 'https://dav.example.test/',
          username: 'dav-user',
          password: `pw-${crypto.randomUUID()}`,
          remotePath: 'nodewarden',
        },
        schedule: { enabled: false, intervalHours: 12, retentionCount: 10 },
        ...overrides,
      },
    ],
  };
}

describe('backup destination settings', () => {
  it('saves and reads back a WebDAV destination', async () => {
    const put = await api('PUT', '/api/admin/backup/settings', token, webdavSettings());
    expect(put.status).toBe(200);
    const saved = (await put.json()) as any;
    expect(saved.destinations[0].type).toBe('webdav');

    const get = await api('GET', '/api/admin/backup/settings', token);
    expect(get.status).toBe(200);
    expect(JSON.stringify(await get.json())).toContain('webdav');
  });

  it('saves an S3 destination', async () => {
    const put = await api('PUT', '/api/admin/backup/settings', token, {
      masterPasswordHash: session.account.masterPasswordHash,
      destinations: [
        {
          type: 's3',
          label: 'My S3',
          destination: {
            endpoint: 'https://s3.example.test',
            bucket: 'backups',
            addressingStyle: 'path-style',
            region: 'auto',
            accessKeyId: 'AKIA-test',
            secretAccessKey: `sk-${crypto.randomUUID()}`,
            rootPath: 'nodewarden',
          },
          schedule: { enabled: false, intervalHours: 24, retentionCount: 30 },
        },
      ],
    });
    expect(put.status).toBe(200);
    expect((await put.json()).destinations[0].type).toBe('s3');
  });

  it('rejects an out-of-range retention count (400)', async () => {
    const res = await api('PUT', '/api/admin/backup/settings', token, webdavSettings({
      schedule: { enabled: false, intervalHours: 12, retentionCount: 99999 },
    }));
    expect(res.status).toBe(400);
  });

  it('rejects an invalid destination type (400)', async () => {
    const res = await api('PUT', '/api/admin/backup/settings', token, {
      masterPasswordHash: session.account.masterPasswordHash,
      destinations: [{ type: 'ftp', destination: {}, schedule: { enabled: false } }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects a non-array destinations payload (400)', async () => {
    const res = await api('PUT', '/api/admin/backup/settings', token, { masterPasswordHash: session.account.masterPasswordHash, destinations: 'nope' });
    expect(res.status).toBe(400);
  });

  it('forbids a non-admin from updating settings (403)', async () => {
    const { newAccount, register, login } = await import('./helpers');
    const invite = (await (await api('POST', '/api/admin/invites', token, {})).json()) as any;
    const user = newAccount('cfgnonadmin');
    expect((await register(user, invite.code)).status).toBe(200);
    const userToken = ((await (await login(user)).json()) as any).access_token;
    expect((await api('PUT', '/api/admin/backup/settings', userToken, webdavSettings())).status).toBe(403);
  });
});
