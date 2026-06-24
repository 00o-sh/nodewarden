import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, authenticate, baseHeaders, url } from './helpers';

// handleUpdateDeviceKeys reads the body via a tolerant JSON reader: a malformed
// body decodes to null rather than failing the request, and the handler then
// proceeds against the (existing) login device. Real worker + D1, no mocks.
let session: Session;

beforeAll(async () => {
  session = await authenticate('devicekeysbody');
});

describe('device keys update with a malformed body', () => {
  it('tolerates a malformed JSON body for the existing login device', async () => {
    const res = await SELF.fetch(url(`/api/devices/identifier/${session.account.deviceIdentifier}/keys`), {
      method: 'PUT',
      headers: baseHeaders({ Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' }),
      body: '{bad',
    });
    // The malformed body is treated as empty; the request resolves (no 5xx).
    expect(res.status).toBeLessThan(500);
  });
});
