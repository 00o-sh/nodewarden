import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, createCipher, enc, sync } from './helpers';

// Full cipher updates (PUT /api/ciphers/:id) use replacement semantics for the
// nullable `notes` and `fields` properties: a client that cleared a value may
// omit the property entirely, and the merge-with-stored fallback must not
// resurrect the old value.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('ciphernotes');
  token = session.accessToken;
});

async function storedCipher(id: string): Promise<any> {
  const body = (await (await sync(token)).json()) as any;
  return body.ciphers.find((c: any) => c.id === id);
}

function loginBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 1,
    name: enc('item'),
    login: { username: enc('user'), password: enc('pass'), uris: [] },
    ...extra,
  };
}

describe('full cipher update nullable fields', () => {
  it('clears notes and custom fields that the client omitted', async () => {
    const cipher = await createCipher(token, {
      notes: enc('notes'),
      fields: [{ type: 0, name: enc('field'), value: enc('value') }],
    });
    expect((await storedCipher(cipher.id)).notes).toBe(enc('notes'));

    const updated = await api('PUT', `/api/ciphers/${cipher.id}`, token, loginBody());
    expect(updated.status).toBe(200);
    const body = (await updated.json()) as any;
    expect(body.notes).toBeNull();
    expect(body.fields).toBeNull();

    const stored = await storedCipher(cipher.id);
    expect(stored.notes).toBeNull();
    expect(stored.fields).toBeNull();
  });

  it('accepts PascalCase Notes and explicit null', async () => {
    const cipher = await createCipher(token, { notes: enc('notes') });

    const pascal = await api('PUT', `/api/ciphers/${cipher.id}`, token, loginBody({ Notes: enc('pascal') }));
    expect(pascal.status).toBe(200);
    expect(((await pascal.json()) as any).notes).toBe(enc('pascal'));

    const cleared = await api('PUT', `/api/ciphers/${cipher.id}`, token, loginBody({ notes: null }));
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as any).notes).toBeNull();
    expect((await storedCipher(cipher.id)).notes).toBeNull();
  });
});
