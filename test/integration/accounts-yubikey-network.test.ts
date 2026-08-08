import { SELF } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// v1.8.0 YubiKey paths that DO contact Yubico's HTTP endpoints: the admin
// bootstrap that issues API credentials from getapikey, and enrolling a full
// OTP (not a bare public id) which must be signature-verified against the
// validation server. Yubico's outbound calls are stubbed at the worker's global
// fetch; the first-registered account is an admin.
let session: Session;
let token: string;

// A well-formed YubiKey OTP: 12-char public id + 32-char rolling token.
const PUBLIC_ID = 'cbdefghijkln';
const FULL_OTP = PUBLIC_ID + 'cbdefghijklnrtuvcbdefghijklnrtuv';
const SECRET = btoa('yubico-shared-secret-material-0');

function apiKeyHtml(clientId: string, secret: string): string {
  return `<table>
    <tr><th>Client ID:</th><td><b>${clientId}</b></td></tr>
    <tr><th>Secret key:</th><td><code>${secret}</code></td></tr>
  </table>`;
}

// Re-implement Yubico's validation signature so the mocked validation server can
// return a response the worker accepts.
function canonical(entries: Array<[string, string]>): string {
  return entries
    .slice()
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}
async function hmacSha1Base64(base64Key: string, message: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  let binary = '';
  for (const byte of sig) binary += String.fromCharCode(byte);
  return btoa(binary);
}
async function signedValidation(url: string): Promise<Response> {
  const params = new URL(url).searchParams;
  const fields: Record<string, string> = {
    otp: params.get('otp')!,
    nonce: params.get('nonce')!,
    status: 'OK',
    t: '2024-01-01T00:00:00Z0000',
  };
  const entries = Object.entries(fields);
  const h = await hmacSha1Base64(SECRET, canonical(entries));
  const body = [...entries, ['h', h]].map(([k, v]) => `${k}=${v}`).join('\r\n');
  return new Response(body, { status: 200 });
}

// Route the stubbed fetch by host: getapikey issues credentials, the validation
// endpoint verifies an OTP. Anything else is a hard failure so a stray outbound
// call surfaces loudly.
function stubYubicoFetch(clientId = '4242'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (target.startsWith('https://upgrade.yubico.com/getapikey/')) {
        return new Response(apiKeyHtml(clientId, SECRET), { status: 200 });
      }
      if (target.startsWith('https://api.yubico.com/wsapi/')) {
        return signedValidation(target);
      }
      throw new Error(`unexpected outbound fetch: ${target}`);
    })
  );
}

beforeAll(async () => {
  session = await authenticate('yubinet');
  token = session.accessToken;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('admin YubiKey bootstrap (issues Yubico API credentials)', () => {
  it('issues and stores credentials from a valid OTP, reporting configured', async () => {
    stubYubicoFetch('5150');
    const res = await api('POST', '/api/two-factor/yubikey/bootstrap', token, {
      otp: FULL_OTP,
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { YubicoConfigured: boolean; YubicoClientId: string };
    expect(body.YubicoConfigured).toBe(true);
    expect(body.YubicoClientId).toBe('5150');
  });

  it('rejects when getapikey returns no client id', async () => {
    // Overwrite the stub so getapikey yields HTML without a client id.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>no credentials</html>', { status: 200 }))
    );
    const res = await api('POST', '/api/two-factor/yubikey/bootstrap', token, {
      otp: PUBLIC_ID + 'rtuvcbdefghijklnrtuvcbdefghijkln',
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('unable to initialize');
  });
});

describe('YubiKey enrollment with a full OTP (signature-verified)', () => {
  it('enrolls a full OTP after configuring credentials and validating it', async () => {
    stubYubicoFetch('4242');
    // Reconfigure credentials via the admin bootstrap first (idempotent for an
    // admin), then enroll the full OTP which triggers signed validation.
    await api('POST', '/api/two-factor/yubikey/bootstrap', token, {
      otp: FULL_OTP,
      masterPasswordHash: session.account.masterPasswordHash,
    });
    const res = await api('PUT', '/api/two-factor/yubikey', token, {
      key1: FULL_OTP,
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { Enabled: boolean; Key1: string };
    expect(body.Enabled).toBe(true);
    // Only the 12-char public id is stored, never the full OTP.
    expect(body.Key1).toBe(PUBLIC_ID);
  });
});

describe('YubiKey two-factor login (signature-verified at token grant)', () => {
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

  it('challenges a plain login then issues a token for a validated YubiKey OTP', async () => {
    stubYubicoFetch('4242');
    // Ensure credentials are configured and the account has a YubiKey enrolled.
    await api('POST', '/api/two-factor/yubikey/bootstrap', token, {
      otp: FULL_OTP,
      masterPasswordHash: session.account.masterPasswordHash,
    });
    await api('PUT', '/api/two-factor/yubikey', token, {
      key1: FULL_OTP,
      masterPasswordHash: session.account.masterPasswordHash,
    });

    // A plain password login is challenged for provider 3 (YubiKey).
    const challenged = (await (await loginForm()).json()) as {
      access_token?: string;
      TwoFactorProviders2?: Record<string, unknown>;
    };
    expect(challenged.access_token).toBeUndefined();
    expect(Object.keys(challenged.TwoFactorProviders2 ?? {})).toContain('3');

    // Supplying the (signature-verified) full OTP as the second factor logs in.
    const ok = (await (await loginForm({
      twoFactorProvider: '3',
      twoFactorToken: FULL_OTP,
    }).then((r) => r)).json()) as { access_token?: string };
    expect(typeof ok.access_token).toBe('string');
  });

  it('rejects a YubiKey second factor whose public id is not enrolled', async () => {
    stubYubicoFetch('4242');
    const other = 'ccccbbbbdddd' + 'cbdefghijklnrtuvcbdefghijklnrtuv';
    const res = (await (await loginForm({
      twoFactorProvider: '3',
      twoFactorToken: other,
    })).json()) as { access_token?: string };
    // A non-enrolled public id never reaches the validation server.
    expect(res.access_token).toBeUndefined();
  });
});
