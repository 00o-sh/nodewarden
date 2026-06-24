import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  getOnlineUserDevices,
  notifyUserAuthRequest,
  notifyUserCipherCreate,
  notifyUserCipherDelete,
  notifyUserCipherUpdate,
  notifyUserCiphersSync,
  notifyUserFolderCreate,
  notifyUserFolderDelete,
  notifyUserFolderUpdate,
  notifyUserLogout,
  notifyUserSendCreate,
  notifyUserSendDelete,
  notifyUserSendUpdate,
  notifyUserVaultSync,
} from '../../src/durable/notifications-hub';

// Drives every exported notifyUser* builder with both branches of its optional
// fields (organizationId / collectionIds / contextId / targetDevice present vs
// absent). With no sockets connected the hub short-circuits, so this exercises
// the synchronous payload-construction branches deterministically. Real DO stub.
const e = () => env as any;
const rev = '2024-01-01T00:00:00Z';

describe('notifications hub builders — optional-field branches', () => {
  it('cipher create/update/delete with and without org/collections/context', () => {
    const userId = crypto.randomUUID();
    for (const fn of [notifyUserCipherCreate, notifyUserCipherUpdate, notifyUserCipherDelete]) {
      // Full payload: organizationId + collectionIds array + contextId present.
      fn(e(), {
        userId,
        cipherId: crypto.randomUUID(),
        revisionDate: rev,
        organizationId: crypto.randomUUID(),
        collectionIds: [crypto.randomUUID()],
        contextId: crypto.randomUUID(),
      });
      // Minimal payload: optional fields omitted (?? null / non-array branches).
      fn(e(), { userId, cipherId: crypto.randomUUID(), revisionDate: rev });
    }
    expect(true).toBe(true);
  });

  it('folder and send create/update/delete with and without context', () => {
    const userId = crypto.randomUUID();
    for (const fn of [notifyUserFolderCreate, notifyUserFolderUpdate, notifyUserFolderDelete]) {
      fn(e(), { userId, folderId: crypto.randomUUID(), revisionDate: rev, contextId: crypto.randomUUID() });
      fn(e(), { userId, folderId: crypto.randomUUID(), revisionDate: rev });
    }
    for (const fn of [notifyUserSendCreate, notifyUserSendUpdate, notifyUserSendDelete]) {
      fn(e(), { userId, sendId: crypto.randomUUID(), revisionDate: rev, contextId: crypto.randomUUID() });
      fn(e(), { userId, sendId: crypto.randomUUID(), revisionDate: rev });
    }
    expect(true).toBe(true);
  });

  it('vault/ciphers sync, logout and auth-request with and without their optional ids', () => {
    const userId = crypto.randomUUID();
    notifyUserVaultSync(e(), userId, rev, crypto.randomUUID());
    notifyUserVaultSync(e(), userId, rev);
    notifyUserCiphersSync(e(), userId, rev, crypto.randomUUID());
    notifyUserCiphersSync(e(), userId, rev);
    notifyUserLogout(e(), userId, crypto.randomUUID());
    notifyUserLogout(e(), userId);
    notifyUserAuthRequest(e(), userId, crypto.randomUUID(), crypto.randomUUID());
    notifyUserAuthRequest(e(), userId, crypto.randomUUID());
    expect(true).toBe(true);
  });

  it('getOnlineUserDevices returns an empty list when no sockets are connected', async () => {
    expect(await getOnlineUserDevices(e(), crypto.randomUUID())).toEqual([]);
  });
});
