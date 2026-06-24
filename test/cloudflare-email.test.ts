import { describe, expect, it } from 'vitest';
import {
  CloudflareEmailConfigError,
  cloudflareErrorDetail,
  getCloudflareEmailClient,
  isCloudflareEmailConfigured,
  isCloudflareFailure,
  readCloudflareRuleId,
} from '../src/services/cloudflare-email';
import type { Env } from '../src/types';

// Pure, no-HTTP behavior. The actual Email Routing API calls (forward/drop/
// delete rules) are exercised end-to-end through the worker in
// test/integration/email-aliases.test.ts against a faithful in-memory
// Cloudflare server, matching the project's no-mocks convention.
describe('isCloudflareEmailConfigured', () => {
  it('reflects presence of both credentials', () => {
    expect(isCloudflareEmailConfigured({ CF_API_TOKEN: 'tok', CF_ZONE_ID: 'z' } as Env)).toBe(true);
    expect(isCloudflareEmailConfigured({} as Env)).toBe(false);
    expect(isCloudflareEmailConfigured({ CF_API_TOKEN: 'tok' } as Env)).toBe(false);
    expect(isCloudflareEmailConfigured({ CF_ZONE_ID: 'z' } as Env)).toBe(false);
  });
});

describe('getCloudflareEmailClient', () => {
  it('throws a config error without credentials', () => {
    expect(() => getCloudflareEmailClient({} as Env)).toThrow(CloudflareEmailConfigError);
    expect(() => getCloudflareEmailClient({ CF_API_TOKEN: 'tok' } as Env)).toThrow(CloudflareEmailConfigError);
  });
});

describe('isCloudflareFailure', () => {
  it('is true only for an object with success === false', () => {
    expect(isCloudflareFailure({ success: false })).toBe(true);
    expect(isCloudflareFailure({ success: true })).toBe(false);
    expect(isCloudflareFailure({})).toBe(false);
    expect(isCloudflareFailure(null)).toBe(false);
    expect(isCloudflareFailure('nope')).toBe(false);
  });
});

describe('cloudflareErrorDetail', () => {
  it('prefers the first error message, else falls back to the HTTP status', () => {
    expect(cloudflareErrorDetail({ errors: [{ message: 'boom' }] }, 400)).toBe('boom');
    expect(cloudflareErrorDetail({ errors: [] }, 401)).toBe('HTTP 401');
    expect(cloudflareErrorDetail({ errors: [{}] }, 402)).toBe('HTTP 402');
    expect(cloudflareErrorDetail({ errors: [{ message: '' }] }, 403)).toBe('HTTP 403');
    expect(cloudflareErrorDetail({ errors: 'nope' }, 404)).toBe('HTTP 404');
    expect(cloudflareErrorDetail(null, 500)).toBe('HTTP 500');
  });
});

describe('readCloudflareRuleId', () => {
  it('returns a non-empty string id or null', () => {
    expect(readCloudflareRuleId({ result: { id: 'rule-1' } })).toBe('rule-1');
    expect(readCloudflareRuleId({ result: {} })).toBeNull();
    expect(readCloudflareRuleId({ result: null })).toBeNull();
    expect(readCloudflareRuleId({ result: { id: 5 } })).toBeNull();
    expect(readCloudflareRuleId({ result: { id: '' } })).toBeNull();
    expect(readCloudflareRuleId(null)).toBeNull();
  });
});
