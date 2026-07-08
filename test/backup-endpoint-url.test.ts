import { describe, expect, it } from 'vitest';
import { normalizeBackupEndpointUrl } from '../src/services/backup-config';

// The backup destination endpoint validator is the SSRF gate for remote backups:
// it parses the URL, enforces the http(s) + no-credentials + no-query contract,
// and rejects any hostname that resolves to a private / loopback / link-local /
// metadata / wildcard-DNS target. Pure function — deterministic, no bindings.

const LABEL = 'S3 endpoint';

describe('normalizeBackupEndpointUrl — URL shape validation', () => {
  it('accepts a normal public https endpoint and trims trailing slashes', () => {
    expect(normalizeBackupEndpointUrl('https://s3.example.com/', LABEL)).toBe('https://s3.example.com');
    expect(normalizeBackupEndpointUrl('https://s3.example.com///', LABEL)).toBe('https://s3.example.com');
    // A path is preserved (only trailing slashes are trimmed).
    expect(normalizeBackupEndpointUrl('https://s3.example.com/base/', LABEL)).toBe('https://s3.example.com/base');
  });

  it('accepts a plain http public endpoint', () => {
    expect(normalizeBackupEndpointUrl('http://storage.example.org', LABEL)).toBe('http://storage.example.org');
  });

  it('rejects an unparseable URL', () => {
    expect(() => normalizeBackupEndpointUrl('not a url', LABEL)).toThrow(/must be a valid URL/);
    expect(() => normalizeBackupEndpointUrl('', LABEL)).toThrow(/must be a valid URL/);
  });

  it('rejects a non-http(s) protocol', () => {
    expect(() => normalizeBackupEndpointUrl('ftp://files.example.com', LABEL)).toThrow(/must start with http/);
    expect(() => normalizeBackupEndpointUrl('file:///etc/passwd', LABEL)).toThrow(/must start with http/);
  });

  it('rejects embedded credentials', () => {
    expect(() => normalizeBackupEndpointUrl('https://user:pass@s3.example.com', LABEL)).toThrow(/must not include credentials/);
    expect(() => normalizeBackupEndpointUrl('https://user@s3.example.com', LABEL)).toThrow(/must not include credentials/);
  });

  it('rejects a query string or fragment', () => {
    expect(() => normalizeBackupEndpointUrl('https://s3.example.com/?x=1', LABEL)).toThrow(/must not include query or fragment/);
    expect(() => normalizeBackupEndpointUrl('https://s3.example.com/#frag', LABEL)).toThrow(/must not include query or fragment/);
  });

  it('surfaces the caller-supplied label in errors', () => {
    expect(() => normalizeBackupEndpointUrl('nope', 'WebDAV server URL')).toThrow(/^WebDAV server URL must be a valid URL$/);
  });
});

describe('normalizeBackupEndpointUrl — blocked special-use hostnames', () => {
  const blockedHosts = [
    'localhost',
    'localhost.localdomain',
    'db.localhost.localdomain',
    'service.localhost',
    'printer.local',
    'router.home.arpa',
    'api.internal',
    'nas.lan',
    'metadata.google.internal',
    'localtest.me',
    'app.localtest.me',
    'lvh.me',
    'app.lvh.me',
    'vcap.me',
    'app.vcap.me',
    'nip.io',
    '10.0.0.1.nip.io',
    'sslip.io',
    'a.sslip.io',
    'xip.io',
    'a.xip.io',
  ];

  for (const host of blockedHosts) {
    it(`rejects ${host}`, () => {
      expect(() => normalizeBackupEndpointUrl(`https://${host}`, LABEL)).toThrow(/host is not allowed/);
    });
  }

  it('is case-insensitive and tolerates a trailing dot (FQDN)', () => {
    expect(() => normalizeBackupEndpointUrl('https://LocalHost.', LABEL)).toThrow(/host is not allowed/);
    expect(() => normalizeBackupEndpointUrl('https://API.INTERNAL', LABEL)).toThrow(/host is not allowed/);
  });
});

describe('normalizeBackupEndpointUrl — blocked IPv4 ranges', () => {
  const blockedIpv4 = [
    '0.0.0.0',
    '10.1.2.3',
    '127.0.0.1',
    '100.64.0.1', // carrier-grade NAT
    '100.127.255.255',
    '169.254.169.254', // link-local / cloud metadata
    '172.16.0.1',
    '172.31.255.255',
    '192.0.2.1', // TEST-NET-1 (a===192 && b===0)
    '192.168.1.1',
    '198.18.0.1',
    '198.19.0.1',
    '198.51.100.7', // TEST-NET-2
    '203.0.113.5', // TEST-NET-3
    '224.0.0.1', // multicast (a>=224)
    '255.255.255.255',
  ];

  for (const ip of blockedIpv4) {
    it(`rejects ${ip}`, () => {
      expect(() => normalizeBackupEndpointUrl(`https://${ip}`, LABEL)).toThrow(/host is not allowed/);
    });
  }

  it('allows a normal public IPv4 address', () => {
    expect(normalizeBackupEndpointUrl('https://8.8.8.8', LABEL)).toBe('https://8.8.8.8');
    // 172.15 is just below the private 172.16-31 block; 100.63 is below CGNAT.
    expect(normalizeBackupEndpointUrl('https://172.15.0.1', LABEL)).toBe('https://172.15.0.1');
    expect(normalizeBackupEndpointUrl('https://100.63.0.1', LABEL)).toBe('https://100.63.0.1');
  });
});

describe('normalizeBackupEndpointUrl — blocked IPv6 ranges', () => {
  const blockedIpv6 = [
    '[::]', // unspecified
    '[fc00::1]', // unique local
    '[fe80::1]', // link-local
    '[ff02::1]', // multicast
    '[2001:db8::1]', // documentation range
    '[::ffff:127.0.0.1]', // IPv4-mapped
  ];

  for (const ip of blockedIpv6) {
    it(`rejects ${ip}`, () => {
      expect(() => normalizeBackupEndpointUrl(`https://${ip}`, LABEL)).toThrow(/host is not allowed/);
    });
  }
});
