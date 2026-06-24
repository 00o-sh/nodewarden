import { describe, expect, it } from 'vitest';
import { mobilePayloadFromSignalR } from '../src/services/push-relay';

// Security boundary: the only data NodeWarden relays through Bitwarden's public
// push service is non-secret routing metadata (entity id, owner, revision). The
// builder must never copy vault secrets (names, notes, passwords, keys) out of
// the source notification payload, regardless of what fields it contains.
const ALLOWED_KEYS = new Set(['id', 'userId', 'organizationId', 'collectionIds', 'revisionDate', 'date']);

describe('mobilePayloadFromSignalR — push payloads are metadata-only', () => {
  it('emits only id/owner/revision metadata for an entity event and drops secret fields', () => {
    const out = mobilePayloadFromSignalR(1, 'user-1', '2024-01-01T00:00:00Z', {
      Id: 'cipher-1',
      OrganizationId: 'org-1',
      CollectionIds: ['col-1'],
      RevisionDate: '2024-02-02T00:00:00Z',
      // None of the following must ever reach the push relay:
      Name: 'super-secret-name',
      Notes: 'super-secret-notes',
      Login: { username: 'alice', password: 'hunter2' },
      Key: 'encrypted-cipher-key',
    });

    for (const key of Object.keys(out)) {
      expect(ALLOWED_KEYS.has(key)).toBe(true);
    }
    expect(out.id).toBe('cipher-1');
    expect(out.organizationId).toBe('org-1');
    expect(out.revisionDate).toBe('2024-02-02T00:00:00Z');

    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('super-secret-notes');
    expect(serialized).not.toContain('encrypted-cipher-key');
  });

  it('falls back to a user/date-only payload when there is no entity id', () => {
    expect(mobilePayloadFromSignalR(5, 'user-2', '2024-03-03T00:00:00Z', null)).toEqual({
      userId: 'user-2',
      date: '2024-03-03T00:00:00Z',
    });
  });

  it('reads lowercase source field names and defaults the owner/revision from arguments', () => {
    expect(mobilePayloadFromSignalR(1, 'user-1', 'fallback-rev', { id: 'x' })).toEqual({
      id: 'x',
      userId: 'user-1',
      organizationId: null,
      collectionIds: null,
      revisionDate: 'fallback-rev',
    });
  });
});
