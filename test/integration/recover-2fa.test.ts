import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, login, url } from './helpers';

// Account 2FA recovery: enable TOTP, then disable it with the recovery code via
// the public recover-2fa endpoint.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('recover2fa');
  token = session.accessToken;
});

function base32ToBytes(secret: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of secret.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
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
  const buf = new Uint8Array(8);
  let c = Math.floor(Date.now() / 1000 / 30);
  for (let i = 7; i >= 0; i--) {
    buf[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const off = sig[sig.length - 1] & 0x0f;
  const bin = ((sig[off] & 0x7f) << 24) | ((sig[off + 1] & 0xff) << 16) | ((sig[off + 2] & 0xff) << 8) | (sig[off + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, '0');
}

describe('recover two-factor', () => {
  it('disables TOTP using the recovery code', async () => {
    const mph = session.account.masterPasswordHash;

    // Enable TOTP.
    const setup = (await (await api('POST', '/api/two-factor/get-authenticator', token, { secret: mph, masterPasswordHash: mph })).json()) as any;
    expect((await api('PUT', '/api/two-factor/authenticator', token, {
      key: setup.Key,
      token: await totp(setup.Key),
      userVerificationToken: setup.UserVerificationToken,
    })).status).toBe(200);

    // Read the recovery code.
    const rc = (await (await api('POST', '/api/accounts/totp/recovery-code', token, { masterPasswordHash: mph })).json()) as any;
    const recoveryCode = rc.code ?? rc.Code ?? rc.recoveryCode ?? rc.RecoveryCode;
    expect(typeof recoveryCode).toBe('string');

    // Recover via the public endpoint.
    const recover = await SELF.fetch(url('/identity/accounts/recover-2fa'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email: session.account.email, masterPasswordHash: mph, recoveryCode }),
    });
    expect(recover.status).toBe(200);

    // 2FA is now off: a plain password login no longer hits a challenge.
    const relogin = (await (await login(session.account)).json()) as any;
    expect(typeof relogin.access_token).toBe('string');
  });

  it('rejects recovery with a wrong code (400)', async () => {
    const res = await SELF.fetch(url('/identity/accounts/recover-2fa'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        email: session.account.email,
        masterPasswordHash: session.account.masterPasswordHash,
        recoveryCode: 'WRONG WRONG WRONG WRON',
      }),
    });
    expect(res.status).toBe(400);
  });
});
