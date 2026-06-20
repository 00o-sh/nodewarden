import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, authenticate, baseHeaders, sync, url } from './helpers';

let session: Session;

beforeAll(async () => {
  session = await authenticate('grants');
});

function form(fields: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams(fields).toString(),
  };
}

async function prelogin(email: string): Promise<Response> {
  return SELF.fetch(url('/identity/accounts/prelogin'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email }),
  });
}

describe('prelogin', () => {
  it('returns KDF parameters for an existing user', async () => {
    const res = await prelogin(session.account.email);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.kdf).toBe(0); // PBKDF2
    expect(typeof body.kdfIterations).toBe('number');
  });

  it('returns default KDF parameters for an unknown user (no enumeration)', async () => {
    const res = await prelogin(`nobody-${crypto.randomUUID()}@vault.test`);
    expect(res.status).toBe(200);
    expect(typeof ((await res.json()) as any).kdfIterations).toBe('number');
  });
});

describe('token revocation', () => {
  it('revokes a refresh token so it can no longer be used', async () => {
    const revoke = await SELF.fetch(url('/identity/connect/revocation'), form({
      token: session.refreshToken,
    }));
    expect(revoke.status).toBe(200);

    // The revoked refresh token no longer mints access tokens.
    const refreshed = await SELF.fetch(url('/identity/connect/token'), form({
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
      client_id: 'web',
    }));
    expect(refreshed.status).toBe(400);
  });

  it('treats revocation of an empty token as a no-op (200)', async () => {
    const res = await SELF.fetch(url('/identity/connect/revocation'), form({ token: '' }));
    expect(res.status).toBe(200);
  });
});

describe('access token still works for the original session', () => {
  it('syncs with the access token issued at login', async () => {
    // Revoking the refresh token does not invalidate a live access token.
    expect((await sync(session.accessToken)).status).toBe(200);
  });
});
