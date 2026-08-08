import { env } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageService } from '../../src/services/storage';
import {
  YUBICO_BOOTSTRAP_CLAIM_CONFIG_KEY,
  YUBICO_CLIENT_ID_CONFIG_KEY,
  YUBICO_SECRET_KEY_CONFIG_KEY,
  getYubicoCredentials,
  initializeYubicoCredentialsOnce,
  replaceYubicoCredentials,
} from '../../src/services/yubico-config';

// Tier-3 unit coverage for the Yubico API credential store (a v1.8.0 addition):
// reading/writing the client-id + secret-key pair in the D1 `config` table, the
// partial/missing-credential branches, and the once-only bootstrap that issues
// credentials from Yubico's getapikey endpoint under a claim lock. Runs against
// the live D1 binding; the only outbound call (getapikey) is stubbed.

// A well-formed YubiKey OTP (44 modhex chars) so requestYubicoApiCredentials
// passes its format guard and actually performs the (stubbed) network request.
const FULL_OTP = 'cbdefghijkln' + 'cbdefghijklnrtuvcbdefghijklnrtuv';
const SECRET = btoa('yubico-issued-secret-material-0');

function apiKeyHtml(clientId: string, secret: string): string {
  return `
    <table>
      <tr><th>Client ID:</th><td><b>${clientId}</b></td></tr>
      <tr><th>Secret key:</th><td><code>${secret}</code></td></tr>
    </table>`;
}

async function clearConfig(): Promise<void> {
  await env.DB.prepare('DELETE FROM config WHERE key IN (?, ?, ?)')
    .bind(
      YUBICO_CLIENT_ID_CONFIG_KEY,
      YUBICO_SECRET_KEY_CONFIG_KEY,
      YUBICO_BOOTSTRAP_CLAIM_CONFIG_KEY
    )
    .run();
}

async function setConfig(key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
    .bind(key, value)
    .run();
}

beforeAll(async () => {
  await new StorageService(env.DB).initializeDatabase();
});
beforeEach(clearConfig);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('getYubicoCredentials', () => {
  it('returns null when neither credential row exists', async () => {
    await expect(getYubicoCredentials(env.DB)).resolves.toBeNull();
  });

  it('returns null when only the client id is present (partial)', async () => {
    await setConfig(YUBICO_CLIENT_ID_CONFIG_KEY, '4242');
    await expect(getYubicoCredentials(env.DB)).resolves.toBeNull();
  });

  it('returns null when only the secret key is present (partial)', async () => {
    await setConfig(YUBICO_SECRET_KEY_CONFIG_KEY, SECRET);
    await expect(getYubicoCredentials(env.DB)).resolves.toBeNull();
  });

  it('returns null when a stored value is blank/whitespace-only', async () => {
    await setConfig(YUBICO_CLIENT_ID_CONFIG_KEY, '   ');
    await setConfig(YUBICO_SECRET_KEY_CONFIG_KEY, SECRET);
    await expect(getYubicoCredentials(env.DB)).resolves.toBeNull();
  });

  it('returns the trimmed credential pair when both rows are present', async () => {
    await setConfig(YUBICO_CLIENT_ID_CONFIG_KEY, '  4242  ');
    await setConfig(YUBICO_SECRET_KEY_CONFIG_KEY, `  ${SECRET}  `);
    await expect(getYubicoCredentials(env.DB)).resolves.toEqual({
      clientId: '4242',
      secretKey: SECRET,
    });
  });
});

describe('replaceYubicoCredentials', () => {
  it('writes both rows and upserts over an existing value', async () => {
    await replaceYubicoCredentials(env.DB, { clientId: ' 111 ', secretKey: SECRET });
    await expect(getYubicoCredentials(env.DB)).resolves.toEqual({
      clientId: '111',
      secretKey: SECRET,
    });

    // A second call overwrites in place (ON CONFLICT DO UPDATE).
    await replaceYubicoCredentials(env.DB, { clientId: '222', secretKey: SECRET });
    await expect(getYubicoCredentials(env.DB)).resolves.toEqual({
      clientId: '222',
      secretKey: SECRET,
    });
  });

  it('throws when either credential half is missing', async () => {
    await expect(
      replaceYubicoCredentials(env.DB, { clientId: '', secretKey: SECRET })
    ).rejects.toThrow(/incomplete/i);
    await expect(
      replaceYubicoCredentials(env.DB, { clientId: '333', secretKey: '   ' })
    ).rejects.toThrow(/incomplete/i);
    // Nothing was written on the rejected calls.
    await expect(getYubicoCredentials(env.DB)).resolves.toBeNull();
  });
});

describe('initializeYubicoCredentialsOnce', () => {
  it('short-circuits with created:false when credentials already exist', async () => {
    await replaceYubicoCredentials(env.DB, { clientId: '4242', secretKey: SECRET });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await initializeYubicoCredentialsOnce(env.DB, 'user@vault.test', FULL_OTP);
    expect(result).toEqual({ credentials: { clientId: '4242', secretKey: SECRET }, created: false });
    // No network call: the existing credentials are used as-is.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('issues, stores and returns created:true when none exist yet', async () => {
    const fetchMock = vi.fn(async () => new Response(apiKeyHtml('9001', SECRET), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await initializeYubicoCredentialsOnce(env.DB, 'user@vault.test', FULL_OTP);
    expect(result).toEqual({ credentials: { clientId: '9001', secretKey: SECRET }, created: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The issued credentials were persisted, and the claim lock was released.
    await expect(getYubicoCredentials(env.DB)).resolves.toEqual({
      clientId: '9001',
      secretKey: SECRET,
    });
    const claim = await env.DB.prepare('SELECT value FROM config WHERE key = ?')
      .bind(YUBICO_BOOTSTRAP_CLAIM_CONFIG_KEY)
      .first();
    expect(claim).toBeNull();
  });

  it('returns null when Yubico issues no client id (bad OTP / no credentials)', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>no credentials</html>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await initializeYubicoCredentialsOnce(env.DB, 'user@vault.test', FULL_OTP);
    expect(result).toBeNull();
    await expect(getYubicoCredentials(env.DB)).resolves.toBeNull();
    // The claim lock is still released on the failure path.
    const claim = await env.DB.prepare('SELECT value FROM config WHERE key = ?')
      .bind(YUBICO_BOOTSTRAP_CLAIM_CONFIG_KEY)
      .first();
    expect(claim).toBeNull();
  });

  it('adopts credentials configured concurrently during the getapikey request', async () => {
    // The getapikey call is slow; while it is in flight another actor writes the
    // credentials. The initializer must prefer those over its own issuance.
    const fetchMock = vi.fn(async () => {
      await replaceYubicoCredentials(env.DB, { clientId: '7777', secretKey: SECRET });
      return new Response(apiKeyHtml('9001', SECRET), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await initializeYubicoCredentialsOnce(env.DB, 'user@vault.test', FULL_OTP);
    expect(result).toEqual({ credentials: { clientId: '7777', secretKey: SECRET }, created: false });
    // The concurrently-written credentials win; the issued 9001 is discarded.
    await expect(getYubicoCredentials(env.DB)).resolves.toEqual({
      clientId: '7777',
      secretKey: SECRET,
    });
  });

  it('returns null when the bootstrap claim is already held and no credentials exist', async () => {
    // Pre-hold the claim with a not-yet-expired value so INSERT OR IGNORE finds
    // it and acquireBootstrapClaim returns null.
    const future = Date.now() + 5 * 60 * 1000;
    await setConfig(YUBICO_BOOTSTRAP_CLAIM_CONFIG_KEY, `${future}:someone-else`);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await initializeYubicoCredentialsOnce(env.DB, 'user@vault.test', FULL_OTP);
    expect(result).toBeNull();
    // Never issued: the claim belongs to someone else and stays put.
    expect(fetchMock).not.toHaveBeenCalled();
    const claim = await env.DB.prepare('SELECT value FROM config WHERE key = ?')
      .bind(YUBICO_BOOTSTRAP_CLAIM_CONFIG_KEY)
      .first<{ value: string }>();
    expect(claim?.value).toBe(`${future}:someone-else`);
  });

  it('reclaims an expired bootstrap claim and proceeds to issue', async () => {
    // A stale claim (past-expiry) is swept by acquireBootstrapClaim's DELETE,
    // letting this call take the lock and issue fresh credentials.
    await setConfig(YUBICO_BOOTSTRAP_CLAIM_CONFIG_KEY, `${Date.now() - 1000}:stale`);
    const fetchMock = vi.fn(async () => new Response(apiKeyHtml('4321', SECRET), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await initializeYubicoCredentialsOnce(env.DB, 'user@vault.test', FULL_OTP);
    expect(result).toEqual({ credentials: { clientId: '4321', secretKey: SECRET }, created: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
