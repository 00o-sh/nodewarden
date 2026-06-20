import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, sync } from './helpers';

let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('domains');
  token = session.accessToken;
});

describe('equivalent domains', () => {
  it('returns the default domains shape', async () => {
    const res = await api('GET', '/api/settings/domains', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // Global equivalent domains are server-provided; custom/equivalent are user-set.
    expect(body).toHaveProperty('globalEquivalentDomains');
    expect(body).toHaveProperty('equivalentDomains');
  });

  it('saves custom equivalent domains and reflects them on read and in sync', async () => {
    const put = await api('PUT', '/api/settings/domains', token, {
      equivalentDomains: [['example.com', 'example.net']],
      excludedGlobalEquivalentDomains: [],
    });
    expect(put.status).toBe(200);

    const get = (await (await api('GET', '/api/settings/domains', token)).json()) as any;
    const flat = JSON.stringify(get.equivalentDomains || []);
    expect(flat).toContain('example.com');
    expect(flat).toContain('example.net');

    // Domains also ride along on the sync envelope.
    const vault = (await (await sync(token)).json()) as any;
    expect(vault.domains).not.toBeNull();
  });

  it('ignores invalid domain entries without erroring', async () => {
    const res = await api('PUT', '/api/settings/domains', token, {
      equivalentDomains: [['not a domain', 'also bad']],
    });
    expect(res.status).toBe(200);
  });
});
