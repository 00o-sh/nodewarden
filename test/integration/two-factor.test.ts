import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// Full TOTP two-factor lifecycle: enable via the setup ceremony, satisfy the
// login challenge, read the recovery code, then disable. Exercises the 2FA
// branches in both accounts.ts and the identity password grant.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('twofactor');
  token = session.accessToken;
});

function base32ToBytes(secret: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

async function totp(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', base32ToBytes(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    buf[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const off = sig[sig.length - 1] & 0x0f;
  const bin = ((sig[off] & 0x7f) << 24) | ((sig[off + 1] & 0xff) << 16) | ((sig[off + 2] & 0xff) << 8) | (sig[off + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, '0');
}

function loginForm(fields: Record<string, string>): Promise<Response> {
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams({
      grant_type: 'password',
      username: session.account.email,
      password: session.account.masterPasswordHash,
      scope: 'api offline_access',
      client_id: 'web',
      deviceType: '10',
      deviceIdentifier: session.account.deviceIdentifier,
      deviceName: 'integration-test',
      ...fields,
    }).toString(),
  });
}

describe('TOTP two-factor lifecycle', () => {
  let secret: string;

  it('enables TOTP via the setup ceremony', async () => {
    const setup = (await (await api('POST', '/api/two-factor/get-authenticator', token, {
      secret: session.account.masterPasswordHash,
      masterPasswordHash: session.account.masterPasswordHash,
    })).json()) as any;
    secret = setup.Key;

    const enable = await api('PUT', '/api/two-factor/authenticator', token, {
      key: secret,
      token: await totp(secret),
      userVerificationToken: setup.UserVerificationToken,
    });
    expect(enable.status).toBe(200);

    expect(((await (await api('GET', '/api/accounts/totp', token)).json()) as any).enabled).toBe(true);
  });

  it('challenges a password login and accepts the TOTP code', async () => {
    // Without a 2FA token, the password grant must not issue an access token.
    const challenged = (await (await loginForm({})).json()) as any;
    expect(challenged.access_token).toBeUndefined();

    // With a valid authenticator code (provider 0), login succeeds.
    const ok = await loginForm({ twoFactorProvider: '0', twoFactorToken: await totp(secret) });
    expect(ok.status).toBe(200);
    expect(typeof ((await ok.json()) as any).access_token).toBe('string');
  });

  it('rejects an invalid TOTP code at login', async () => {
    const res = await loginForm({ twoFactorProvider: '0', twoFactorToken: '000000' });
    expect(res.status).not.toBe(200);
  });

  it('returns a recovery code', async () => {
    const res = await api('POST', '/api/accounts/totp/recovery-code', token, {
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(200);
  });

  it('disables TOTP', async () => {
    const res = await api('DELETE', '/api/two-factor/authenticator', token, {
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(200);
    expect(((await (await api('GET', '/api/accounts/totp', token)).json()) as any).enabled).toBe(false);

    // 2FA no longer challenged: a plain password login issues a token again.
    const ok = await loginForm({});
    expect(typeof ((await ok.json()) as any).access_token).toBe('string');
  });
});
