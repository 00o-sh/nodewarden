import { describe, expect, it } from 'vitest';
import { getClientIdentifier } from '../src/services/ratelimit';

function req(headers: Record<string, string> = {}, urlStr = 'https://vault.test/api/sync'): Request {
  return new Request(urlStr, { headers });
}

// Client-IP derivation gates rate limiting; weakening it would open brute-force
// bypasses, so pin the normalization behavior.
describe('getClientIdentifier', () => {
  it('reads CF-Connecting-IP first', () => {
    expect(getClientIdentifier(req({ 'CF-Connecting-IP': '203.0.113.5' }))).toBe('ip4:203.0.113.5');
  });

  it('honors the CF > X-Real-IP > X-Forwarded-For precedence', () => {
    expect(
      getClientIdentifier(
        req({ 'CF-Connecting-IP': '1.1.1.1', 'X-Real-IP': '2.2.2.2', 'X-Forwarded-For': '3.3.3.3' })
      )
    ).toBe('ip4:1.1.1.1');
    expect(getClientIdentifier(req({ 'X-Real-IP': '2.2.2.2' }))).toBe('ip4:2.2.2.2');
  });

  it('uses the first entry of X-Forwarded-For', () => {
    expect(getClientIdentifier(req({ 'X-Forwarded-For': '198.51.100.9, 10.0.0.1' }))).toBe(
      'ip4:198.51.100.9'
    );
  });

  it('collapses IPv6 to a /64 prefix', () => {
    expect(getClientIdentifier(req({ 'CF-Connecting-IP': '2001:db8:1:2:3:4:5:6' }))).toBe(
      'ip6:2001:0db8:0001:0002'
    );
  });

  it('treats IPv4-mapped IPv6 as the underlying IPv4', () => {
    expect(getClientIdentifier(req({ 'CF-Connecting-IP': '::ffff:192.0.2.128' }))).toBe(
      'ip4:192.0.2.128'
    );
  });

  it('rejects invalid/out-of-range addresses (no client id)', () => {
    expect(getClientIdentifier(req({ 'CF-Connecting-IP': '999.1.1.1' }))).toBeNull();
    expect(getClientIdentifier(req({ 'CF-Connecting-IP': 'not-an-ip' }))).toBeNull();
  });

  it('falls back to a loopback id only for local requests', () => {
    expect(getClientIdentifier(req({}, 'https://localhost/api/sync'))).toBe('ip4:127.0.0.1');
    expect(getClientIdentifier(req({}, 'https://vault.test/api/sync'))).toBeNull();
  });
});
