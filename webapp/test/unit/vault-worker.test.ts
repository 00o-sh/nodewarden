import { afterEach, describe, expect, it, vi } from 'vitest';

// vault-worker wraps a Web Worker. jsdom does not provide `Worker`, so the
// module's getWorker() returns null and jobs reject. We exercise both the
// genuine "unavailable" path and a mocked-Worker happy/error path. Because the
// module caches its Worker instance at module scope, each scenario imports a
// fresh copy via vi.resetModules().

const args = {
  vaultCore: { folders: [], ciphers: [], symEncKeyB64: 'e', symMacKeyB64: 'm' },
  sends: { sends: [], symEncKeyB64: 'e', symMacKeyB64: 'm', origin: 'https://x' },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('vault-worker - Worker unavailable (jsdom default)', () => {
  it('rejects vault-core jobs when Worker is undefined', async () => {
    // jsdom has no Worker global by default.
    expect(typeof (globalThis as any).Worker).toBe('undefined');
    const mod = await import('@/lib/vault-worker');
    await expect(mod.decryptVaultCoreInWorker(args.vaultCore as any)).rejects.toThrow(
      'Decrypt worker unavailable'
    );
  });

  it('rejects sends jobs when Worker is undefined', async () => {
    vi.resetModules();
    const mod = await import('@/lib/vault-worker');
    await expect(mod.decryptSendsInWorker(args.sends as any)).rejects.toThrow(
      'Decrypt worker unavailable'
    );
  });
});

// A minimal fake Worker that lets the test drive the message channel.
class FakeWorker {
  static instances: FakeWorker[] = [];
  listeners: Record<string, Array<(ev: any) => void>> = {};
  posted: any[] = [];
  constructor(_url: unknown, _opts?: unknown) {
    FakeWorker.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: any) => void) {
    (this.listeners[type] ||= []).push(cb);
  }
  postMessage(msg: any) {
    this.posted.push(msg);
  }
  emit(type: string, ev: any) {
    for (const cb of this.listeners[type] || []) cb(ev);
  }
}

describe('vault-worker - with a mocked Worker', () => {
  it('posts a vault-core job and resolves with the worker result', async () => {
    FakeWorker.instances = [];
    vi.resetModules();
    vi.stubGlobal('Worker', FakeWorker as any);
    const mod = await import('@/lib/vault-worker');

    const promise = mod.decryptVaultCoreInWorker(args.vaultCore as any);
    const w = FakeWorker.instances[0];
    expect(w).toBeDefined();
    expect(w.posted).toHaveLength(1);
    const job = w.posted[0];
    expect(job.kind).toBe('vault-core');
    expect(job.payload).toEqual(args.vaultCore);
    expect(typeof job.id).toBe('number');

    const result = { folders: ['decrypted'], ciphers: [] };
    w.emit('message', { data: { id: job.id, ok: true, result } });
    await expect(promise).resolves.toEqual(result);
  });

  it('rejects when the worker reports a failure', async () => {
    FakeWorker.instances = [];
    vi.resetModules();
    vi.stubGlobal('Worker', FakeWorker as any);
    const mod = await import('@/lib/vault-worker');

    const promise = mod.decryptSendsInWorker(args.sends as any);
    const w = FakeWorker.instances[0];
    const job = w.posted[0];
    expect(job.kind).toBe('sends');
    w.emit('message', { data: { id: job.id, ok: false, error: 'boom' } });
    await expect(promise).rejects.toThrow('boom');
  });

  it('reuses a single worker instance across jobs', async () => {
    FakeWorker.instances = [];
    vi.resetModules();
    vi.stubGlobal('Worker', FakeWorker as any);
    const mod = await import('@/lib/vault-worker');

    const p1 = mod.decryptVaultCoreInWorker(args.vaultCore as any);
    const p2 = mod.decryptSendsInWorker(args.sends as any);
    expect(FakeWorker.instances).toHaveLength(1);

    const w = FakeWorker.instances[0];
    expect(w.posted).toHaveLength(2);
    // Job ids are distinct and routed independently.
    const [j1, j2] = w.posted;
    expect(j1.id).not.toBe(j2.id);
    w.emit('message', { data: { id: j2.id, ok: true, result: ['sends'] } });
    w.emit('message', { data: { id: j1.id, ok: true, result: { folders: [], ciphers: [] } } });
    await expect(p2).resolves.toEqual(['sends']);
    await expect(p1).resolves.toEqual({ folders: [], ciphers: [] });
  });

  it('ignores messages with an unknown job id', async () => {
    FakeWorker.instances = [];
    vi.resetModules();
    vi.stubGlobal('Worker', FakeWorker as any);
    const mod = await import('@/lib/vault-worker');

    const promise = mod.decryptVaultCoreInWorker(args.vaultCore as any);
    const w = FakeWorker.instances[0];
    const job = w.posted[0];
    // Unknown id -> no-op; the real job still resolves afterwards.
    w.emit('message', { data: { id: 9999, ok: true, result: 'nope' } });
    w.emit('message', { data: { id: job.id, ok: true, result: 'ok' } });
    await expect(promise).resolves.toBe('ok');
  });

  it('rejects all pending jobs when the worker emits an error event', async () => {
    FakeWorker.instances = [];
    vi.resetModules();
    vi.stubGlobal('Worker', FakeWorker as any);
    const mod = await import('@/lib/vault-worker');

    const promise = mod.decryptVaultCoreInWorker(args.vaultCore as any);
    const w = FakeWorker.instances[0];
    w.emit('error', {});
    await expect(promise).rejects.toThrow('Decrypt worker failed');
  });
});
