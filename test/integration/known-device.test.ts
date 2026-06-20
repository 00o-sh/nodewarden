import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, authenticate, baseHeaders, url } from './helpers';

let session: Session;

beforeAll(async () => {
  session = await authenticate('knowndev');
});

function base64Url(value: string): string {
  return btoa(unescape(encodeURIComponent(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function probe(headers: Record<string, string>): Promise<Response> {
  return SELF.fetch(url('/api/devices/knowndevice'), { method: 'GET', headers: baseHeaders(headers) });
}

describe('known device probe', () => {
  it('returns true for the device used at login', async () => {
    const res = await probe({
      'X-Request-Email': base64Url(session.account.email),
      'X-Device-Identifier': session.account.deviceIdentifier,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toBe(true);
  });

  it('returns false for an unknown device', async () => {
    const res = await probe({
      'X-Request-Email': base64Url(session.account.email),
      'X-Device-Identifier': crypto.randomUUID(),
    });
    expect(await res.json()).toBe(false);
  });

  it('returns false when headers are missing', async () => {
    const res = await probe({});
    expect(await res.json()).toBe(false);
  });
});
