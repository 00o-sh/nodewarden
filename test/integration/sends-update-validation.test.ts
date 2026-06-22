import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, enc } from './helpers';

// Field-validation branches and the happy paths of handleUpdateSend
// (PUT /api/sends/:id). Pure-validation failures return before persisting, so
// a single shared text send is reused for them; mutating cases get their own.
// Real D1, no mocks.
let session: Session;
let token: string;
let sharedSend: string;

const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

async function createTextSend(): Promise<string> {
  const res = await api('POST', '/api/sends', token, {
    type: 0,
    name: enc('t'),
    key: ENC_STRING,
    deletionDate: future(),
    text: { text: enc('secret'), hidden: false },
  });
  return ((await res.json()) as any).id;
}

beforeAll(async () => {
  session = await authenticate('sendupdateval');
  token = session.accessToken;
  sharedSend = await createTextSend();
});

async function update(id: string, body: Record<string, unknown>): Promise<{ status: number; message: string; json: any }> {
  const res = await api('PUT', `/api/sends/${id}`, token, body);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  const message = json?.ErrorModel?.Message ?? json?.error ?? '';
  return { status: res.status, message, json };
}

describe('update send validation', () => {
  it('404s an unknown send', async () => {
    expect((await update(crypto.randomUUID(), { name: enc('x') })).status).toBe(404);
  });

  it('rejects an invalid send type', async () => {
    const r = await update(sharedSend, { type: 'nope' });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Invalid Send type');
  });

  it("rejects changing a send's type", async () => {
    const r = await update(sharedSend, { type: 1 });
    expect(r.status).toBe(400);
    expect(r.message).toContain("can't change type");
  });

  it('rejects an unparseable deletion date', async () => {
    const r = await update(sharedSend, { deletionDate: 'not-a-date' });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Invalid deletionDate');
  });

  it('rejects a deletion date too far in the future', async () => {
    const r = await update(sharedSend, { deletionDate: new Date(Date.now() + 60 * 86_400_000).toISOString() });
    expect(r.status).toBe(400);
    expect(r.message).toContain('deletion date');
  });

  it('rejects an unparseable expiration date', async () => {
    const r = await update(sharedSend, { expirationDate: 'not-a-date' });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Invalid expirationDate');
  });

  it('requires a non-empty name', async () => {
    const r = await update(sharedSend, { name: '   ' });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Name is required');
  });

  it('requires a non-empty key', async () => {
    const r = await update(sharedSend, { key: '' });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Key is required');
  });

  it('rejects a non-boolean disabled', async () => {
    const r = await update(sharedSend, { disabled: 'yes' });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Invalid disabled');
  });

  it('rejects a non-boolean hideEmail', async () => {
    const r = await update(sharedSend, { hideEmail: 'no' });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Invalid hideEmail');
  });

  it('rejects an invalid maxAccessCount', async () => {
    const r = await update(sharedSend, { maxAccessCount: -3 });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Invalid maxAccessCount');
  });

  it('rejects an invalid authType', async () => {
    const r = await update(sharedSend, { authType: 99 });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Invalid authType');
  });

  it('rejects emails that normalize to nothing', async () => {
    const r = await update(sharedSend, { emails: [123] });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Invalid emails');
  });

  it('rejects password auth without a password', async () => {
    const r = await update(sharedSend, { authType: 1 });
    expect(r.status).toBe(400);
    expect(r.message).toContain('Password is required');
  });
});

describe('update send happy paths', () => {
  it('renames a send and clears its expiration', async () => {
    const id = await createTextSend();
    const renamed = enc('renamed');
    const r = await update(id, { name: renamed, expirationDate: null, notes: enc('note') });
    expect(r.status).toBe(200);
    expect(r.json.name).toBe(renamed);
    expect(r.json.expirationDate).toBeNull();
  });

  it('couples a non-empty emails list to email auth', async () => {
    const id = await createTextSend();
    const r = await update(id, { emails: 'recipient@example.com' });
    expect(r.status).toBe(200);
    // SendAuthType.Email === 0
    expect(r.json.accessId).toBeTruthy();
    expect(r.json.emails).toContain('recipient@example.com');
  });

  it('updates text content', async () => {
    const id = await createTextSend();
    const r = await update(id, { text: { text: enc('updated-secret'), hidden: true } });
    expect(r.status).toBe(200);
    expect(r.json.text).toBeTruthy();
  });
});
