import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate } from './helpers';

// Trusted-device management endpoints: revoke-all, revoke-one, and the
// permanent-trust upgrade (which 409s when the device isn't currently trusted).
// Real D1, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('devicestrust');
  token = session.accessToken;
});

describe('trusted device management', () => {
  it('revokes all trusted devices', async () => {
    const res = await api('DELETE', '/api/devices/authorized', token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).success).toBe(true);
  });

  it('revokes a single (untrusted) device without error', async () => {
    const res = await api('DELETE', `/api/devices/authorized/${crypto.randomUUID()}`, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.removed).toBe(0);
  });

  it('409s permanently trusting a device that is not currently trusted', async () => {
    const res = await api('POST', `/api/devices/authorized/${crypto.randomUUID()}/permanent`, token, {});
    expect(res.status).toBe(409);
  });
});
