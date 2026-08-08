import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { StorageService } from '../../src/services/storage';
import { hashApiKey, isStoredApiKeyHash } from '../../src/utils/api-key';
import { Session, api, authenticate } from './helpers';

// v1.8.0 API-key format migration: a legacy row stores a one-way hash
// (`sha256:...`) that cannot be shown. handleGetApiKey must refuse to display it
// with a 409 and steer the user to rotate once into the readable Bitwarden
// format; rotate-api-key then replaces it with a displayable key.
let session: Session;
let storage: StorageService;

beforeAll(async () => {
  session = await authenticate('apikeyhash');
  storage = new StorageService(env.DB);
  // Downgrade the account's freshly-issued readable key into the legacy hashed
  // form so the stored-hash branch is reachable.
  const user = await storage.getUser(session.account.email);
  if (!user) throw new Error('user not found');
  user.apiKey = await hashApiKey('legacy-secret-value');
  await storage.saveUser(user);
});

describe('get-api-key with a legacy hashed key', () => {
  it('409s rather than displaying an unreadable stored hash', async () => {
    const res = await api('POST', '/api/accounts/api-key', session.accessToken, {
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(409);
    expect((await res.text()).toLowerCase()).toContain('rotate it once');
  });

  it('rotate-api-key replaces the hash with a readable key', async () => {
    const res = await api('POST', '/api/accounts/rotate-api-key', session.accessToken, {
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { apiKey: string; object: string };
    expect(body.object).toBe('apiKey');
    // Rotation produces a readable key, not another stored hash.
    expect(isStoredApiKeyHash(body.apiKey)).toBe(false);
    expect(body.apiKey.length).toBeGreaterThan(20);

    // A subsequent get-api-key now succeeds and echoes the same readable key.
    const after = await api('POST', '/api/accounts/api-key', session.accessToken, {
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(after.status).toBe(200);
    expect(((await after.json()) as { apiKey: string }).apiKey).toBe(body.apiKey);
  });
});
