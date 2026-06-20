import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, login, newAccount, register } from './helpers';

// The first account is the admin; exercise the admin-only endpoints and the
// invite-driven second-user registration, plus the non-admin forbidden path.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('admin');
  token = session.accessToken;
});

describe('admin endpoints', () => {
  it('lists users (admin sees themselves)', async () => {
    const res = await api('GET', '/api/admin/users', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.object).toBe('list');
    expect(JSON.stringify(body.data)).toContain(session.account.email);
  });

  it('lists audit logs (register/login were recorded)', async () => {
    const res = await api('GET', '/api/admin/logs', token);
    expect(res.status).toBe(200);
  });

  it('reads audit-log settings', async () => {
    const res = await api('GET', '/api/admin/logs/settings', token);
    expect(res.status).toBe(200);
  });

  it('creates and lists invites', async () => {
    const created = await api('POST', '/api/admin/invites', token, { expiresInHours: 24 });
    expect(created.status).toBe(201);
    const invite = (await created.json()) as any;
    expect(typeof invite.code).toBe('string');

    const list = await api('GET', '/api/admin/invites', token);
    expect(list.status).toBe(200);
    expect(JSON.stringify(await list.json())).toContain(invite.code);
  });
});

describe('invite-driven registration', () => {
  it('allows a second user to register with a valid invite code', async () => {
    const invite = (await (await api('POST', '/api/admin/invites', token, {})).json()) as any;
    const second = newAccount('invited');
    const res = await register(second, invite.code);
    expect(res.status).toBe(200);
  });
});

describe('authorization', () => {
  it('forbids a non-admin from the admin API (403)', async () => {
    // Make a second (non-admin) user via an invite, then call an admin route.
    const invite = (await (await api('POST', '/api/admin/invites', token, {})).json()) as any;
    const user = newAccount('regular');
    expect((await register(user, invite.code)).status).toBe(200);
    const userToken = ((await (await login(user)).json()) as any).access_token;

    const res = await api('GET', '/api/admin/users', userToken);
    expect(res.status).toBe(403);
  });
});
