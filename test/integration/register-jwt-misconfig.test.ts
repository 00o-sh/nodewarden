import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEV_SECRET } from '../../src/types';
import { handleRegister } from '../../src/handlers/accounts';

// handleRegister refuses to run when JWT_SECRET is missing, the bundled sample
// value, or too short. The REAL handler is invoked against an env whose
// JWT_SECRET genuinely has each unsafe value, so jwtSecretUnsafeReason takes its
// real branches (400). No mocks.
const withSecret = (secret: string) => ({ ...(env as any), JWT_SECRET: secret } as any);
const req = () => new Request('https://vault.test/api/accounts/register', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
});

describe('register rejects an unsafe JWT secret', () => {
  it('400s when the secret is missing', async () => {
    const res = await handleRegister(req(), withSecret(''));
    expect(res.status).toBe(400);
    expect((await res.json() as any).ErrorModel.Message).toContain('not set');
  });

  it('400s when the secret is the default sample value', async () => {
    const res = await handleRegister(req(), withSecret(DEFAULT_DEV_SECRET));
    expect(res.status).toBe(400);
    expect((await res.json() as any).ErrorModel.Message).toContain('default');
  });

  it('400s when the secret is too short', async () => {
    const res = await handleRegister(req(), withSecret('too-short'));
    expect(res.status).toBe(400);
    expect((await res.json() as any).ErrorModel.Message).toContain('32');
  });
});
