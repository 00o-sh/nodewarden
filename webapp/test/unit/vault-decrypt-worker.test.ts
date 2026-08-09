import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The vault-decrypt web worker offloads bulk decryption off the main thread.
// It is a `self.onmessage` dispatcher over decryptVaultCore / decryptSends, so
// we mock those, import the module (which installs the handler on `self`), and
// drive the message protocol directly — asserting the exact postMessage envelope
// for the success and error paths of both request kinds.

const decryptVaultCore = vi.fn();
const decryptSends = vi.fn();
vi.mock('@/lib/vault-decrypt', () => ({
  decryptVaultCore: (...args: unknown[]) => decryptVaultCore(...args),
  decryptSends: (...args: unknown[]) => decryptSends(...args),
}));

type Handler = (event: { data: unknown }) => Promise<void>;

async function loadHandler(): Promise<Handler> {
  vi.resetModules();
  await import('@/workers/vault-decrypt.worker');
  return (self as unknown as { onmessage: Handler }).onmessage;
}

describe('vault-decrypt.worker', () => {
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMessage = vi.fn();
    // The worker calls self.postMessage(msg) with a single arg; jsdom's
    // window.postMessage requires a targetOrigin, so replace it outright.
    (self as unknown as { postMessage: unknown }).postMessage = postMessage;
    decryptVaultCore.mockReset();
    decryptSends.mockReset();
  });

  afterEach(() => {
    (self as unknown as { onmessage: unknown }).onmessage = null;
  });

  it('decrypts a vault-core request and posts the result', async () => {
    const handler = await loadHandler();
    const result = { folders: [{ id: 'f1' }], ciphers: [] };
    decryptVaultCore.mockResolvedValue(result);

    await handler({ data: { id: 7, kind: 'vault-core', payload: { core: true } } });

    expect(decryptVaultCore).toHaveBeenCalledWith({ core: true });
    expect(decryptSends).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({ id: 7, ok: true, result });
  });

  it('decrypts a sends request and posts the result', async () => {
    const handler = await loadHandler();
    const result = [{ id: 's1' }];
    decryptSends.mockResolvedValue(result);

    await handler({ data: { id: 9, kind: 'sends', payload: { sends: true } } });

    expect(decryptSends).toHaveBeenCalledWith({ sends: true });
    expect(decryptVaultCore).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({ id: 9, ok: true, result });
  });

  it('reports the message of a thrown Error', async () => {
    const handler = await loadHandler();
    decryptVaultCore.mockRejectedValue(new Error('bad mac'));

    await handler({ data: { id: 3, kind: 'vault-core', payload: {} } });

    expect(postMessage).toHaveBeenCalledWith({ id: 3, ok: false, error: 'bad mac' });
  });

  it('falls back to a generic message for a non-Error rejection', async () => {
    const handler = await loadHandler();
    decryptSends.mockRejectedValue('boom');

    await handler({ data: { id: 4, kind: 'sends', payload: {} } });

    expect(postMessage).toHaveBeenCalledWith({ id: 4, ok: false, error: 'Decrypt failed' });
  });
});
