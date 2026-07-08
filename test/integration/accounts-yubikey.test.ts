import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// YubiKey OTP two-factor provider lifecycle, focused on the paths that never
// contact Yubico's validation service: configuring the Yubico API credentials,
// enrolling bare public-id keys, reading the settings, the login challenge, and
// disabling the provider. Real worker + D1, no network mocks needed because the
// public-id enrollment path short-circuits before any outbound call.
let session: Session;
let token: string;

// Two well-formed YubiKey public identifiers (exactly 12 modhex chars each).
const PUBLIC_ID_1 = 'cbdefghijkln';
const PUBLIC_ID_2 = 'ccccbbbbdddd';

beforeAll(async () => {
  session = await authenticate('yubikey');
  token = session.accessToken;
});

function loginForm(fields: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams({
      grant_type: 'password',
      username: session.account.email,
      password: session.account.masterPasswordHash,
      scope: 'api offline_access',
      client_id: 'web',
      deviceType: '10',
      deviceIdentifier: session.account.deviceIdentifier,
      deviceName: 'integration-test',
      ...fields,
    }).toString(),
  });
}

describe('YubiKey get-yubikey settings', () => {
  it('rejects reading settings with a wrong master password', async () => {
    const res = await api('POST', '/api/two-factor/get-yubikey', token, {
      masterPasswordHash: 'wrong-password',
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('user verification failed');
  });

  it('returns the (disabled) YubiKey settings shape after verification', async () => {
    const res = await api('POST', '/api/two-factor/get-yubikey', token, {
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.Object).toBe('twoFactorYubiKey');
    expect(body.Enabled).toBe(false);
    expect(body.YubicoConfigured).toBe(false);
    expect(body.Key1).toBeNull();
  });
});

describe('YubiKey config (Yubico API credentials)', () => {
  it('rejects config with a wrong master password', async () => {
    const res = await api('PUT', '/api/two-factor/yubikey/config', token, {
      yubicoClientId: '4242',
      yubicoSecretKey: btoa('secret-material'),
      masterPasswordHash: 'wrong-password',
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('user verification failed');
  });

  it('requires a client id', async () => {
    const res = await api('PUT', '/api/two-factor/yubikey/config', token, {
      yubicoSecretKey: btoa('secret-material'),
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('client id is required');
  });

  it('stores the Yubico client id and secret, surfacing them in settings', async () => {
    const secretKey = btoa('secret-material');
    const res = await api('PUT', '/api/two-factor/yubikey/config', token, {
      yubicoClientId: ' 4242 ',
      yubicoSecretKey: secretKey,
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.YubicoConfigured).toBe(true);
    expect(body.YubicoClientId).toBe('4242'); // trimmed
    expect(body.YubicoSecretKey).toBe(secretKey);
  });
});

describe('YubiKey enable/disable lifecycle', () => {
  it('rejects enrolling with no keys supplied', async () => {
    const res = await api('PUT', '/api/two-factor/yubikey', token, {
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('at least one yubikey otp');
  });

  it('rejects a malformed key value', async () => {
    const res = await api('PUT', '/api/two-factor/yubikey', token, {
      key1: 'not-a-valid-modhex-otp!!',
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid yubikey otp');
  });

  it('rejects enrolling with a wrong master password', async () => {
    const res = await api('PUT', '/api/two-factor/yubikey', token, {
      key1: PUBLIC_ID_1,
      masterPasswordHash: 'wrong-password',
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('user verification failed');
  });

  it('enrolls bare public-id keys and reports enabled', async () => {
    const res = await api('PUT', '/api/two-factor/yubikey', token, {
      key1: PUBLIC_ID_1.toUpperCase(), // case-insensitive, stored lowercased
      key3: `  ${PUBLIC_ID_2}  `, // whitespace tolerated
      nfc: true,
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.Enabled).toBe(true);
    expect(body.Key1).toBe(PUBLIC_ID_1);
    expect(body.Key3).toBe(PUBLIC_ID_2);
    expect(body.Nfc).toBe(true);
  });

  it('challenges a plain password login once YubiKey is enabled', async () => {
    const challenged = (await (await loginForm()).json()) as any;
    expect(challenged.access_token).toBeUndefined();
    // Provider 3 (YubiKey) must be offered in the challenge.
    expect(Object.keys(challenged.TwoFactorProviders2 ?? {})).toContain('3');
  });

  it('reflects the enrolled keys and stored config in get-yubikey', async () => {
    const res = await api('POST', '/api/two-factor/get-yubikey', token, {
      masterPasswordHash: session.account.masterPasswordHash,
    });
    const body = (await res.json()) as any;
    expect(body.Enabled).toBe(true);
    expect(body.Key1).toBe(PUBLIC_ID_1);
    expect(body.YubicoConfigured).toBe(true);
  });

  it('disables YubiKey via DELETE with provider type 3', async () => {
    const res = await api('DELETE', '/api/two-factor/yubikey', token, {
      type: 3,
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(200);

    const settings = (await (await api('POST', '/api/two-factor/get-yubikey', token, {
      masterPasswordHash: session.account.masterPasswordHash,
    })).json()) as any;
    expect(settings.Enabled).toBe(false);
    expect(settings.Key1).toBeNull();

    // With no 2FA enrolled, a plain password login issues a token again.
    const ok = (await (await loginForm()).json()) as any;
    expect(typeof ok.access_token).toBe('string');
  });
});

describe('YubiKey bootstrap guards', () => {
  it('rejects bootstrap with a wrong master password (before any network call)', async () => {
    const res = await api('POST', '/api/two-factor/yubikey/bootstrap', token, {
      otp: PUBLIC_ID_1 + 'cbdefghijklnrtuvcbdefghijklnrtuv',
      masterPasswordHash: 'wrong-password',
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('user verification failed');
  });

  it('rejects bootstrap with a malformed OTP (before any network call)', async () => {
    const res = await api('POST', '/api/two-factor/yubikey/bootstrap', token, {
      otp: 'too-short',
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid yubikey otp');
  });
});
