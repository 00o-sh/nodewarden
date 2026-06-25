import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, authenticate, baseHeaders, url } from './helpers';

// handleClearDeviceToken normalizes the device identifier (rejecting blank ones)
// and clears any stored push token for the user's device. Real D1, no mocks.
let session: Session;

function clearToken(identifier: string): Promise<Response> {
  return SELF.fetch(url(`/api/devices/identifier/${identifier}/clear-token`), {
    method: 'PUT',
    headers: baseHeaders({ Authorization: `Bearer ${session.accessToken}` }),
  });
}

beforeAll(async () => {
  session = await authenticate('devicecleartoken');
});

describe('clear device push token', () => {
  it('clears the token for the login device', async () => {
    const res = await clearToken(session.account.deviceIdentifier);
    expect(res.status).toBe(200);
  });
});
