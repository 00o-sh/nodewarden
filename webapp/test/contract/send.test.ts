import { beforeAll, describe, expect, it } from 'vitest';
import {
  accessPublicSend,
  accessPublicSendFile,
  buildSendShareKey,
  bulkDeleteSends,
  createSend,
  decryptPublicSend,
  deleteSend,
  getSendById,
  getSends,
  updateSend,
} from '@/lib/api/send';
import type { SendDraft } from '@/lib/types';
import { type ContractSession, registerAndLogin } from './helpers';

// Send lifecycle driven through the real webapp api client against the real
// worker, with real client-side Send encryption (random send key wrapped under
// the user's vault keys). Proves the encrypt -> POST -> fetch -> public-access
// -> decrypt loop agrees with the backend end to end.
let ctx: ContractSession;

function textDraft(over: Partial<SendDraft> = {}): SendDraft {
  return {
    type: 'text',
    name: 'My Secret Note',
    notes: '',
    text: 'the password is hunter2',
    file: null,
    deletionDays: '7',
    expirationDays: '',
    maxAccessCount: '',
    password: '',
    disabled: false,
    ...over,
  };
}

beforeAll(async () => {
  ctx = await registerAndLogin('send');
});

describe('send CRUD contract', () => {
  it('creates a text send the backend stores with an id and accessId', async () => {
    const created = await createSend(ctx.authedFetch, ctx.session, textDraft());
    expect(created.id).toBeTruthy();
    expect(created.accessId).toBeTruthy();
    expect(created.type).toBe(0);
    // The wrapped send key round-trips back from the worker.
    expect(created.key).toBeTruthy();
    expect(created.deletionDate).toBeTruthy();
  });

  it('lists sends including a freshly created one', async () => {
    const created = await createSend(ctx.authedFetch, ctx.session, textDraft({ name: 'Listed' }));
    const sends = await getSends(ctx.authedFetch);
    expect(Array.isArray(sends)).toBe(true);
    expect(sends.some((s) => s.id === created.id)).toBe(true);
  });

  it('fetches a send by id', async () => {
    const created = await createSend(ctx.authedFetch, ctx.session, textDraft({ name: 'ById' }));
    const fetched = await getSendById(ctx.authedFetch, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.accessId).toBe(created.accessId);
    expect(fetched.key).toBeTruthy();
  });

  it('updates a send (changes text and metadata)', async () => {
    const created = await createSend(ctx.authedFetch, ctx.session, textDraft({ name: 'Before' }));
    const updated = await updateSend(
      ctx.authedFetch,
      ctx.session,
      created,
      textDraft({ name: 'After', text: 'updated content', maxAccessCount: '5' })
    );
    expect(updated.id).toBe(created.id);
    expect(updated.maxAccessCount).toBe(5);

    // Confirm the change survived a round-trip and decrypts to the new value.
    const fetched = await getSendById(ctx.authedFetch, created.id);
    const shareKey = await buildSendShareKey(
      fetched.key as string,
      ctx.session.symEncKey!,
      ctx.session.symMacKey!
    );
    const access = await accessPublicSend(fetched.accessId, shareKey);
    const decrypted = (await decryptPublicSend(access, shareKey)) as {
      decName?: string;
      decText?: string;
    };
    expect(decrypted.decName).toBe('After');
    expect(decrypted.decText).toBe('updated content');
  });

  it('deletes a send so it is gone afterwards', async () => {
    const created = await createSend(ctx.authedFetch, ctx.session, textDraft({ name: 'ToDelete' }));
    await expect(deleteSend(ctx.authedFetch, created.id)).resolves.toBeUndefined();

    const sends = await getSends(ctx.authedFetch);
    expect(sends.some((s) => s.id === created.id)).toBe(false);
    await expect(getSendById(ctx.authedFetch, created.id)).rejects.toThrow();
  });

  it('bulk-deletes sends', async () => {
    const a = await createSend(ctx.authedFetch, ctx.session, textDraft({ name: 'BulkA' }));
    const b = await createSend(ctx.authedFetch, ctx.session, textDraft({ name: 'BulkB' }));
    await expect(bulkDeleteSends(ctx.authedFetch, [a.id, b.id])).resolves.toBeUndefined();

    const sends = await getSends(ctx.authedFetch);
    expect(sends.some((s) => s.id === a.id)).toBe(false);
    expect(sends.some((s) => s.id === b.id)).toBe(false);
  });
});

describe('send public access contract', () => {
  it('accesses a created text send via its accessId and decrypts it with the share key', async () => {
    const created = await createSend(
      ctx.authedFetch,
      ctx.session,
      textDraft({ name: 'Shared Note', text: 'public secret payload' })
    );

    // The owner derives the URL-safe share key from the wrapped send key.
    const shareKey = await buildSendShareKey(
      created.key as string,
      ctx.session.symEncKey!,
      ctx.session.symMacKey!
    );
    expect(shareKey).toBeTruthy();

    const access = await accessPublicSend(created.accessId, shareKey);
    const decrypted = (await decryptPublicSend(access, shareKey)) as {
      decName?: string;
      decText?: string;
    };
    expect(decrypted.decName).toBe('Shared Note');
    expect(decrypted.decText).toBe('public secret payload');
  });

  it('rejects public access for a non-existent accessId (guard path)', async () => {
    await expect(accessPublicSend('does-not-exist-access-id')).rejects.toThrow();
  });

  // accessPublicSendFile / decryptPublicSendFileBytes are only exercised for
  // their guard paths: this harness cannot create a file send because the
  // worker hands back a presigned upload URL on a non-app origin which the
  // contract fetch shim does not proxy, so there is no real file to access.
  it('rejects public file access for a non-existent send/file (guard path)', async () => {
    await expect(accessPublicSendFile('no-send', 'no-file')).rejects.toThrow();
  });
});
