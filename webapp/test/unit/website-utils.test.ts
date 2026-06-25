import { describe, expect, it } from 'vitest';
import { firstCipherUri, hostFromUri, websiteIconUrl } from '@/lib/website-utils';
import type { Cipher } from '@/lib/types';

function loginCipher(uris: Array<{ uri?: string; decUri?: string }>): Cipher {
  return { login: { uris } } as unknown as Cipher;
}

describe('firstCipherUri', () => {
  it('returns the first non-empty decrypted URI', () => {
    expect(firstCipherUri(loginCipher([{ decUri: '  https://example.com  ' }]))).toBe(
      'https://example.com'
    );
  });

  it('skips blank URIs', () => {
    expect(firstCipherUri(loginCipher([{ uri: '   ' }, { uri: 'https://b.test' }]))).toBe(
      'https://b.test'
    );
  });

  it('returns empty string when there are no URIs', () => {
    expect(firstCipherUri({ login: { uris: [] } } as unknown as Cipher)).toBe('');
  });
});

describe('hostFromUri', () => {
  it('extracts the hostname, adding a scheme when missing', () => {
    expect(hostFromUri('example.com/login')).toBe('example.com');
    expect(hostFromUri('https://sub.example.com:8443/x')).toBe('sub.example.com');
  });

  it('returns empty string for blank or invalid input', () => {
    expect(hostFromUri('')).toBe('');
    expect(hostFromUri('   ')).toBe('');
  });
});

describe('websiteIconUrl', () => {
  it('builds an encoded icon path with a 404 fallback', () => {
    expect(websiteIconUrl('example.com')).toBe('/icons/example.com/icon.png?fallback=404');
  });
});
