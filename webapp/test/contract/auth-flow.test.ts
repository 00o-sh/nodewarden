import { beforeAll, describe, expect, it } from 'vitest';
import {
  createAuthedFetch,
  deriveLoginHash,
  getPreloginKdfConfig,
  getProfile,
  loginWithPassword,
  registerAccount,
  unlockVaultKey,
} from '@/lib/api/auth';
import type { SessionState, TokenSuccess } from '@/lib/types';

// A full account lifecycle driven entirely through the webapp's real api client
// against the real worker: register (frontend builds the encrypted key material
// + RSA keypair), prelogin, password login, then an authenticated profile read.
// If the frontend's request shape or the backend's response shape drift apart,
// this fails — which is exactly the cross-stack guarantee the unit/component
// suites cannot give on their own.
const PASSWORD = 'correct horse battery staple';
const DEFAULT_ITERATIONS = 600000;

let email: string;

beforeAll(() => {
  email = `contract-${crypto.randomUUID()}@vault.test`;
});

describe('account registration + login contract', () => {
  it('registers a new account through the frontend client', async () => {
    const result = await registerAccount({
      email,
      name: 'Contract Test',
      password: PASSWORD,
      fallbackIterations: DEFAULT_ITERATIONS,
    });
    expect(result.ok).toBe(true);
  });

  it('prelogin reports the stored KDF configuration', async () => {
    const config = await getPreloginKdfConfig(email, DEFAULT_ITERATIONS);
    expect(config.kdfType).toBe(0);
    expect(config.kdfIterations).toBe(DEFAULT_ITERATIONS);
  });

  it('logs in with the password hash derived by the frontend', async () => {
    const prelogin = await deriveLoginHash(email, PASSWORD, DEFAULT_ITERATIONS);
    expect(prelogin.kdfIterations).toBe(DEFAULT_ITERATIONS);

    const token = await loginWithPassword(email, prelogin.hash);
    expect('access_token' in token).toBe(true);
    const success = token as TokenSuccess;
    expect(success.access_token).toBeTruthy();

    // The returned vault key must decrypt with the master key the frontend just
    // derived — proving register and login agree on the key wrapping.
    const unlocked = await unlockVaultKey(success.Key, prelogin.masterKey);
    expect(unlocked.symEncKey).toBeTruthy();
    expect(unlocked.symMacKey).toBeTruthy();
  });

  it('reads the profile over an authenticated request', async () => {
    const prelogin = await deriveLoginHash(email, PASSWORD, DEFAULT_ITERATIONS);
    const token = (await loginWithPassword(email, prelogin.hash)) as TokenSuccess;

    let session: SessionState | null = {
      email,
      authMode: 'token',
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
    };
    const authedFetch = createAuthedFetch(
      () => session,
      (next) => {
        session = next;
      }
    );

    const profile = await getProfile(authedFetch);
    expect(profile.email).toBe(email);
  });

  it('rejects login with a wrong password hash', async () => {
    const token = await loginWithPassword(email, 'definitely-not-the-hash');
    expect('access_token' in token).toBe(false);
  });
});
