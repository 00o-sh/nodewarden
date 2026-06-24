import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate } from './helpers';

// The admin backup-settings update endpoint (PUT /api/admin/backup/settings):
// persisting normalized WebDAV + S3 destinations through the live worker and
// rejecting an invalid payload. Real D1, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('bksettings');
  token = session.accessToken;
});

const webdavDestination = {
  type: 'webdav',
  destination: { baseUrl: 'https://dav.example', username: 'u', password: 'p', remotePath: 'nodewarden' },
  schedule: { enabled: false, intervalHours: 24, startTime: '03:00', timezone: 'UTC', retentionCount: 30 },
};
const s3Destination = {
  type: 's3',
  destination: { endpoint: 'https://s3.example/', bucket: 'b', accessKeyId: 'ak', secretAccessKey: 'sk', region: 'us-east-1' },
  schedule: { enabled: false, intervalHours: 12, startTime: '6:5', timezone: 'UTC', retentionCount: 7 },
};

describe('admin backup settings update', () => {
  it('persists normalized WebDAV + S3 destinations', async () => {
    const res = await api('PUT', '/api/admin/backup/settings', token, {
      masterPasswordHash: session.account.masterPasswordHash,
      destinations: [webdavDestination, s3Destination],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.destinations).toHaveLength(2);
    expect(body.destinations[0].type).toBe('webdav');
    expect(body.destinations[1].type).toBe('s3');
    // The S3 endpoint trailing slash is trimmed and the start time zero-padded.
    expect(body.destinations[1].destination.endpoint).toBe('https://s3.example');
    expect(body.destinations[1].schedule.startTime).toBe('06:05');

    // GET reflects the persisted settings.
    const persisted = (await (await api('GET', '/api/admin/backup/settings', token)).json()) as any;
    expect(persisted.destinations).toHaveLength(2);
  });

  it('rejects an invalid destination type (400)', async () => {
    const res = await api('PUT', '/api/admin/backup/settings', token, {
      masterPasswordHash: session.account.masterPasswordHash,
      destinations: [{ ...webdavDestination, type: 'ftp' }],
    });
    expect(res.status).toBe(400);
  });

  it('clears destinations on an empty update', async () => {
    const res = await api('PUT', '/api/admin/backup/settings', token, { masterPasswordHash: session.account.masterPasswordHash, destinations: [] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).destinations).toHaveLength(0);
  });
});
