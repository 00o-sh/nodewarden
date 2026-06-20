import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, login, newAccount, register, sync } from './helpers';

// Each integration test file runs against its own fresh in-memory D1, so the
// account registered here is genuinely the first account on this instance.
const admin = newAccount('admin');
let registerStatus: number;
let registerBody: { success: boolean; role: string };

beforeAll(async () => {
  const res = await register(admin);
  registerStatus = res.status;
  registerBody = (await res.json()) as typeof registerBody;
});

// The critical end-to-end path. If this passes, the app fundamentally works
// after an upstream merge.
describe('register -> login -> sync', () => {
  it('promotes the first account to admin', () => {
    expect(registerStatus).toBe(200);
    expect(registerBody).toMatchObject({ success: true, role: 'admin' });
  });

  it('logs in with a password grant and returns a usable token', async () => {
    const res = await login(admin);
    expect(res.status).toBe(200);
    const token = (await res.json()) as Record<string, any>;
    expect(token.token_type).toBe('Bearer');
    expect(typeof token.access_token).toBe('string');
    expect(typeof token.refresh_token).toBe('string');
    // Encrypted user key is echoed back so the client can decrypt the vault.
    expect(token.Key).toBe(ENC_STRING);
    expect(token.scope).toBe('api offline_access');
  });

  it('serves a Bitwarden-shaped sync envelope for the logged-in user', async () => {
    const token = (await (await login(admin)).json()) as { access_token: string };
    const res = await sync(token.access_token);
    expect(res.status).toBe(200);
    const vault = (await res.json()) as Record<string, any>;

    expect(vault.object).toBe('sync');
    expect(vault.profile).toMatchObject({
      email: admin.email,
      object: 'profile',
      key: ENC_STRING,
    });
    // A brand-new vault is empty, but the collections must be present arrays.
    expect(vault.ciphers).toEqual([]);
    expect(vault.folders).toEqual([]);
    expect(vault.collections).toEqual([]);
    expect(vault.sends).toEqual([]);
  });
});

describe('login failure modes', () => {
  it('rejects a login with the wrong password (400, OAuth error shape)', async () => {
    const res = await login({ ...admin, masterPasswordHash: btoa('wrong-password') });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('invalid_grant');
  });

  it('rejects a login for an unknown user (400)', async () => {
    const res = await login(newAccount('ghost'));
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('invalid_grant');
  });
});

describe('registration rules', () => {
  it('requires an invite code once an admin exists (403)', async () => {
    const res = await register(newAccount('invitee'));
    expect(res.status).toBe(403);
  });

  it('rejects registration missing required fields (400)', async () => {
    const res = await register({ ...newAccount('bad'), masterPasswordHash: '' });
    expect(res.status).toBe(400);
  });
});
