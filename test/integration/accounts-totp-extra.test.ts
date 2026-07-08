import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, totpToken, url } from './helpers';

// Additional TOTP / two-factor error and alternate-verification branches not
// covered by the happy-path suites:
//   - the authenticator enrollment "Invalid token." branch (correct user
//     verification token, but a TOTP code outside the window, and the replay of
//     an already-consumed enrollment counter);
//   - enabling via /api/accounts/totp using the user-verification token instead
//     of the master password hash;
//   - reading the recovery code through a form-urlencoded body;
//   - the recover-2fa rate-limit lockout.
// Real D1 + real TOTP verification, no mocks.
let session: Session;
let token: string;
let mph: string;

beforeAll(async () => {
  session = await authenticate('totpextra');
  token = session.accessToken;
  mph = session.account.masterPasswordHash;
});

// Pick a 6-digit code that is NOT any of the three codes in the ±1 verification
// window, so findMatchingTotpCounter is guaranteed to return null.
async function wrongCode(secret: string): Promise<string> {
  const now = Date.now();
  const window = new Set([
    await totpToken(secret, now - 30_000),
    await totpToken(secret, now),
    await totpToken(secret, now + 30_000),
  ]);
  for (let candidate = 0; candidate < 20; candidate++) {
    const code = String(candidate).padStart(6, '0');
    if (!window.has(code)) return code;
  }
  // Practically unreachable: 20 distinct candidates vs a 3-code window.
  return '999999';
}

describe('two-factor authenticator enrollment token branch', () => {
  it('rejects enrollment with a correct verification token but wrong TOTP code', async () => {
    const setup = (await (await api('POST', '/api/two-factor/get-authenticator', token, { masterPasswordHash: mph })).json()) as any;
    const res = await api('PUT', '/api/two-factor/authenticator', token, {
      key: setup.Key,
      token: await wrongCode(setup.Key),
      userVerificationToken: setup.UserVerificationToken,
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid token');
  });

  it('rejects re-enrolling with an already-consumed enrollment counter (replay)', async () => {
    const setup = (await (await api('POST', '/api/two-factor/get-authenticator', token, { masterPasswordHash: mph })).json()) as any;
    const code = await totpToken(setup.Key);

    // First enrollment succeeds and consumes the current time-counter.
    const first = await api('PUT', '/api/two-factor/authenticator', token, {
      key: setup.Key,
      token: code,
      userVerificationToken: setup.UserVerificationToken,
    });
    expect(first.status).toBe(200);

    // Re-submitting the same code (its counter is now consumed) is rejected even
    // though the verification token and key are still valid.
    const setup2 = (await (await api('POST', '/api/two-factor/get-authenticator', token, { masterPasswordHash: mph })).json()) as any;
    const replay = await api('PUT', '/api/two-factor/authenticator', token, {
      key: setup2.Key,
      token: code,
      userVerificationToken: setup2.UserVerificationToken,
    });
    expect(replay.status).toBe(400);
    expect((await replay.text()).toLowerCase()).toContain('invalid token');

    // Clean up so the account has no residual TOTP for later suites in this file.
    expect((await api('DELETE', '/api/two-factor/authenticator', token, { masterPasswordHash: mph })).status).toBe(200);
  });
});

describe('accounts/totp enable via user-verification token', () => {
  it('enables TOTP using the user-verification token (no master password hash)', async () => {
    const setup = (await (await api('POST', '/api/two-factor/get-authenticator', token, { masterPasswordHash: mph })).json()) as any;

    // Use an adjacent time step: an earlier suite consumed the current counter
    // for this user, so the next step's code stays inside the ±1 window but is
    // not a replay of an already-consumed counter.
    const res = await api('PUT', '/api/accounts/totp', token, {
      enabled: true,
      secret: setup.Key,
      token: await totpToken(setup.Key, Date.now() + 30_000),
      userVerificationToken: setup.UserVerificationToken,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.enabled).toBe(true);
    expect(typeof body.recoveryCode).toBe('string');

    expect(((await (await api('GET', '/api/accounts/totp', token)).json()) as any).enabled).toBe(true);

    // Disable again to leave the account clean.
    expect((await api('PUT', '/api/accounts/totp', token, { enabled: false, masterPasswordHash: mph })).status).toBe(200);
  });
});

describe('accounts/totp recovery-code form-urlencoded body', () => {
  it('accepts a form-urlencoded body and returns the recovery code', async () => {
    const res = await SELF.fetch(url('/api/accounts/totp/recovery-code'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ masterPasswordHash: mph }).toString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(typeof (body.code ?? body.Code)).toBe('string');
  });
});

describe('recover-2fa rate-limit lockout', () => {
  it('locks out after repeated failed recovery attempts (429)', async () => {
    const ip = '198.51.114.23';
    let res: Response | null = null;
    for (let i = 0; i < 14; i++) {
      res = await SELF.fetch(url('/identity/accounts/recover-2fa'), {
        method: 'POST',
        headers: { 'CF-Connecting-IP': ip, Origin: 'https://vault.test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: session.account.email,
          masterPasswordHash: mph,
          recoveryCode: 'WRONGWRONGWRONGWRONGWR',
        }),
      });
      if (res.status === 429) break;
    }
    expect(res!.status).toBe(429);
    expect((await res!.text()).toLowerCase()).toContain('too many');
  });
});
