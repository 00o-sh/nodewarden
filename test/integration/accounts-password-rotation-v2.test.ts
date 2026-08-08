import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, login } from './helpers';

// v1.8.0 change-master-password rotation via the structured
// authenticationData/unlockData envelope (the Bitwarden key-rotation shape).
// Exercises the validation branches that the legacy newMasterPasswordHash+key
// body never reaches: paired-presence, completeness, KDF-consistency between the
// two halves, salt binding to the account email, and the refusal to change KDF
// through the password endpoint. Real worker + real D1 + real password hashing.
let session: Session;

function kdf(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { kdfType: 0, iterations: 600000, ...overrides };
}

function rotationBody(
  email: string,
  auth: Record<string, unknown> = {},
  unlock: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    masterPasswordHash: session.account.masterPasswordHash,
    authenticationData: {
      masterPasswordAuthenticationHash: btoa(`new-${crypto.randomUUID()}`),
      kdf: kdf(),
      salt: email,
      ...auth,
    },
    unlockData: {
      masterKeyWrappedUserKey: ENC_STRING,
      kdf: kdf(),
      salt: email,
      ...unlock,
    },
  };
}

beforeAll(async () => {
  session = await authenticate('pwrot');
});

describe('change master password (authenticationData/unlockData envelope)', () => {
  const path = '/api/accounts/password';

  it('rejects when only authenticationData is provided (must be paired)', async () => {
    const body = rotationBody(session.account.email);
    delete (body as Record<string, unknown>).unlockData;
    const res = await api('POST', path, session.accessToken, body);
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('must be provided together');
  });

  it('rejects an incomplete envelope (missing wrapped user key)', async () => {
    const res = await api(
      'POST',
      path,
      session.accessToken,
      rotationBody(session.account.email, {}, { masterKeyWrappedUserKey: '' })
    );
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('incomplete');
  });

  it('rejects an envelope with no KDF settings', async () => {
    const res = await api(
      'POST',
      path,
      session.accessToken,
      rotationBody(session.account.email, { kdf: {} }, { kdf: {} })
    );
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('must include kdf settings');
  });

  it('rejects when the two halves disagree on KDF settings', async () => {
    const res = await api(
      'POST',
      path,
      session.accessToken,
      rotationBody(session.account.email, {}, { kdf: kdf({ iterations: 700000 }) })
    );
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('must use the same kdf settings');
  });

  it('rejects when the salt does not bind to the account email', async () => {
    const res = await api(
      'POST',
      path,
      session.accessToken,
      rotationBody(session.account.email, { salt: 'someone-else@vault.test' }, { salt: 'someone-else@vault.test' })
    );
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid master password salt');
  });

  it('refuses to change the KDF via the password endpoint', async () => {
    const res = await api(
      'POST',
      path,
      session.accessToken,
      rotationBody(
        session.account.email,
        { kdf: kdf({ iterations: 700000 }) },
        { kdf: kdf({ iterations: 700000 }) }
      )
    );
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('kdf settings cannot be changed');
  });

  it('rejects a legacy body that also tries to change the KDF iterations', async () => {
    const res = await api('POST', path, session.accessToken, {
      masterPasswordHash: session.account.masterPasswordHash,
      newMasterPasswordHash: btoa(`x-${crypto.randomUUID()}`),
      newKey: ENC_STRING,
      kdf: 0,
      kdfIterations: 700000, // differs from the account's 600000
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('kdf settings cannot be changed');
  });

  it('rejects a master password hint longer than 120 characters', async () => {
    const res = await api('POST', path, session.accessToken, {
      masterPasswordHash: session.account.masterPasswordHash,
      newMasterPasswordHash: btoa(`x-${crypto.randomUUID()}`),
      newKey: ENC_STRING,
      kdf: 0,
      kdfIterations: 600000,
      masterPasswordHint: 'z'.repeat(121),
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('120 characters or fewer');
  });

  it('rotates the master password when the envelope is complete and consistent', async () => {
    const newHash = btoa(`rotated-${crypto.randomUUID()}`);
    const res = await api('POST', path, session.accessToken, {
      masterPasswordHash: session.account.masterPasswordHash,
      authenticationData: {
        masterPasswordAuthenticationHash: newHash,
        kdf: kdf(),
        salt: session.account.email,
      },
      unlockData: {
        masterKeyWrappedUserKey: ENC_STRING,
        kdf: kdf(),
        salt: session.account.email,
      },
    });
    expect(res.status).toBe(200);

    // The new password authenticates; the old one no longer does.
    expect((await login(session.account)).status).toBe(400);
    expect((await login({ ...session.account, masterPasswordHash: newHash })).status).toBe(200);
  });
});
