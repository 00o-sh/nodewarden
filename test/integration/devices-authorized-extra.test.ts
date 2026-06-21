import { env } from 'cloudflare:test';
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';
import { StorageService } from '../../src/services/storage';

// Device-handler branches that need real trusted-2FA-token rows: the
// authorized-devices listing's placeholder entry for a trusted-but-unknown
// device, upgrading a trusted device to permanent, and the known-device probe.
// Tokens are seeded via a live StorageService over real D1 — no mocks.
let session: Session;
let token: string;
let userId: string;
let deviceIdentifier: string;
const ghostDevice = `ghost-${crypto.randomUUID()}`;

function storage(): StorageService {
  return new StorageService((env as any).DB);
}

function b64url(input: string): string {
  return btoa(unescape(encodeURIComponent(input))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

beforeAll(async () => {
  session = await authenticate('devauth');
  token = session.accessToken;
  deviceIdentifier = session.account.deviceIdentifier;
  const profile = (await (await api('GET', '/api/accounts/profile', token)).json()) as any;
  userId = profile.id ?? profile.Id;

  // The login device gains an active 2FA remember-token; a second token points
  // at a device that was never registered (drives the placeholder branch).
  await storage().saveTrustedTwoFactorDeviceToken(crypto.randomUUID(), userId, deviceIdentifier);
  await storage().saveTrustedTwoFactorDeviceToken(crypto.randomUUID(), userId, ghostDevice);
});

describe('authorized devices with trusted tokens', () => {
  it('lists the real device as trusted and adds a placeholder for the unknown device', async () => {
    const body = (await (await api('GET', '/api/devices/authorized', token)).json()) as any;
    const byId = new Map<string, any>(body.data.map((d: any) => [d.identifier ?? d.Identifier, d]));

    const real = byId.get(deviceIdentifier);
    expect(real).toBeTruthy();
    expect(real.trusted).toBe(true);
    expect(real.trustedTokenCount).toBeGreaterThanOrEqual(1);
    expect(typeof real.trustedUntil).toBe('string');

    const placeholder = byId.get(ghostDevice);
    expect(placeholder).toBeTruthy();
    expect(placeholder.hasStoredDevice).toBe(false);
    expect(placeholder.isTrusted).toBe(true);
    expect(placeholder.name).toBe('Unknown device');
    expect(placeholder.trusted).toBe(true);
  });

  it('upgrades a trusted device to permanent trust', async () => {
    const res = await api('POST', `/api/devices/authorized/${deviceIdentifier}/permanent`, token, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.updated).toBeGreaterThanOrEqual(1);
    expect(new Date(body.trustedUntil).getUTCFullYear()).toBe(2099);
  });
});

describe('known-device probe', () => {
  it('returns false when the probe headers are absent', async () => {
    const res = await SELF.fetch(url('/api/devices/knowndevice'), {
      headers: baseHeaders({ 'CF-Connecting-IP': '203.0.113.8' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toBe(false);
  });

  it('returns true for the registered device + email', async () => {
    const res = await SELF.fetch(url('/api/devices/knowndevice'), {
      headers: baseHeaders({
        'CF-Connecting-IP': '203.0.113.8',
        'X-Request-Email': b64url(session.account.email),
        'X-Device-Identifier': deviceIdentifier,
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toBe(true);
  });
});
