import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate } from './helpers';
import { StorageService } from '../../src/services/storage';
import { executeConfiguredBackup } from '../../src/handlers/backup';

// A configured remote backup whose upload fails (the remote returns 500) drives
// executeConfiguredBackup's failure path: the run is marked failed, an audit
// record is written, the progress reporter receives a failure event, and the
// error is rethrown. Driven against a real in-memory WebDAV server that fails
// every write — realistic outage, no mocks.
let session: Session;
let adminId: string;
let destinationId: string;

function failingWebDav() {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method || 'GET').toUpperCase();
    // Directory creation succeeds; every write/read fails.
    if (method === 'MKCOL') return new Response(null, { status: 201 });
    return new Response('unavailable', { status: 500 });
  };
}

beforeAll(async () => {
  session = await authenticate('cfgbackupfail');
  adminId = ((await (await api('GET', '/api/accounts/profile', session.accessToken)).json()) as any).id;
  const settings = await api('PUT', '/api/admin/backup/settings', session.accessToken, {
    destinations: [{
      type: 'webdav', includeAttachments: false,
      destination: { baseUrl: 'https://dav.test', username: 'u', password: 'p', remotePath: 'nodewarden' },
      schedule: { enabled: false, intervalHours: 24, startTime: '03:00', timezone: 'UTC', retentionCount: 30 },
    }],
  });
  destinationId = ((await settings.json()) as any).destinations[0].id;
});

describe('configured backup upload failure', () => {
  it('records the failure, reports progress and rethrows', async () => {
    const storage = new StorageService((env as any).DB);
    const events: any[] = [];
    const progress = async (e: any) => { events.push(e); };

    const original = globalThis.fetch;
    globalThis.fetch = failingWebDav() as typeof fetch;
    let threw = false;
    try {
      await executeConfiguredBackup(env as any, storage, adminId, 'manual', destinationId, null, progress);
    } catch {
      threw = true;
    } finally {
      globalThis.fetch = original;
    }
    expect(threw).toBe(true);
    // The failure progress event was emitted.
    expect(events.some((e) => e.ok === false && e.step === 'remote_run_failed')).toBe(true);

    // The destination's runtime now records the error (persisted to settings).
    const settings = (await (await api('GET', '/api/admin/backup/settings', session.accessToken)).json()) as any;
    const dest = settings.destinations.find((d: any) => d.id === destinationId);
    expect(dest.runtime.lastErrorMessage).toBeTruthy();
  });

  it('retries then fails when the uploaded archive does not verify', async () => {
    const storage = new StorageService((env as any).DB);
    const original = globalThis.fetch;
    // Stores writes, but every download returns corrupted bytes, so the
    // post-upload checksum/size verification fails and the run gives up.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method = (init?.method || 'GET').toUpperCase();
      if (method === 'MKCOL') return new Response(null, { status: 201 });
      if (method === 'PUT') return new Response(null, { status: 201 });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (method === 'GET') return new Response(new Uint8Array([9, 9, 9, 9]), { status: 200 });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    let message = '';
    try {
      await executeConfiguredBackup(env as any, storage, adminId, 'manual', destinationId, null, null);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      globalThis.fetch = original;
    }
    expect(message).toMatch(/verification failed/i);
  });
});
