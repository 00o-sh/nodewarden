import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, login, newAccount, register } from './helpers';

let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('admininv');
  token = session.accessToken;
});

async function createInvite(): Promise<string> {
  return ((await (await api('POST', '/api/admin/invites', token, {})).json()) as any).code;
}

describe('invite revocation', () => {
  it('revokes a single invite so it can no longer be used', async () => {
    const code = await createInvite();
    const res = await api('DELETE', `/api/admin/invites/${code}`, token);
    expect(res.status).toBe(204);

    // The revoked invite no longer registers a user.
    expect((await register(newAccount('rev'), code)).status).toBe(403);
  });

  it('returns 404 revoking an unknown invite', async () => {
    const res = await api('DELETE', `/api/admin/invites/${crypto.randomUUID().replace(/-/g, '')}`, token);
    expect(res.status).toBe(404);
  });

  it('deletes all invites', async () => {
    await createInvite();
    await createInvite();
    const res = await api('DELETE', '/api/admin/invites', token);
    expect(res.status).toBe(200);
    expect(typeof ((await res.json()) as any).deleted).toBe('number');
  });
});

describe('invite authorization', () => {
  it('forbids a non-admin from creating invites (403)', async () => {
    // Make a regular user via a fresh invite.
    const code = await createInvite();
    const user = newAccount('plain');
    expect((await register(user, code)).status).toBe(200);
    const userToken = ((await (await login(user)).json()) as any).access_token;

    expect((await api('POST', '/api/admin/invites', userToken, {})).status).toBe(403);
  });
});
