import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate } from './helpers';

// Drives the per-field validation branches of backup settings normalization
// (timezone, retention, interval, start-time, and the S3/WebDAV destination
// required-field checks). Each malformed destination must be rejected with 400.
// A valid master-password hash is supplied so the request reaches validation.
let session: Session;
let token: string;
let mph: string;

beforeAll(async () => {
  session = await authenticate('bksettingsval');
  token = session.accessToken;
  mph = session.account.masterPasswordHash;
});

const webdav = (over: Record<string, unknown> = {}, schedOver: Record<string, unknown> = {}) => ({
  type: 'webdav',
  includeAttachments: false,
  destination: { baseUrl: 'https://dav.test', username: 'u', password: 'p', remotePath: 'nodewarden', ...over },
  schedule: { enabled: false, intervalHours: 24, startTime: '03:00', timezone: 'UTC', retentionCount: 30, ...schedOver },
});

const s3 = (over: Record<string, unknown> = {}) => ({
  type: 's3',
  includeAttachments: false,
  destination: {
    endpoint: 'https://s3.test',
    bucket: 'b',
    accessKeyId: 'ak',
    secretAccessKey: 'sk',
    region: 'auto',
    addressingStyle: 'path-style',
    ...over,
  },
  schedule: { enabled: false, intervalHours: 12, startTime: '06:00', timezone: 'UTC', retentionCount: 7 },
});

function put(destination: unknown) {
  return api('PUT', '/api/admin/backup/settings', token, { masterPasswordHash: mph, destinations: [destination] });
}

describe('backup settings validation branches', () => {
  it('accepts a well-formed destination (sanity)', async () => {
    expect((await put(webdav())).status).toBe(200);
  });

  it('rejects schedule field violations with 400', async () => {
    expect((await put(webdav({}, { timezone: 'Not/AZone' }))).status).toBe(400);
    expect((await put(webdav({}, { retentionCount: 0 }))).status).toBe(400);
    expect((await put(webdav({}, { retentionCount: 5000 }))).status).toBe(400);
    expect((await put(webdav({}, { retentionCount: 'nope' }))).status).toBe(400);
    expect((await put(webdav({}, { intervalHours: 0 }))).status).toBe(400);
    expect((await put(webdav({}, { intervalHours: 500 }))).status).toBe(400);
    expect((await put(webdav({}, { startTime: '99:99' }))).status).toBe(400);
    expect((await put(webdav({}, { startTime: 'not-a-time' }))).status).toBe(400);
  });

  it('accepts incomplete WebDAV destinations but rejects a malformed base URL', async () => {
    // Incomplete destinations are saved as drafts (allowIncomplete branch).
    expect((await put(webdav({ baseUrl: '' }))).status).toBe(200);
    expect((await put(webdav({ username: '' }))).status).toBe(200);
    expect((await put(webdav({ password: '' }))).status).toBe(200);
    // A non-empty base URL with the wrong scheme is rejected.
    expect((await put(webdav({ baseUrl: 'ftp://dav.test' }))).status).toBe(400);
  });

  it('accepts incomplete S3 destinations but rejects a malformed endpoint', async () => {
    expect((await put(s3({ endpoint: '' }))).status).toBe(200);
    expect((await put(s3({ bucket: '' }))).status).toBe(200);
    expect((await put(s3({ accessKeyId: '' }))).status).toBe(200);
    expect((await put(s3({ secretAccessKey: '' }))).status).toBe(200);
    expect((await put(s3({ endpoint: 'ftp://s3.test' }))).status).toBe(400);
  });
});
