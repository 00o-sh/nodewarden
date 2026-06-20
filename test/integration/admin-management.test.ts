import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, login, newAccount, register } from './helpers';

// Admin user-management and audit-log operations that mutate state, kept in a
// dedicated file so banned/deleted users don't disturb other admin tests.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('adminmgmt');
  token = session.accessToken;
});

async function inviteAndRegister(label: string) {
  const invite = (await (await api('POST', '/api/admin/invites', token, {})).json()) as any;
  const account = newAccount(label);
  expect((await register(account, invite.code)).status).toBe(200);
  const userId = ((await (await login(account)).json()) as any).access_token;
  return { account, userToken: userId };
}

describe('user status management', () => {
  it('bans then reactivates a user', async () => {
    const { account } = await inviteAndRegister('victim');
    // Find the user's id from the admin user list.
    const users = ((await (await api('GET', '/api/admin/users', token)).json()) as any).data;
    const target = users.find((u: any) => u.email === account.email);
    expect(target).toBeTruthy();

    const banned = await api('PUT', `/api/admin/users/${target.id}/status`, token, { status: 'banned' });
    expect(banned.status).toBe(200);
    // Banned user can no longer authenticate.
    expect((await login(account)).status).toBe(400);

    const reactivated = await api('PUT', `/api/admin/users/${target.id}/status`, token, { status: 'active' });
    expect(reactivated.status).toBe(200);
    expect((await login(account)).status).toBe(200);
  });

  it('refuses to ban yourself (400)', async () => {
    const me = ((await (await api('GET', '/api/admin/users', token)).json()) as any).data
      .find((u: any) => u.email === session.account.email);
    const res = await api('PUT', `/api/admin/users/${me.id}/status`, token, { status: 'banned' });
    expect(res.status).toBe(400);
  });

  it('deletes a user', async () => {
    const { account } = await inviteAndRegister('deletable');
    const target = ((await (await api('GET', '/api/admin/users', token)).json()) as any).data
      .find((u: any) => u.email === account.email);

    const del = await api('DELETE', `/api/admin/users/${target.id}`, token);
    expect(del.status).toBe(204);
    expect((await login(account)).status).toBe(400);
  });
});

describe('audit log administration', () => {
  it('updates audit-log settings', async () => {
    const res = await api('PUT', '/api/admin/logs/settings', token, { retentionDays: 30 });
    expect(res.status).toBe(200);
  });

  it('clears audit logs', async () => {
    const res = await api('DELETE', '/api/admin/logs', token);
    expect(res.status).toBe(200);
  });
});
