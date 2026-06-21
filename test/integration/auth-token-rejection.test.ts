import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, TestAccount, api, authenticate, baseHeaders, login, newAccount, register, sync, url } from './helpers';

// The access-token verification middleware (verifyAccessTokenWithUser): rejects
// malformed headers / bad tokens, a banned user, and a token whose security
// stamp has been rotated out from under it.
let admin: Session;
let adminToken: string;

beforeAll(async () => {
  admin = await authenticate('authrej');
  adminToken = admin.accessToken;
});

async function makeUser(label: string): Promise<{ account: TestAccount; token: string; id: string }> {
  const invite = (await (await api('POST', '/api/admin/invites', adminToken, {})).json()) as any;
  const account = newAccount(label);
  expect((await register(account, invite.code)).status).toBe(200);
  const token = ((await (await login(account)).json()) as any).access_token;
  const profile = (await (await api('GET', '/api/accounts/profile', token)).json()) as any;
  return { account, token, id: profile.id ?? profile.Id };
}

function syncWithHeader(header: string | null): Promise<Response> {
  const headers = baseHeaders();
  if (header !== null) headers.Authorization = header;
  return SELF.fetch(url('/api/sync'), { headers });
}

describe('access token rejection', () => {
  it('rejects a missing, malformed, or garbage token (401)', async () => {
    expect((await syncWithHeader(null)).status).toBe(401);
    expect((await syncWithHeader('Basic abc')).status).toBe(401); // wrong scheme
    expect((await syncWithHeader('Bearer not-a-jwt')).status).toBe(401);
    expect((await syncWithHeader(`Bearer ${admin.accessToken}.tampered`)).status).toBe(401);
  });

  it('rejects a token for a banned user', async () => {
    const { token, id } = await makeUser('authrej-banned');
    expect((await sync(token)).status).toBe(200); // works before the ban
    expect((await api('PUT', `/api/admin/users/${id}/status`, adminToken, { status: 'banned' })).status).toBe(200);
    expect((await sync(token)).status).toBe(401); // status no longer active
  });

  it('rejects a token after its security stamp rotates (password change)', async () => {
    const { account, token } = await makeUser('authrej-stamp');
    expect((await sync(token)).status).toBe(200);

    // Changing the password rotates the security stamp, invalidating the old token.
    const changed = await api('POST', '/api/accounts/password', token, {
      masterPasswordHash: account.masterPasswordHash,
      newMasterPasswordHash: btoa(`new-${crypto.randomUUID()}`),
    });
    expect(changed.status).toBe(200);

    expect((await sync(token)).status).toBe(401);
  });
});
