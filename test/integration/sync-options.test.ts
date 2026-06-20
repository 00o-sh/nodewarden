import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, createCipher, createFolder, enc, sync } from './helpers';

// Sync query-option branches: excludeDomains / excludeSends.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('syncopts');
  token = session.accessToken;
  // Seed some content so the exclusions are observable.
  await createCipher(token);
  await createFolder(token);
  await api('POST', '/api/sends', token, {
    type: 0,
    name: enc('s'),
    key: ENC_STRING,
    deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    text: { text: enc('x'), hidden: false },
  });
});

describe('sync exclusions', () => {
  it('includes domains and sends by default', async () => {
    const vault = (await (await sync(token)).json()) as any;
    expect(vault.domains).not.toBeNull();
    expect(Array.isArray(vault.sends)).toBe(true);
    expect(vault.sends.length).toBeGreaterThanOrEqual(1);
  });

  it('omits domains when excludeDomains=true', async () => {
    const vault = (await (await api('GET', '/api/sync?excludeDomains=true', token)).json()) as any;
    expect(vault.domains).toBeNull();
  });

  it('omits sends when excludeSends=true', async () => {
    const vault = (await (await api('GET', '/api/sync?excludeSends=true', token)).json()) as any;
    expect(vault.sends).toEqual([]);
  });

  it('still serves ciphers regardless of exclusions', async () => {
    const vault = (await (await api('GET', '/api/sync?excludeDomains=1&excludeSends=1', token)).json()) as any;
    expect(vault.ciphers.length).toBeGreaterThanOrEqual(1);
  });
});
