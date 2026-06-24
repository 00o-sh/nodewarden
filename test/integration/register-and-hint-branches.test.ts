import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, newAccount, register, url } from './helpers';

// Validation and error branches of handleRegister and handleGetPasswordHint,
// driven through the real worker with genuinely-invalid inputs (no mocks).
let session: Session;
let token: string;
let ipCounter = 10;

// Registration is rate-limited per client IP, so each call uses a fresh source.
function registerRaw(overrides: Record<string, unknown>): Promise<Response> {
  const account = newAccount('regbranch');
  return SELF.fetch(url('/api/accounts/register'), {
    method: 'POST',
    headers: { 'CF-Connecting-IP': `198.51.102.${ipCounter++}`, Origin: 'https://vault.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: account.email,
      name: 'KDF Test',
      masterPasswordHash: account.masterPasswordHash,
      key: ENC_STRING,
      kdf: 0,
      kdfIterations: 600000,
      keys: { publicKey: btoa('pk'.repeat(30)), encryptedPrivateKey: ENC_STRING },
      ...overrides,
    }),
  });
}

beforeAll(async () => {
  session = await authenticate('reghintbranches');
  token = session.accessToken;
});

describe('handleRegister validation branches', () => {
  it('rejects Argon2id with too little memory', async () => {
    const res = await registerRaw({ kdf: 1, kdfIterations: 3, kdfMemory: 8, kdfParallelism: 1 });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('memory');
  });

  it('rejects Argon2id with non-positive parallelism', async () => {
    const res = await registerRaw({ kdf: 1, kdfIterations: 3, kdfMemory: 64, kdfParallelism: 0 });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('parallelism');
  });

  it('requires an invite code for non-first users', async () => {
    // The admin already exists, so an open second registration is refused.
    const res = await registerRaw({});
    expect(res.status).toBe(403);
    expect((await res.text()).toLowerCase()).toContain('invite');
  });

  it('rejects a bogus invite code after creating the user row', async () => {
    const res = await registerRaw({ inviteCode: 'definitely-not-a-real-invite' });
    expect(res.status).toBe(403);
    expect((await res.text()).toLowerCase()).toContain('invalid or expired');
  });

  it('reports a duplicate email as a conflict', async () => {
    // Register a member through a real invite, then attempt the same email again
    // with a second invite — the unique-constraint path returns 409.
    const invite1 = (await (await api('POST', '/api/admin/invites', token, {})).json()) as any;
    const invite2 = (await (await api('POST', '/api/admin/invites', token, {})).json()) as any;
    const member = newAccount('dupemail');
    expect((await register(member, invite1.code)).status).toBe(200);
    const dup = await register(member, invite2.code);
    expect(dup.status).toBe(409);
    expect((await dup.text()).toLowerCase()).toContain('already registered');
  });
});

describe('handleGetPasswordHint validation branches', () => {
  function hint(ip: string, body: string): Promise<Response> {
    return SELF.fetch(url('/api/accounts/password-hint'), {
      method: 'POST',
      headers: { 'CF-Connecting-IP': ip, Origin: 'https://vault.test', 'Content-Type': 'application/json' },
      body,
    });
  }

  it('400s malformed JSON', async () => {
    expect((await hint('198.51.103.1', '{bad')).status).toBe(400);
  });

  it('400s a missing email', async () => {
    expect((await hint('198.51.103.2', JSON.stringify({}))).status).toBe(400);
  });

  it('429s once the per-minute budget is spent', async () => {
    const ip = '198.51.103.3';
    const first = await hint(ip, JSON.stringify({ email: 'someone@vault.test' }));
    expect([200, 404]).toContain(first.status);
    const second = await hint(ip, JSON.stringify({ email: 'someone@vault.test' }));
    expect(second.status).toBe(429);
  });
});
