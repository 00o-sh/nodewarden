import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate } from './helpers';

// Endpoints NodeWarden answers with an empty list for client compatibility
// (organizations/collections/policies are not implemented).
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('stubs');
  token = session.accessToken;
});

describe('empty-list compatibility endpoints', () => {
  for (const path of ['/api/collections', '/api/organizations', '/api/policies']) {
    it(`GET ${path} returns an empty list`, async () => {
      const res = await api('GET', path, token);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.object).toBe('list');
      expect(body.data).toEqual([]);
    });
  }
});

describe('account negatives', () => {
  it('rejects verify-password with a wrong hash', async () => {
    const res = await api('POST', '/api/accounts/verify-password', token, { masterPasswordHash: 'wrong' });
    expect(res.status).not.toBe(200);
  });

  it('returns 405 for an unsupported method on the profile route', async () => {
    const res = await api('DELETE', '/api/accounts/profile', token);
    expect(res.status).toBe(405);
  });

  it('blocks the not-implemented account deletion routes (501)', async () => {
    const res = await api('POST', '/api/accounts/delete', token, {});
    expect(res.status).toBe(501);
  });
});
