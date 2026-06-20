import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, authenticate, baseHeaders, url } from './helpers';

let session: Session;

beforeAll(async () => {
  session = await authenticate('notify');
});

describe('notifications negotiate', () => {
  it('returns SignalR negotiate metadata for an authenticated client', async () => {
    const res = await SELF.fetch(url('/notifications/hub/negotiate'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${session.accessToken}` }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(typeof body.connectionId).toBe('string');
    expect(Array.isArray(body.availableTransports)).toBe(true);
  });

  it('rejects negotiate without a token (401)', async () => {
    const res = await SELF.fetch(url('/notifications/hub/negotiate'), {
      method: 'POST',
      headers: baseHeaders(),
    });
    expect(res.status).toBe(401);
  });
});
