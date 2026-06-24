import { describe, expect, it } from 'vitest';
import { isSafeWebsiteIconContentType, sanitizeDownloadContentType } from '../src/utils/content-type';

// Stored-XSS-via-download mitigation: user-controlled attachment / Send file
// content types must never be served as a type a browser will render and
// execute inline. These are pure functions, so a node unit test suffices.

describe('sanitizeDownloadContentType', () => {
  it('neutralizes script-capable / renderable types to octet-stream', () => {
    for (const type of [
      'text/html',
      'text/html; charset=utf-8',
      'image/svg+xml',
      'application/xhtml+xml',
      'application/xml',
      'text/xml',
      'TEXT/HTML',
      '  Image/SVG+XML ; q=1 ',
    ]) {
      expect(sanitizeDownloadContentType(type)).toBe('application/octet-stream');
    }
  });

  it('preserves benign, non-executable media types', () => {
    expect(sanitizeDownloadContentType('image/png')).toBe('image/png');
    expect(sanitizeDownloadContentType('application/pdf')).toBe('application/pdf');
    expect(sanitizeDownloadContentType('application/octet-stream')).toBe('application/octet-stream');
  });

  it('falls back to octet-stream for empty / missing content types', () => {
    expect(sanitizeDownloadContentType('')).toBe('application/octet-stream');
    expect(sanitizeDownloadContentType(null)).toBe('application/octet-stream');
    expect(sanitizeDownloadContentType(undefined)).toBe('application/octet-stream');
    expect(sanitizeDownloadContentType('   ')).toBe('application/octet-stream');
  });
});

describe('isSafeWebsiteIconContentType', () => {
  it('allows the known raster icon types (case / parameter insensitive)', () => {
    for (const type of [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/x-icon',
      'image/vnd.microsoft.icon',
      'IMAGE/PNG',
      'image/png; charset=binary',
    ]) {
      expect(isSafeWebsiteIconContentType(type)).toBe(true);
    }
  });

  it('rejects html, svg, and anything not on the allowlist', () => {
    for (const type of ['text/html', 'image/svg+xml', 'application/octet-stream', 'application/json', '', null, undefined]) {
      expect(isSafeWebsiteIconContentType(type)).toBe(false);
    }
  });
});
