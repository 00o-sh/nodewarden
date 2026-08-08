import { describe, expect, it, vi } from 'vitest';
import { bytesToBase64 } from '@/lib/crypto';
import type { SessionState } from '@/lib/types';
import {
  accessPublicSend,
  bulkDeleteSends,
  buildSendShareKey,
  createSend,
  decryptPublicSend,
  deleteSend,
  getSendById,
  getSends,
  updateSend,
} from '@/lib/api/send';

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const emptyOk = () => Promise.resolve(new Response(null, { status: 200 }));

function unlockedSession(): SessionState {
  return {
    email: 'user@example.com',
    authMode: 'token',
    accessToken: 'tok',
    symEncKey: bytesToBase64(new Uint8Array(32).fill(3)),
    symMacKey: bytesToBase64(new Uint8Array(32).fill(5)),
  } as SessionState;
}

describe('api/send getSends', () => {
  it('returns the data array', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ data: [{ id: 's1' }] }));
    expect(await getSends(authedFetch as any)).toEqual([{ id: 's1' }]);
    expect(authedFetch).toHaveBeenCalledWith('/api/sends');
  });

  it('returns [] when no data present', async () => {
    const authedFetch = vi.fn(() => jsonResponse({}));
    expect(await getSends(authedFetch as any)).toEqual([]);
  });

  it('throws on failure', async () => {
    await expect(getSends(vi.fn(() => jsonResponse(null, 500)) as any)).rejects.toThrow('Failed to load sends');
  });
});

describe('api/send getSendById', () => {
  it('requires an id', async () => {
    await expect(getSendById(vi.fn() as any, '  ')).rejects.toThrow('Send id is required');
  });

  it('maps 404 to a not-found error', async () => {
    const authedFetch = vi.fn(() => Promise.resolve(new Response(null, { status: 404 })));
    await expect(getSendById(authedFetch as any, 's1')).rejects.toThrow('Send not found');
  });

  it('returns the send on success', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 's1' }));
    expect(await getSendById(authedFetch as any, 's 1')).toEqual({ id: 's1' });
    expect(authedFetch).toHaveBeenCalledWith('/api/sends/s%201');
  });

  it('throws the parsed error on other failures', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'gone bad' }, 500));
    await expect(getSendById(authedFetch as any, 's1')).rejects.toThrow('gone bad');
  });

  it('throws when the body has no id', async () => {
    const authedFetch = vi.fn(() => jsonResponse({}));
    await expect(getSendById(authedFetch as any, 's1')).rejects.toThrow('Load send failed');
  });
});

describe('api/send createSend (text)', () => {
  const draft = {
    type: 'text',
    name: 'My Send',
    notes: 'a note',
    text: 'hello world',
    deletionDays: '7',
    expirationDays: '',
    maxAccessCount: '5',
    password: '',
    disabled: false,
  };

  it('rejects a locked vault', async () => {
    const locked = { ...unlockedSession(), symEncKey: undefined };
    await expect(createSend(vi.fn() as any, locked as SessionState, draft as any)).rejects.toThrow(
      'Vault key unavailable'
    );
  });

  it('encrypts the text send and posts a type-0 payload', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 's-new' }));
    const result = await createSend(authedFetch as any, unlockedSession(), draft as any);
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/sends');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.type).toBe(0);
    expect(body.maxAccessCount).toBe(5);
    expect(body.disabled).toBe(false);
    expect(body.password).toBeNull();
    // name/notes/text are encrypted cipher strings, not plaintext.
    expect(body.name).toMatch(/^2\./);
    expect(body.text.text).toMatch(/^2\./);
    expect(JSON.stringify(body)).not.toContain('hello world');
    // deletionDate is required and set; expirationDate stays null for '' input.
    expect(typeof body.deletionDate).toBe('string');
    expect(body.expirationDate).toBeNull();
    expect(result).toEqual({ id: 's-new' });
  });

  it('requires deletion days', async () => {
    const bad = { ...draft, deletionDays: '' };
    await expect(createSend(vi.fn() as any, unlockedSession(), bad as any)).rejects.toThrow(
      'Deletion days is required'
    );
  });

  it('rejects an empty text body', async () => {
    const bad = { ...draft, text: '   ' };
    await expect(createSend(vi.fn() as any, unlockedSession(), bad as any)).rejects.toThrow('Send text is required');
  });

  it('rejects an invalid max access count', async () => {
    const bad = { ...draft, maxAccessCount: '-3' };
    await expect(createSend(vi.fn() as any, unlockedSession(), bad as any)).rejects.toThrow(
      'Invalid max access count'
    );
  });

  it('surfaces the parsed server error on failure', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'server no' }, 400));
    await expect(createSend(authedFetch as any, unlockedSession(), draft as any)).rejects.toThrow('server no');
  });
});

describe('api/send updateSend', () => {
  it('rejects a send without a key', async () => {
    await expect(
      updateSend(vi.fn() as any, unlockedSession(), { id: 's1' } as any, { type: 'text', deletionDays: '1' } as any)
    ).rejects.toThrow('Send key unavailable');
  });
});

describe('api/send deleteSend', () => {
  it('DELETEs the encoded send', async () => {
    const authedFetch = vi.fn(emptyOk);
    await deleteSend(authedFetch as any, 's/1');
    expect(authedFetch).toHaveBeenCalledWith('/api/sends/s%2F1', { method: 'DELETE' });
  });

  it('throws the parsed error on failure', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error: 'cannot delete' }, 500));
    await expect(deleteSend(authedFetch as any, 's1')).rejects.toThrow('cannot delete');
  });
});

describe('api/send bulkDeleteSends', () => {
  it('dedupes and posts unique ids', async () => {
    const authedFetch = vi.fn(emptyOk);
    await bulkDeleteSends(authedFetch as any, ['a', ' a ', '', 'b']);
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/sends/delete');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ ids: ['a', 'b'] });
  });

  it('throws on failure', async () => {
    await expect(bulkDeleteSends(vi.fn(() => jsonResponse(null, 500)) as any, ['a'])).rejects.toThrow(
      'Bulk delete sends failed'
    );
  });
});

describe('api/send accessPublicSend', () => {
  it('POSTs to the public access endpoint without a password body', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ id: 's1', name: 'x' }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await accessPublicSend('access 1');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/sends/access/access%201');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({});
      expect(result).toEqual({ id: 's1', name: 'x' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws a status-tagged error on failure', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ error_description: 'locked' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(accessPublicSend('a1')).rejects.toMatchObject({ message: 'locked', status: 401 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('api/send crypto round-trips', () => {
  it('buildSendShareKey + decryptPublicSend recover the plaintext', async () => {
    // Build a send end-to-end so we can then decrypt it with the URL-safe key,
    // exactly as a public recipient would from the share link.
    const session = unlockedSession();
    const draft = {
      type: 'text',
      name: 'Secret Name',
      notes: '',
      text: 'plaintext body',
      deletionDays: '1',
      expirationDays: '',
      maxAccessCount: '',
      password: '',
      disabled: false,
    };
    const capturedBodies: any[] = [];
    const authedFetch = vi.fn((_url: string, init: RequestInit) => {
      capturedBodies.push(JSON.parse(String(init.body)));
      return jsonResponse({ id: 's1' });
    });
    await createSend(authedFetch as any, session, draft as any);

    const urlSafeKey = await buildSendShareKey(capturedBodies[0].key, session.symEncKey!, session.symMacKey!);
    const accessData = { name: capturedBodies[0].name, text: { text: capturedBodies[0].text.text } };
    const decrypted = (await decryptPublicSend(accessData, urlSafeKey)) as Record<string, unknown>;
    expect(decrypted.decName).toBe('Secret Name');
    expect(decrypted.decText).toBe('plaintext body');
  });
});
