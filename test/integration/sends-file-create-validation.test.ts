import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, enc } from './helpers';

// Field-validation branches of the reserve-file-send endpoint
// (handleCreateFileSendV2, POST /api/sends/file/v2): every guard returns a
// deterministic 400 with a specific message. Real D1, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('sendfilecreateval');
  token = session.accessToken;
});

const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

// A valid reserve-file body; each test overrides one field to trip a guard.
function body(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 1,
    name: enc('f'),
    key: ENC_STRING,
    fileLength: 8,
    deletionDate: future(),
    file: { fileName: enc('doc'), size: 8 },
    ...overrides,
  };
}

async function reserve(overrides: Record<string, unknown>): Promise<{ status: number; message: string }> {
  const res = await api('POST', '/api/sends/file/v2', token, body(overrides));
  let message = '';
  try {
    const json = (await res.json()) as any;
    message = json?.ErrorModel?.Message ?? json?.error ?? '';
  } catch {
    message = '';
  }
  return { status: res.status, message };
}

describe('reserve file send validation', () => {
  it('rejects a non-file (text) type', async () => {
    const r = await reserve({ type: 0 });
    expect(r.status).toBe(400);
    expect(r.message).toContain('not a file');
  });

  it('rejects a non-numeric file length', async () => {
    const r = await reserve({ fileLength: 'huge' });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Invalid send length');
  });

  it('rejects a negative file length', async () => {
    const r = await reserve({ fileLength: -1 });
    expect(r.status).toBe(400);
    expect(r.message).toContain("can't be negative");
  });

  it('rejects a file larger than the storage limit', async () => {
    const r = await reserve({ fileLength: 200 * 1024 * 1024 });
    expect(r.status).toBe(400);
    expect(r.message).toContain('storage limit exceeded');
  });

  it('requires a name', async () => {
    const r = await reserve({ name: '   ' });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Name is required');
  });

  it('requires a key', async () => {
    const r = await reserve({ key: '' });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Key is required');
  });

  it('rejects an unparseable deletion date', async () => {
    const r = await reserve({ deletionDate: 'not-a-date' });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Invalid deletionDate');
  });

  it('rejects a deletion date too far in the future', async () => {
    const r = await reserve({ deletionDate: new Date(Date.now() + 60 * 86_400_000).toISOString() });
    expect(r.status).toBe(400);
    expect(r.message).toContain('deletion date');
  });

  it('requires file data', async () => {
    const r = await reserve({ file: null });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Send data not provided');
  });

  it('rejects an invalid maxAccessCount', async () => {
    const r = await reserve({ maxAccessCount: -5 });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Invalid maxAccessCount');
  });

  it('rejects an invalid authType', async () => {
    const r = await reserve({ authType: 99 });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Invalid authType');
  });

  it('rejects an emails value that normalizes to nothing', async () => {
    const r = await reserve({ authType: 2, emails: [123] });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Invalid emails');
  });

  it('requires a password when password auth is requested', async () => {
    const r = await reserve({ authType: 1 });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Password is required');
  });
});
