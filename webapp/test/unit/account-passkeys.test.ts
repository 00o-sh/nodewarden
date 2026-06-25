import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountPasskeyPrfUnavailableError,
  assertAccountPasskey,
  buildAccountPasskeyPrfKeySet,
  buildAccountPasskeyPrfKeySetFromPrfKey,
  createAccountPasskeyCredential,
  unlockVaultKeyWithAccountPasskeyPrf,
} from '@/lib/account-passkeys';
import { base64ToBytes, bytesToBase64 } from '@/lib/crypto';
import { t } from '@/lib/i18n';

// jsdom provides DOMException but none of the WebAuthn classes nor
// navigator.credentials, so the module's `instanceof PublicKeyCredential`
// (etc.) guards and the navigator calls have to be stubbed here. We install
// minimal stand-in classes on the global scope and make our fake credential
// objects *real* instances of them, so the module's own branching/encoding
// logic runs against realistically-shaped data.

const g = globalThis as any;

class FakePublicKeyCredential {
  id: string;
  rawId: ArrayBuffer;
  type: string;
  response: any;
  private _ext: any;
  constructor(init: {
    id?: string;
    rawId?: ArrayBuffer;
    type?: string;
    response?: any;
    extensionResults?: any;
  }) {
    this.id = init.id ?? 'cred-id';
    this.rawId = init.rawId ?? new Uint8Array([1, 2, 3, 4]).buffer;
    this.type = init.type ?? 'public-key';
    this.response = init.response;
    this._ext = init.extensionResults ?? {};
  }
  getClientExtensionResults() {
    return this._ext;
  }
}

class FakeAuthenticatorAssertionResponse {
  authenticatorData: ArrayBuffer;
  signature: ArrayBuffer;
  clientDataJSON: ArrayBuffer;
  userHandle: ArrayBuffer | null;
  constructor(init: {
    authenticatorData?: ArrayBuffer;
    signature?: ArrayBuffer;
    clientDataJSON?: ArrayBuffer;
    userHandle?: ArrayBuffer | null;
  } = {}) {
    this.authenticatorData = init.authenticatorData ?? new Uint8Array([10, 11]).buffer;
    this.signature = init.signature ?? new Uint8Array([20, 21]).buffer;
    this.clientDataJSON = init.clientDataJSON ?? new Uint8Array([30, 31]).buffer;
    this.userHandle = init.userHandle ?? null;
  }
}

class FakeAuthenticatorAttestationResponse {
  attestationObject: ArrayBuffer;
  clientDataJSON: ArrayBuffer;
  private _transports?: string[];
  constructor(init: {
    attestationObject?: ArrayBuffer;
    clientDataJSON?: ArrayBuffer;
    transports?: string[];
  } = {}) {
    this.attestationObject = init.attestationObject ?? new Uint8Array([40, 41]).buffer;
    this.clientDataJSON = init.clientDataJSON ?? new Uint8Array([50, 51]).buffer;
    this._transports = init.transports;
  }
  getTransports() {
    return this._transports ?? [];
  }
}

function buf(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function prfExtensionResult(first: ArrayBuffer) {
  return { prf: { results: { first } } };
}

function installWebAuthn() {
  g.PublicKeyCredential = FakePublicKeyCredential;
  g.AuthenticatorAssertionResponse = FakeAuthenticatorAssertionResponse;
  g.AuthenticatorAttestationResponse = FakeAuthenticatorAttestationResponse;
  if (g.window) {
    g.window.PublicKeyCredential = FakePublicKeyCredential;
  }
  const credentials = { create: vi.fn(), get: vi.fn() };
  Object.defineProperty(g.navigator, 'credentials', {
    value: credentials,
    configurable: true,
    writable: true,
  });
  return credentials;
}

function uninstallWebAuthn() {
  delete g.PublicKeyCredential;
  delete g.AuthenticatorAssertionResponse;
  delete g.AuthenticatorAttestationResponse;
  if (g.window) delete g.window.PublicKeyCredential;
  try {
    Object.defineProperty(g.navigator, 'credentials', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  } catch {
    /* ignore */
  }
}

// base64url of bytes, matching the module's internal encoding (no padding,
// - and _ instead of + and /).
function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// A 32-byte challenge that contains a '+' and '/' worth of bits once base64'd
// so we exercise the url-safe replacement on the way back in.
const CHALLENGE_BYTES = new Uint8Array(Array.from({ length: 32 }, (_, i) => (i * 7 + 251) & 0xff));
const USER_ID_BYTES = new Uint8Array([0xfb, 0xff, 0x00, 0x10]);
const EXCLUDE_ID_BYTES = new Uint8Array([0x3f, 0x40, 0x41]);

describe('AccountPasskeyPrfUnavailableError', () => {
  it('is an Error with the right name and translated message', () => {
    const err = new AccountPasskeyPrfUnavailableError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AccountPasskeyPrfUnavailableError');
    expect(err.message).toBe(t('txt_account_passkey_direct_unlock_unavailable_error'));
  });
});

describe('account-passkeys (no WebAuthn available)', () => {
  beforeEach(() => {
    uninstallWebAuthn();
  });

  it('assertAccountPasskey throws when the browser lacks WebAuthn', async () => {
    await expect(
      assertAccountPasskey({ options: {}, token: 'tok' })
    ).rejects.toThrow(t('txt_passkey_browser_not_supported'));
  });

  it('createAccountPasskeyCredential throws when the browser lacks WebAuthn', async () => {
    await expect(
      createAccountPasskeyCredential({ options: {}, token: 'tok' })
    ).rejects.toThrow(t('txt_passkey_browser_not_supported'));
  });
});

describe('createAccountPasskeyCredential', () => {
  let credentials: { create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    credentials = installWebAuthn();
  });
  afterEach(() => {
    uninstallWebAuthn();
    vi.clearAllMocks();
  });

  function makeCreationOptions(overrides: Record<string, any> = {}) {
    return {
      challenge: bytesToBase64Url(CHALLENGE_BYTES),
      rp: { id: 'example.com', name: 'Example' },
      user: { id: bytesToBase64Url(USER_ID_BYTES), name: 'a@b.c', displayName: 'A' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      excludeCredentials: [{ id: bytesToBase64Url(EXCLUDE_ID_BYTES), type: 'public-key' }],
      timeout: 60000,
      authenticatorSelection: { userVerification: 'required' },
      ...overrides,
    };
  }

  it('clones options to ArrayBuffers, requests prf, and encodes the attestation', async () => {
    const credential = new FakePublicKeyCredential({
      id: 'new-cred',
      rawId: buf([9, 8, 7, 6]),
      response: new FakeAuthenticatorAttestationResponse({
        attestationObject: buf([1, 2, 3]),
        clientDataJSON: buf([4, 5, 6]),
        transports: ['internal', 'hybrid'],
      }),
      extensionResults: { prf: { enabled: true } },
    });
    credentials.create.mockResolvedValue(credential);

    const result = await createAccountPasskeyCredential({
      options: makeCreationOptions(),
      token: 'attest-token',
    });

    // The native options passed to navigator.credentials.create were decoded
    // from base64url into ArrayBuffers and a prf extension was attached.
    expect(credentials.create).toHaveBeenCalledTimes(1);
    const passed = credentials.create.mock.calls[0][0].publicKey;
    expect(passed.challenge).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(passed.challenge)).toEqual(CHALLENGE_BYTES);
    expect(passed.user.id).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(passed.user.id)).toEqual(USER_ID_BYTES);
    expect(passed.excludeCredentials[0].id).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(passed.excludeCredentials[0].id)).toEqual(EXCLUDE_ID_BYTES);
    expect(passed.extensions.prf).toEqual({});

    expect(result.token).toBe('attest-token');
    expect(result.supportsPrf).toBe(true);
    expect(result.deviceResponse).toBe(credential);
    expect(result.createOptions).toBe(passed);

    const req = result.request as any;
    expect(req.id).toBe('new-cred');
    expect(req.rawId).toBe(bytesToBase64Url(new Uint8Array([9, 8, 7, 6])));
    expect(req.type).toBe('public-key');
    expect(req.extensions).toEqual({});
    expect(req.response.attestationObject).toBe(bytesToBase64Url(new Uint8Array([1, 2, 3])));
    expect(req.response.clientDataJson).toBe(bytesToBase64Url(new Uint8Array([4, 5, 6])));
    expect(req.response.transports).toEqual(['internal', 'hybrid']);
  });

  it('reports supportsPrf=false when the authenticator does not enable prf', async () => {
    const credential = new FakePublicKeyCredential({
      response: new FakeAuthenticatorAttestationResponse(),
      extensionResults: {},
    });
    credentials.create.mockResolvedValue(credential);
    const result = await createAccountPasskeyCredential({
      options: makeCreationOptions(),
      token: 'tok',
    });
    expect(result.supportsPrf).toBe(false);
  });

  it('handles options without excludeCredentials (undefined branch)', async () => {
    const credential = new FakePublicKeyCredential({
      response: new FakeAuthenticatorAttestationResponse(),
      extensionResults: { prf: { enabled: false } },
    });
    credentials.create.mockResolvedValue(credential);
    const result = await createAccountPasskeyCredential({
      options: makeCreationOptions({ excludeCredentials: undefined }),
      token: 'tok',
    });
    expect(credentials.create.mock.calls[0][0].publicKey.excludeCredentials).toBeUndefined();
    expect(result.supportsPrf).toBe(false);
  });

  it('omits transports when getTransports is unavailable', async () => {
    const response = new FakeAuthenticatorAttestationResponse();
    // Simulate an older browser without getTransports.
    (response as any).getTransports = undefined;
    const credential = new FakePublicKeyCredential({
      response,
      extensionResults: {},
    });
    credentials.create.mockResolvedValue(credential);
    const result = await createAccountPasskeyCredential({
      options: makeCreationOptions(),
      token: 'tok',
    });
    expect((result.request as any).response.transports).toBeUndefined();
  });

  it('throws on invalid creation options', async () => {
    await expect(
      createAccountPasskeyCredential({ options: null, token: 'tok' })
    ).rejects.toThrow(t('txt_invalid_passkey_creation_options'));
  });

  it('throws when navigator returns a non-credential', async () => {
    credentials.create.mockResolvedValue(null);
    await expect(
      createAccountPasskeyCredential({ options: makeCreationOptions(), token: 'tok' })
    ).rejects.toThrow(t('txt_no_passkey_created'));
  });

  it('throws when the response is not an attestation response', async () => {
    const credential = new FakePublicKeyCredential({
      // Wrong response type (assertion instead of attestation).
      response: new FakeAuthenticatorAssertionResponse(),
      extensionResults: {},
    });
    credentials.create.mockResolvedValue(credential);
    await expect(
      createAccountPasskeyCredential({ options: makeCreationOptions(), token: 'tok' })
    ).rejects.toThrow(t('txt_invalid_passkey_registration_response'));
  });
});

describe('assertAccountPasskey', () => {
  let credentials: { create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    credentials = installWebAuthn();
  });
  afterEach(() => {
    uninstallWebAuthn();
    vi.clearAllMocks();
  });

  function makeRequestOptions(overrides: Record<string, any> = {}) {
    return {
      challenge: bytesToBase64Url(CHALLENGE_BYTES),
      rpId: 'example.com',
      allowCredentials: [{ id: bytesToBase64Url(EXCLUDE_ID_BYTES), type: 'public-key' }],
      timeout: 60000,
      userVerification: 'preferred',
      ...overrides,
    };
  }

  it('throws on invalid assertion options', async () => {
    await expect(
      assertAccountPasskey({ options: 7 as any, token: 'tok' })
    ).rejects.toThrow(t('txt_invalid_passkey_assertion_options'));
  });

  it('runs the credential-scoped prf attempt, derives a 64-byte key, encodes the assertion', async () => {
    const prfFirst = buf([1, 2, 3, 4, 5, 6, 7, 8]);
    const credential = new FakePublicKeyCredential({
      id: 'asrt-cred',
      rawId: buf([100, 101]),
      response: new FakeAuthenticatorAssertionResponse({
        authenticatorData: buf([60, 61]),
        signature: buf([70, 71]),
        clientDataJSON: buf([80, 81]),
        userHandle: buf([90, 91]),
      }),
      extensionResults: prfExtensionResult(prfFirst),
    });
    credentials.get.mockResolvedValue(credential);

    const result = await assertAccountPasskey({
      options: makeRequestOptions(),
      token: 'assert-token',
    });

    // First attempt uses evalByCredential because allowCredentials is present.
    const firstCall = credentials.get.mock.calls[0][0].publicKey;
    expect(firstCall.challenge).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(firstCall.challenge)).toEqual(CHALLENGE_BYTES);
    expect(firstCall.allowCredentials[0].id).toBeInstanceOf(ArrayBuffer);
    const credId = bytesToBase64Url(EXCLUDE_ID_BYTES);
    expect(firstCall.extensions.prf.evalByCredential[credId]).toBeTruthy();
    expect(firstCall.extensions.prf.evalByCredential[credId].first).toBeInstanceOf(Uint8Array);

    expect(result.token).toBe('assert-token');
    expect(result.prfKey).toBeInstanceOf(Uint8Array);
    expect(result.prfKey).toHaveLength(64);

    const dr = result.deviceResponse as any;
    expect(dr.id).toBe('asrt-cred');
    expect(dr.rawId).toBe(bytesToBase64Url(new Uint8Array([100, 101])));
    expect(dr.response.authenticatorData).toBe(bytesToBase64Url(new Uint8Array([60, 61])));
    expect(dr.response.signature).toBe(bytesToBase64Url(new Uint8Array([70, 71])));
    expect(dr.response.clientDataJSON).toBe(bytesToBase64Url(new Uint8Array([80, 81])));
    expect(dr.response.userHandle).toBe(bytesToBase64Url(new Uint8Array([90, 91])));
  });

  it('returns no prfKey and a legacy attempt when allowCredentials is absent', async () => {
    const credential = new FakePublicKeyCredential({
      response: new FakeAuthenticatorAssertionResponse({ userHandle: null }),
      extensionResults: {},
    });
    credentials.get.mockResolvedValue(credential);

    const result = await assertAccountPasskey({
      options: makeRequestOptions({ allowCredentials: undefined }),
      token: 'tok',
    });

    // Legacy eval extension (no evalByCredential) because there are no creds.
    const call = credentials.get.mock.calls[0][0].publicKey;
    expect(call.extensions.prf.eval).toBeTruthy();
    expect(call.extensions.prf.evalByCredential).toBeUndefined();
    expect(result.prfKey).toBeUndefined();
    expect((result.deviceResponse as any).response.userHandle).toBeUndefined();
  });

  it('retries with the legacy prf extension after a NotSupportedError', async () => {
    const prfFirst = buf([9, 9, 9, 9]);
    const goodCredential = new FakePublicKeyCredential({
      response: new FakeAuthenticatorAssertionResponse(),
      extensionResults: prfExtensionResult(prfFirst),
    });
    const notSupported = new DOMException('nope', 'NotSupportedError');
    credentials.get
      .mockRejectedValueOnce(notSupported)
      .mockResolvedValueOnce(goodCredential);

    const result = await assertAccountPasskey({
      options: makeRequestOptions(),
      token: 'tok',
    });

    expect(credentials.get).toHaveBeenCalledTimes(2);
    // Second attempt is the legacy extension.
    expect(credentials.get.mock.calls[1][0].publicKey.extensions.prf.eval).toBeTruthy();
    expect(result.prfKey).toHaveLength(64);
  });

  it('throws when navigator.get returns a non-credential', async () => {
    // No allowCredentials => single legacy attempt; a non-credential on the
    // last attempt surfaces the "no passkey selected" error.
    credentials.get.mockResolvedValue({});
    await expect(
      assertAccountPasskey({
        options: makeRequestOptions({ allowCredentials: undefined }),
        token: 'tok',
      })
    ).rejects.toThrow(t('txt_no_passkey_selected'));
  });

  it('propagates a non-retryable error from the only attempt', async () => {
    const fatal = new DOMException('blocked', 'NotAllowedError');
    credentials.get.mockRejectedValue(fatal);
    await expect(
      assertAccountPasskey({
        options: makeRequestOptions({ allowCredentials: undefined }),
        token: 'tok',
      })
    ).rejects.toBe(fatal);
  });

  it('throws when the response is not an assertion response', async () => {
    const credential = new FakePublicKeyCredential({
      response: new FakeAuthenticatorAttestationResponse(),
      extensionResults: {},
    });
    credentials.get.mockResolvedValue(credential);
    await expect(
      assertAccountPasskey({
        options: makeRequestOptions({ allowCredentials: undefined }),
        token: 'tok',
      })
    ).rejects.toThrow(t('txt_invalid_passkey_assertion_response'));
  });
});

describe('buildAccountPasskeyPrfKeySetFromPrfKey + unlockVaultKeyWithAccountPasskeyPrf', () => {
  // Real WebCrypto RSA keygen/encryption + Bitwarden encryptBw/decryptBw round trip.
  const symEncKey = bytesToBase64(new Uint8Array(Array.from({ length: 32 }, (_, i) => i)));
  const symMacKey = bytesToBase64(new Uint8Array(Array.from({ length: 32 }, (_, i) => 255 - i)));
  const prfKey = new Uint8Array(Array.from({ length: 64 }, (_, i) => (i * 3 + 5) & 0xff));

  it('produces a key set that round-trips back to the original user key', async () => {
    const keySet = await buildAccountPasskeyPrfKeySetFromPrfKey(prfKey, { symEncKey, symMacKey });

    expect(keySet.encryptedUserKey.startsWith('4.')).toBe(true);
    expect(keySet.encryptedPublicKey.startsWith('2.')).toBe(true);
    expect(keySet.encryptedPrivateKey.startsWith('2.')).toBe(true);

    const unlocked = await unlockVaultKeyWithAccountPasskeyPrf(prfKey, {
      encryptedPrivateKey: keySet.encryptedPrivateKey,
      encryptedUserKey: keySet.encryptedUserKey,
    });
    expect(unlocked.symEncKey).toBe(symEncKey);
    expect(unlocked.symMacKey).toBe(symMacKey);
  });

  it('unlocks via the capitalized PascalCase option fields too', async () => {
    const keySet = await buildAccountPasskeyPrfKeySetFromPrfKey(prfKey, { symEncKey, symMacKey });
    const unlocked = await unlockVaultKeyWithAccountPasskeyPrf(prfKey, {
      EncryptedPrivateKey: keySet.encryptedPrivateKey,
      EncryptedUserKey: keySet.encryptedUserKey,
    });
    expect(unlocked.symEncKey).toBe(symEncKey);
    expect(unlocked.symMacKey).toBe(symMacKey);
  });

  it('throws when required encrypted fields are missing', async () => {
    await expect(
      unlockVaultKeyWithAccountPasskeyPrf(prfKey, { encryptedUserKey: '4.abc' })
    ).rejects.toThrow(t('txt_passkey_cannot_unlock_vault'));
    await expect(
      unlockVaultKeyWithAccountPasskeyPrf(prfKey, { encryptedPrivateKey: '2.a|b|c' })
    ).rejects.toThrow(t('txt_passkey_cannot_unlock_vault'));
  });

  it('rejects an encrypted user key with an unsupported type prefix', async () => {
    const keySet = await buildAccountPasskeyPrfKeySetFromPrfKey(prfKey, { symEncKey, symMacKey });
    // Swap the "4." RSA prefix for an unsupported "3." one.
    const badUserKey = keySet.encryptedUserKey.replace(/^4\./, '3.');
    await expect(
      unlockVaultKeyWithAccountPasskeyPrf(prfKey, {
        encryptedPrivateKey: keySet.encryptedPrivateKey,
        encryptedUserKey: badUserKey,
      })
    ).rejects.toThrow(t('txt_unsupported_encrypted_user_key'));
  });

  it('fails to unlock with the wrong prf key', async () => {
    const keySet = await buildAccountPasskeyPrfKeySetFromPrfKey(prfKey, { symEncKey, symMacKey });
    const wrongPrf = new Uint8Array(64).fill(7);
    await expect(
      unlockVaultKeyWithAccountPasskeyPrf(wrongPrf, {
        encryptedPrivateKey: keySet.encryptedPrivateKey,
        encryptedUserKey: keySet.encryptedUserKey,
      })
    ).rejects.toThrow();
  });
});

describe('buildAccountPasskeyPrfKeySet (end-to-end from a pending credential)', () => {
  let credentials: { create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  const symEncKey = bytesToBase64(new Uint8Array(32).fill(3));
  const symMacKey = bytesToBase64(new Uint8Array(32).fill(9));

  beforeEach(() => {
    credentials = installWebAuthn();
  });
  afterEach(() => {
    uninstallWebAuthn();
    vi.clearAllMocks();
  });

  function makePending(rawId: ArrayBuffer) {
    return {
      token: 'tok',
      createOptions: {
        challenge: buf([1, 2, 3, 4]),
        rp: { id: 'example.com' },
        timeout: 60000,
        authenticatorSelection: { userVerification: 'required' },
      },
      deviceResponse: new FakePublicKeyCredential({ rawId }),
      request: {},
      supportsPrf: true,
    } as any;
  }

  it('asserts with prf and builds an unlockable key set', async () => {
    const rawId = buf([5, 6, 7, 8]);
    const prfFirst = buf([11, 22, 33, 44, 55]);
    credentials.get.mockResolvedValue(
      new FakePublicKeyCredential({
        rawId,
        response: new FakeAuthenticatorAssertionResponse(),
        extensionResults: prfExtensionResult(prfFirst),
      })
    );

    const keySet = await buildAccountPasskeyPrfKeySet(makePending(rawId), { symEncKey, symMacKey });

    // The assertion options were derived from the create options and the rawId.
    const call = credentials.get.mock.calls[0][0].publicKey;
    expect(new Uint8Array(call.allowCredentials[0].id)).toEqual(new Uint8Array([5, 6, 7, 8]));
    expect(call.rpId).toBe('example.com');
    expect(call.userVerification).toBe('required');

    expect(keySet.encryptedUserKey.startsWith('4.')).toBe(true);

    // Derive the same prf-derived key the module would have, to verify unlock.
    // (prfOutputToKey is internal; reproduce it via the public crypto helpers.)
    const { hkdfExpand } = await import('@/lib/crypto');
    const prf = new Uint8Array(prfFirst);
    const enc = await hkdfExpand(prf, 'enc', 32);
    const mac = await hkdfExpand(prf, 'mac', 32);
    const derived = new Uint8Array(64);
    derived.set(enc, 0);
    derived.set(mac, 32);

    const unlocked = await unlockVaultKeyWithAccountPasskeyPrf(derived, {
      encryptedPrivateKey: keySet.encryptedPrivateKey,
      encryptedUserKey: keySet.encryptedUserKey,
    });
    expect(unlocked.symEncKey).toBe(symEncKey);
    expect(unlocked.symMacKey).toBe(symMacKey);
  });

  it('throws AccountPasskeyPrfUnavailableError when the assertion yields no prf', async () => {
    const rawId = buf([1, 1, 1, 1]);
    // Both the credential-scoped and legacy attempts return no prf result.
    credentials.get.mockResolvedValue(
      new FakePublicKeyCredential({
        rawId,
        response: new FakeAuthenticatorAssertionResponse(),
        extensionResults: {},
      })
    );
    await expect(
      buildAccountPasskeyPrfKeySet(makePending(rawId), { symEncKey, symMacKey })
    ).rejects.toBeInstanceOf(AccountPasskeyPrfUnavailableError);
  });
});

// Keep an explicit reference so unused-import lint stays quiet and to document
// that base64ToBytes is part of the round trip we rely on indirectly.
describe('base64 sanity (shared with @/lib/crypto)', () => {
  it('round-trips the challenge bytes through the module-shaped encoding', () => {
    const url = bytesToBase64Url(CHALLENGE_BYTES);
    // url-safe form must not contain padding or + or /.
    expect(url).not.toMatch(/[+/=]/);
    // And decoding the padded standard form recovers the bytes.
    const standard = url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = standard + '='.repeat((4 - (standard.length % 4 || 4)) % 4);
    expect(base64ToBytes(padded)).toEqual(CHALLENGE_BYTES);
  });
});
