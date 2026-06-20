import { describe, expect, it } from 'vitest';
import {
  readActingDeviceIdentifier,
  readAuthRequestDeviceInfo,
  readKnownDeviceProbe,
} from '../src/utils/device';

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/', { headers });
}

function base64Url(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('readAuthRequestDeviceInfo', () => {
  it('prefers body fields and supports snake_case aliases', () => {
    const info = readAuthRequestDeviceInfo(
      { device_identifier: 'dev-abc', device_name: 'My Phone', device_type: '7' },
      request()
    );
    expect(info).toEqual({ deviceIdentifier: 'dev-abc', deviceName: 'My Phone', deviceType: 7 });
  });

  it('falls back to request headers when body is empty', () => {
    const info = readAuthRequestDeviceInfo(
      {},
      request({
        'X-Device-Identifier': 'hdr-id',
        'X-Device-Name': 'Header Device',
        'Device-Type': '9',
      })
    );
    expect(info).toEqual({ deviceIdentifier: 'hdr-id', deviceName: 'Header Device', deviceType: 9 });
  });

  it('applies defaults for a missing name and type', () => {
    const info = readAuthRequestDeviceInfo({}, request());
    expect(info.deviceIdentifier).toBeNull();
    expect(info.deviceName).toBe('Unknown device');
    expect(info.deviceType).toBe(14);
  });

  it('defaults the device type when it is not a valid number', () => {
    const info = readAuthRequestDeviceInfo({ deviceType: 'not-a-number' }, request());
    expect(info.deviceType).toBe(14);
  });

  it('truncates over-long identifiers and names to 128 chars', () => {
    const info = readAuthRequestDeviceInfo(
      { deviceIdentifier: 'a'.repeat(200), deviceName: 'b'.repeat(200) },
      request()
    );
    expect(info.deviceIdentifier).toHaveLength(128);
    expect(info.deviceName).toHaveLength(128);
  });
});

describe('readKnownDeviceProbe', () => {
  it('decodes a base64url-encoded email header', () => {
    const probe = readKnownDeviceProbe(
      request({
        'X-Request-Email': base64Url('User@Example.com'),
        'X-Device-Identifier': 'dev-1',
      })
    );
    expect(probe).toEqual({ email: 'user@example.com', deviceIdentifier: 'dev-1' });
  });

  it('falls back to the raw header when it is not valid base64', () => {
    const probe = readKnownDeviceProbe(request({ 'X-Request-Email': 'plain@example.com' }));
    expect(probe.email).toBe('plain@example.com');
  });

  it('returns nulls when headers are absent', () => {
    expect(readKnownDeviceProbe(request())).toEqual({ email: null, deviceIdentifier: null });
  });
});

describe('readActingDeviceIdentifier', () => {
  it('reads and normalizes the acting device header', () => {
    expect(
      readActingDeviceIdentifier(request({ 'X-NodeWarden-Acting-Device-Id': '  act-1  ' }))
    ).toBe('act-1');
  });

  it('returns null when the header is missing', () => {
    expect(readActingDeviceIdentifier(request())).toBeNull();
  });
});
