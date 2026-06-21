import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/services/auth';
import { StorageService } from '../../src/services/storage';
import { Session, authenticate } from './helpers';

// The AuthService driven directly against the real D1 binding and real WebCrypto
// — no mocks. Covers the second-layer password hash, access-token verification
// branches, every refresh-token failure reason, and the static caches.
let session: Session;
let auth: AuthService;
let storage: StorageService;
let userId: string;
let deviceIdentifier: string;

beforeAll(async () => {
  session = await authenticate('auth-svc');
  auth = new AuthService(env as any);
  storage = new StorageService((env as any).DB);
  const verified = await auth.verifyAccessTokenWithUser(`Bearer ${session.accessToken}`);
  expect(verified).toBeTruthy();
  userId = verified!.user.id;
  deviceIdentifier = session.account.deviceIdentifier;
});

describe('password hashing', () => {
  it('produces a deterministic, prefixed server hash bound to the email', async () => {
    const h1 = await auth.hashPasswordServer('client-hash', 'User@Example.test');
    const h2 = await auth.hashPasswordServer('client-hash', 'user@example.test');
    expect(h1.startsWith('$s$')).toBe(true);
    expect(h1).toBe(h2); // email is lower-cased into the salt
    const other = await auth.hashPasswordServer('client-hash', 'someone-else@example.test');
    expect(other).not.toBe(h1);
  });

  it('verifies server-hashed and legacy raw-hash credentials', async () => {
    const stored = await auth.hashPasswordServer('the-hash', 'a@b.test');
    expect(await auth.verifyPassword('the-hash', stored, 'a@b.test')).toBe(true);
    expect(await auth.verifyPassword('wrong-hash', stored, 'a@b.test')).toBe(false);
    // Legacy rows store the raw client hash without the server prefix.
    expect(await auth.verifyPassword('raw', 'raw', 'a@b.test')).toBe(true);
    expect(await auth.verifyPassword('raw', 'different', 'a@b.test')).toBe(false);
  });
});

describe('verifyAccessTokenWithUser', () => {
  it('returns null for missing/malformed/invalid authorization', async () => {
    expect(await auth.verifyAccessTokenWithUser(null)).toBeNull();
    expect(await auth.verifyAccessTokenWithUser('Bearer')).toBeNull(); // one part
    expect(await auth.verifyAccessTokenWithUser('Basic abc')).toBeNull(); // not bearer
    expect(await auth.verifyAccessTokenWithUser('Bearer not-a-jwt')).toBeNull();
  });

  it('resolves a valid device-bound token to its payload and user', async () => {
    const verified = await auth.verifyAccessTokenWithUser(`Bearer ${session.accessToken}`);
    expect(verified!.user.id).toBe(userId);
    expect(verified!.payload.did).toBe(deviceIdentifier);
    // The thin wrapper returns just the payload.
    expect((await auth.verifyAccessToken(`Bearer ${session.accessToken}`))!.sub).toBe(userId);
  });
});

describe('refreshAccessTokenDetailed', () => {
  it('rejects an unknown refresh token', async () => {
    const res = await auth.refreshAccessTokenDetailed('does-not-exist');
    expect(res).toEqual({ ok: false, reason: 'token_not_found_or_expired' });
  });

  it('issues a new access token for a valid refresh token', async () => {
    const res = await auth.refreshAccessTokenDetailed(session.refreshToken);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(typeof res.accessToken).toBe('string');
      expect(res.user.id).toBe(userId);
      expect(res.device?.identifier).toBe(deviceIdentifier);
    }
  });

  it('reports device_missing when the token carries no device binding', async () => {
    const token = await auth.generateRefreshToken(userId, null);
    const res = await auth.refreshAccessTokenDetailed(token);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('device_missing');
  });

  it('reports device_missing when the bound device no longer exists', async () => {
    const token = await auth.generateRefreshToken(userId, { identifier: crypto.randomUUID(), sessionStamp: 's' });
    const res = await auth.refreshAccessTokenDetailed(token);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('device_missing');
  });

  it('reports device_session_mismatch when the session stamp is stale', async () => {
    const device = await storage.getDevice(userId, deviceIdentifier);
    expect(device).toBeTruthy();
    const token = await auth.generateRefreshToken(userId, { identifier: device!.deviceIdentifier, sessionStamp: 'stale-stamp' });
    const res = await auth.refreshAccessTokenDetailed(token);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('device_session_mismatch');
  });
});

describe('static caches and inactive-user rejection', () => {
  it('ignores empty identifiers when invalidating caches', () => {
    expect(() => AuthService.invalidateUserCache('')).not.toThrow();
    expect(() => AuthService.invalidateDeviceCache('', '')).not.toThrow();
    expect(() => AuthService.invalidateUserCache(userId)).not.toThrow();
    expect(() => AuthService.invalidateDeviceCache(userId, deviceIdentifier)).not.toThrow();
  });

  // Mutating tests run last: banning the user invalidates the primary session.
  it('rejects tokens and refreshes once the user is no longer active', async () => {
    const refresh = await auth.generateRefreshToken(userId, { identifier: deviceIdentifier, sessionStamp: 'whatever' });
    const user = await storage.getUserById(userId);
    await storage.saveUser({ ...user!, status: 'banned' });
    AuthService.invalidateUserCache(userId); // drop the cached active copy

    expect(await auth.verifyAccessTokenWithUser(`Bearer ${session.accessToken}`)).toBeNull();
    const res = await auth.refreshAccessTokenDetailed(refresh);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('user_inactive');
  });
});
