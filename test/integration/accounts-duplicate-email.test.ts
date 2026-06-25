import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, newAccount, register } from './helpers';

// Registering an email that already exists (even with a fresh, valid invite)
// hits the unique-constraint branch and returns 409 "Email already registered".
// Real D1 unique constraint, no mocks.
let admin: Session;

beforeAll(async () => {
  admin = await authenticate('dupemailadmin');
});

describe('duplicate registration', () => {
  it('409s registering an already-registered email with a fresh invite', async () => {
    const invite1 = (await (await api('POST', '/api/admin/invites', admin.accessToken, {})).json()) as any;
    const invite2 = (await (await api('POST', '/api/admin/invites', admin.accessToken, {})).json()) as any;
    const member = newAccount('dupe');

    expect((await register(member, invite1.code)).status).toBe(200);
    const second = await register(member, invite2.code);
    expect(second.status).toBe(409);
    expect((await second.text()).toLowerCase()).toContain('already registered');
  });
});
