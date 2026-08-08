import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env, User } from '../src/types';
import {
  isYubiKeyEnabled,
  isYubiKeyPublicId,
  normalizeYubiKeyOtp,
  requestYubicoApiCredentials,
  userYubiKeyPublicIds,
  verifyYubicoOtp,
  yubiKeyPublicIdFromOtp,
} from '../src/utils/yubico-otp';

// ---------------------------------------------------------------------------
// Fixtures. The modhex alphabet the server accepts is `cbdefghijklnrtuv`.
// A YubiKey public identifier is exactly 12 modhex characters; a full OTP is
// 32-48 modhex characters (public id + 32-char rolling token).
// ---------------------------------------------------------------------------
const PUBLIC_ID = 'cbdefghijkln'; // 12 modhex chars
const OTP_BODY = 'cbdefghijklnrtuvcbdefghijklnrtuv'; // 32 modhex chars
const FULL_OTP = PUBLIC_ID + OTP_BODY; // 44 modhex chars, a well-formed OTP
// A base64 shared secret (Yubico secret keys are base64). Built at runtime so
// scanners don't treat it as a committed credential.
const SECRET = btoa('yubico-shared-secret-material-0');

// Re-implement the exact signature scheme the server verifies against so the
// mocked validation server can return correctly-signed responses. If either the
// canonicalisation or the HMAC here disagreed with the source, the happy-path
// tests below would fail.
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

// Build a Yubico validation response body (key=value lines) with a correct
// signature over every field except `h`.
async function signedResponseBody(
  secret: string,
  fields: Record<string, string>
): Promise<string> {
  const entries = Object.entries(fields);
  const h = await hmacSha1Base64(secret, canonical(entries));
  return [...entries, ['h', h]].map(([k, v]) => `${k}=${v}`).join('\r\n');
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    yubikeyKey1: null,
    yubikeyKey2: null,
    yubikeyKey3: null,
    yubikeyKey4: null,
    yubikeyKey5: null,
    ...overrides,
  } as User;
}

function okResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('normalizeYubiKeyOtp', () => {
  it('lowercases, strips all whitespace, and coerces nullish to empty', () => {
    expect(normalizeYubiKeyOtp('  CB de\tFG\nHI  ')).toBe('cbdefghi');
    expect(normalizeYubiKeyOtp(undefined as unknown as string)).toBe('');
    expect(normalizeYubiKeyOtp(null as unknown as string)).toBe('');
    expect(normalizeYubiKeyOtp('')).toBe('');
  });
});

describe('isYubiKeyPublicId', () => {
  it('accepts exactly 12 modhex chars (case/space-insensitive)', () => {
    expect(isYubiKeyPublicId(PUBLIC_ID)).toBe(true);
    expect(isYubiKeyPublicId(PUBLIC_ID.toUpperCase())).toBe(true);
    expect(isYubiKeyPublicId(`  ${PUBLIC_ID}  `)).toBe(true);
  });

  it('rejects wrong length or non-modhex characters', () => {
    expect(isYubiKeyPublicId('cbdefghijkl')).toBe(false); // 11 chars
    expect(isYubiKeyPublicId('cbdefghijklnr')).toBe(false); // 13 chars
    expect(isYubiKeyPublicId('cbdefghijklm')).toBe(false); // 'm' is not modhex
    expect(isYubiKeyPublicId('cbdefghijk1n')).toBe(false); // digit is not modhex
    expect(isYubiKeyPublicId('')).toBe(false);
  });
});

describe('yubiKeyPublicIdFromOtp', () => {
  it('returns a bare 12-char public id unchanged', () => {
    expect(yubiKeyPublicIdFromOtp(PUBLIC_ID)).toBe(PUBLIC_ID);
  });

  it('extracts the leading 12 chars from a full OTP', () => {
    expect(yubiKeyPublicIdFromOtp(FULL_OTP)).toBe(PUBLIC_ID);
    expect(yubiKeyPublicIdFromOtp(FULL_OTP.toUpperCase())).toBe(PUBLIC_ID);
  });

  it('rejects strings whose length is neither 12 nor within 32-48', () => {
    expect(yubiKeyPublicIdFromOtp('cbdefghijklnrtuv')).toBeNull(); // 16 chars
    expect(yubiKeyPublicIdFromOtp('cb')).toBeNull(); // too short
    expect(yubiKeyPublicIdFromOtp(PUBLIC_ID + OTP_BODY + OTP_BODY)).toBeNull(); // 76 chars, too long
  });

  it('rejects in-range strings that contain non-modhex characters', () => {
    const bad = `abcm${'c'.repeat(36)}`; // 40 chars but contains non-modhex a, m
    expect(bad.length).toBeGreaterThanOrEqual(32);
    expect(yubiKeyPublicIdFromOtp(bad)).toBeNull();
  });
});

describe('userYubiKeyPublicIds / isYubiKeyEnabled', () => {
  it('collects, trims, lowercases and drops empty slots', () => {
    const user = makeUser({
      yubikeyKey1: '  CBDEFGHIJKLN ',
      yubikeyKey2: '',
      yubikeyKey3: null,
      yubikeyKey4: 'ccccbbbbdddd',
      yubikeyKey5: '   ',
    });
    expect(userYubiKeyPublicIds(user)).toEqual(['cbdefghijkln', 'ccccbbbbdddd']);
    expect(isYubiKeyEnabled(user)).toBe(true);
  });

  it('reports not-enabled when no slots hold a value', () => {
    const user = makeUser();
    expect(userYubiKeyPublicIds(user)).toEqual([]);
    expect(isYubiKeyEnabled(user)).toBe(false);
  });
});

describe('requestYubicoApiCredentials', () => {
  it('rejects a malformed OTP before making any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestYubicoApiCredentials('user@vault.test', 'not-an-otp')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the getapikey form and parses client id + secret from the HTML', async () => {
    const html = `
      <table>
        <tr><th>Client ID:</th><td><b>4242</b></td></tr>
        <tr><th>Secret key:</th><td><code>${SECRET}</code></td></tr>
      </table>`;
    const fetchMock = vi.fn(async () => okResponse(html));
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestYubicoApiCredentials('  USER@Vault.test ', `  ${FULL_OTP.toUpperCase()} `);
    expect(result).toEqual({ clientId: '4242', secretKey: SECRET });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://upgrade.yubico.com/getapikey/');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = init.body as URLSearchParams;
    expect(body.get('email')).toBe('user@vault.test'); // trimmed + lowercased
    expect(body.get('otp')).toBe(FULL_OTP); // normalized
    expect(body.get('terms_conditions')).toBe('consented');
  });

  it('returns null when the getapikey request is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await expect(requestYubicoApiCredentials('user@vault.test', FULL_OTP)).resolves.toBeNull();
  });

  it('returns null when the HTML has no client id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse('<html>no credentials here</html>')));
    await expect(requestYubicoApiCredentials('user@vault.test', FULL_OTP)).resolves.toBeNull();
  });
});

describe('verifyYubicoOtp', () => {
  it('returns false for a malformed OTP without contacting the server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      verifyYubicoOtp({} as Env, 'too-short', { clientId: '1', secretKey: '' })
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns false when no client id is available', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(verifyYubicoOtp({} as Env, FULL_OTP, { clientId: '', secretKey: '' })).resolves.toBe(false);
    await expect(verifyYubicoOtp({} as Env, FULL_OTP, null)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('verifies a signed OK response and sends id/otp/nonce/h in the request', async () => {
    let seenUrl = '';
    const fetchMock = vi.fn(async (input: string) => {
      seenUrl = input;
      const params = new URL(input).searchParams;
      const body = await signedResponseBody(SECRET, {
        otp: params.get('otp')!,
        nonce: params.get('nonce')!,
        status: 'OK',
        t: '2024-01-01T00:00:00Z0000',
        sl: '100',
      });
      return okResponse(body);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      verifyYubicoOtp({} as Env, FULL_OTP, { clientId: '4242', secretKey: SECRET })
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const params = new URL(seenUrl).searchParams;
    expect(seenUrl.startsWith('https://api.yubico.com/wsapi/2.0/verify?')).toBe(true);
    expect(params.get('id')).toBe('4242');
    expect(params.get('otp')).toBe(FULL_OTP);
    expect(params.get('nonce')).toMatch(/^[0-9a-f]{32}$/);
    expect(params.get('h')).toBeTruthy(); // request is signed when a secret is present
  });

  it('requires a secret key: an empty secret is rejected without any request', async () => {
    // v1.8.0: OTP validation is always the signed flow. A configured client id
    // with no secret key is refused before contacting the validation server.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      verifyYubicoOtp({} as Env, FULL_OTP, { clientId: '4242', secretKey: '' })
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-OK validation status (e.g. REPLAYED_OTP)', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const params = new URL(input).searchParams;
      const body = await signedResponseBody(SECRET, {
        otp: params.get('otp')!,
        nonce: params.get('nonce')!,
        status: 'REPLAYED_OTP',
      });
      return okResponse(body);
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      verifyYubicoOtp({} as Env, FULL_OTP, { clientId: '4242', secretKey: SECRET })
    ).resolves.toBe(false);
  });

  it('rejects when the server echoes a different nonce', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const params = new URL(input).searchParams;
      const body = await signedResponseBody(SECRET, {
        otp: params.get('otp')!,
        nonce: 'ffffffffffffffffffffffffffffffff',
        status: 'OK',
      });
      return okResponse(body);
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      verifyYubicoOtp({} as Env, FULL_OTP, { clientId: '4242', secretKey: SECRET })
    ).resolves.toBe(false);
  });

  it('rejects when the server echoes a different otp', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const params = new URL(input).searchParams;
      const body = await signedResponseBody(SECRET, {
        otp: OTP_BODY, // different from the submitted FULL_OTP
        nonce: params.get('nonce')!,
        status: 'OK',
      });
      return okResponse(body);
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      verifyYubicoOtp({} as Env, FULL_OTP, { clientId: '4242', secretKey: SECRET })
    ).resolves.toBe(false);
  });

  it('rejects a response whose signature does not match', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const params = new URL(input).searchParams;
      // Sign with the WRONG secret so the server-side signature check fails.
      const wrongSecret = btoa('a-completely-different-secret-x');
      const body = await signedResponseBody(wrongSecret, {
        otp: params.get('otp')!,
        nonce: params.get('nonce')!,
        status: 'OK',
      });
      return okResponse(body);
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      verifyYubicoOtp({} as Env, FULL_OTP, { clientId: '4242', secretKey: SECRET })
    ).resolves.toBe(false);
  });

  it('rejects an otherwise-valid response missing the h signature field', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const params = new URL(input).searchParams;
      const body = `otp=${params.get('otp')}\r\nnonce=${params.get('nonce')}\r\nstatus=OK`;
      return okResponse(body);
    });
    vi.stubGlobal('fetch', fetchMock);
    // A secret is configured, so an unsigned response must be refused.
    await expect(
      verifyYubicoOtp({} as Env, FULL_OTP, { clientId: '4242', secretKey: SECRET })
    ).resolves.toBe(false);
  });

  it('returns false when the secret key is not valid base64 (HMAC build throws)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // '@@@@' cannot be atob-decoded; building the request signature throws and
    // the function bails out before any network call.
    await expect(
      verifyYubicoOtp({} as Env, FULL_OTP, { clientId: '4242', secretKey: '@@@@' })
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips a non-ok endpoint and falls through to the next configured URL', async () => {
    const env = {
      globalSettings__yubico__validationUrls: 'https://first.test/verify, https://second.test/verify',
    } as unknown as Env;
    const seen: string[] = [];
    const fetchMock = vi.fn(async (input: string) => {
      const origin = new URL(input).origin;
      seen.push(origin);
      if (origin === 'https://first.test') return new Response('down', { status: 503 });
      const params = new URL(input).searchParams;
      const body = await signedResponseBody(SECRET, {
        otp: params.get('otp')!,
        nonce: params.get('nonce')!,
        status: 'OK',
      });
      return okResponse(body);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(verifyYubicoOtp(env, FULL_OTP, { clientId: '4242', secretKey: SECRET })).resolves.toBe(true);
    expect(seen).toEqual(['https://first.test', 'https://second.test']);
  });

  it('continues past a fetch that throws and returns false when all fail', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      verifyYubicoOtp({} as Env, FULL_OTP, { clientId: '4242', secretKey: SECRET })
    ).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

});
