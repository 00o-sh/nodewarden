import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, login, newAccount, register, url } from './helpers';

// A disabled (banned) account cannot authenticate: the client_credentials grant
// short-circuits with "Account is disabled" once the user is looked up, before
// the secret is even checked. Real admin ban + D1, no mocks.
let admin: Session;
let memberId: string;

beforeAll(async () => {
  admin = await authenticate('disableduseradmin');
  const invite = (await (await api('POST', '/api/admin/invites', admin.accessToken, {})).json()) as any;
  const member = newAccount('banned-member');
  expect((await register(member, invite.code)).status).toBe(200);
  const memberToken = ((await (await login(member)).json()) as any).access_token;
  memberId = ((await (await api('GET', '/api/accounts/profile', memberToken)).json()) as any).id;

  // Admin bans the member.
  const ban = await api('PUT', `/api/admin/users/${memberId}/status`, admin.accessToken, { status: 'banned' });
  expect(ban.status).toBe(200);
});

describe('disabled account authentication', () => {
  it('rejects a client_credentials grant for a banned user', async () => {
    const res = await SELF.fetch(url('/identity/connect/token'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: `user.${memberId}`,
        client_secret: 'whatever',
        scope: 'api',
        deviceIdentifier: crypto.randomUUID(),
        deviceType: '10',
      }).toString(),
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('disabled');
  });
});
