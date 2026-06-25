import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate } from './helpers';

// The destinations-array guards in parseDestinations (reached via the settings
// PUT handler's normalizeBackupSettingsInput): a non-array value, a non-object
// entry, exceeding the maximum count, and duplicate ids are each rejected with
// 400. A valid master-password hash is supplied so the request reaches
// validation. Real worker + real D1, no mocks.
let token: string;
let mph: string;

const webdav = () => ({
  type: 'webdav',
  includeAttachments: false,
  destination: { baseUrl: 'https://dav.test', username: 'u', password: 'p', remotePath: 'nodewarden' },
  schedule: { enabled: false, intervalHours: 24, startTime: '03:00', timezone: 'UTC', retentionCount: 30 },
});

beforeAll(async () => {
  const session: Session = await authenticate('bkdestguards');
  token = session.accessToken;
  mph = session.account.masterPasswordHash;
});

function putDestinations(destinations: unknown): Promise<Response> {
  return api('PUT', '/api/admin/backup/settings', token, { masterPasswordHash: mph, destinations });
}

describe('backup destinations array guards', () => {
  it('rejects a non-array destinations value', async () => {
    expect((await putDestinations('not-an-array')).status).toBe(400);
  });

  it('rejects a non-object destination entry', async () => {
    expect((await putDestinations([123])).status).toBe(400);
  });

  it('rejects more than the maximum number of destinations', async () => {
    expect((await putDestinations(Array.from({ length: 25 }, () => webdav()))).status).toBe(400);
  });

  it('rejects duplicate destination ids', async () => {
    expect((await putDestinations([{ ...webdav(), id: 'dup' }, { ...webdav(), id: 'dup' }])).status).toBe(400);
  });
});
