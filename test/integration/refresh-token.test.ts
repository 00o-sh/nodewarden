import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, authenticate, baseHeaders, sync, url } from './helpers';

let session: Session;

beforeAll(async () => {
  session = await authenticate('refresh');
});

async function refresh(refreshToken: string): Promise<Response> {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: 'web',
  });
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: form.toString(),
  });
}

describe('refresh_token grant', () => {
  it('rotates the refresh token and issues a working access token', async () => {
    const res = await refresh(session.refreshToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    expect(body.token_type).toBe('Bearer');
    expect(typeof body.access_token).toBe('string');
    expect(typeof body.refresh_token).toBe('string');
    // Rotation: the new refresh token differs from the one just used.
    expect(body.refresh_token).not.toBe(session.refreshToken);

    // The freshly minted access token authenticates a sync.
    expect((await sync(body.access_token)).status).toBe(200);

    // The rotated token can itself be refreshed again (chain continues).
    const second = await refresh(body.refresh_token);
    expect(second.status).toBe(200);
    expect(typeof ((await second.json()) as any).access_token).toBe('string');
  });

  it('rejects a missing refresh token (400 invalid_request)', async () => {
    const res = await refresh('');
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('invalid_request');
  });

  it('rejects an unknown refresh token (400 invalid_grant)', async () => {
    const res = await refresh(`bogus-${crypto.randomUUID()}`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('invalid_grant');
  });
});
