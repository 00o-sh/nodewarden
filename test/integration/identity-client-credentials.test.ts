import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, sync, url } from './helpers';

// The client_credentials (API key) grant: log in with user.<id> + api key.
let session: Session;
let apiKey: string;
let userId: string;

beforeAll(async () => {
  session = await authenticate('apikey');
  const mph = session.account.masterPasswordHash;
  apiKey = ((await (await api('POST', '/api/accounts/api-key', session.accessToken, { masterPasswordHash: mph })).json()) as any).apiKey;
  userId = ((await (await api('GET', '/api/accounts/profile', session.accessToken)).json()) as any).id;
});

function tokenForm(fields: Record<string, string>): Promise<Response> {
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams(fields).toString(),
  });
}

describe('client_credentials grant', () => {
  it('issues an access token for a valid api key', async () => {
    const res = await tokenForm({
      grant_type: 'client_credentials',
      client_id: `user.${userId}`,
      client_secret: apiKey,
      scope: 'api',
      deviceType: '10',
      deviceIdentifier: crypto.randomUUID(),
      deviceName: 'cli',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(typeof body.access_token).toBe('string');
    // The minted token works against an authenticated endpoint.
    expect((await sync(body.access_token)).status).toBe(200);
  });

  it('rejects a wrong api key (400)', async () => {
    const res = await tokenForm({
      grant_type: 'client_credentials',
      client_id: `user.${userId}`,
      client_secret: 'wrong-secret',
      scope: 'api',
      deviceType: '10',
      deviceIdentifier: crypto.randomUUID(),
      deviceName: 'cli',
    });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid scope (400)', async () => {
    const res = await tokenForm({
      grant_type: 'client_credentials',
      client_id: `user.${userId}`,
      client_secret: apiKey,
      scope: 'not-api',
    });
    expect(res.status).toBe(400);
  });
});
