import {
  createAuthedFetch,
  deriveLoginHash,
  loginWithPassword,
  registerAccount,
  unlockVaultKey,
} from '@/lib/api/auth';
import type { AuthedFetch } from '@/lib/api/shared';
import type { Profile, SessionState, TokenSuccess } from '@/lib/types';
import { getProfile } from '@/lib/api/auth';

// Shared bootstrap for api/ contract tests: register a brand-new account and log
// in entirely through the real webapp api client against the real worker, then
// expose an authedFetch + an unlocked session (with the symmetric vault keys) so
// each test can exercise authenticated, encryption-dependent endpoints
// (ciphers, folders, sends, ...) exactly as the app does.
export const DEFAULT_ITERATIONS = 600000;

export interface ContractSession {
  email: string;
  password: string;
  // The unlocked session, carrying accessToken/refreshToken + symEncKey/symMacKey.
  session: SessionState;
  authedFetch: AuthedFetch;
  masterKey: Uint8Array;
}

export async function registerAndLogin(label = 'user'): Promise<ContractSession> {
  const email = `contract-${label}-${crypto.randomUUID()}@vault.test`;
  const password = `pw-${crypto.randomUUID()}`;

  const reg = await registerAccount({
    email,
    name: 'Contract Test',
    password,
    fallbackIterations: DEFAULT_ITERATIONS,
  });
  if (!reg.ok) throw new Error(`register failed: ${'message' in reg ? reg.message : 'unknown'}`);

  const prelogin = await deriveLoginHash(email, password, DEFAULT_ITERATIONS);
  const token = (await loginWithPassword(email, prelogin.hash)) as TokenSuccess;
  if (!token.access_token) throw new Error('login failed');

  const { symEncKey, symMacKey } = await unlockVaultKey(token.Key as string, prelogin.masterKey);

  let session: SessionState = {
    email,
    authMode: 'token',
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    symEncKey,
    symMacKey,
  };
  const authedFetch = createAuthedFetch(
    () => session,
    (next) => {
      if (next) session = { ...next, symEncKey, symMacKey };
    }
  );

  return { email, password, session, authedFetch, masterKey: prelogin.masterKey };
}

export async function fetchProfile(ctx: ContractSession): Promise<Profile> {
  return getProfile(ctx.authedFetch);
}

// A unique vault-core cache key per call so the in-memory/IndexedDB sync cache
// never leaks state between tests.
export function freshCacheKey(label = 'vault'): string {
  return `contract-${label}-${crypto.randomUUID()}`;
}
