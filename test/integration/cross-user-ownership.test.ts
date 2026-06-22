import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, login, newAccount, register } from './helpers';

// Cross-user ownership guards: a second (invited) user must not be able to read
// or mutate another user's cipher, folder or send. These exercise the
// "resource exists but belongs to someone else" 404 branches, which are
// distinct from the "resource does not exist" branches. Real D1, no mocks.
let admin: Session;
let memberToken: string;
let cipherId: string;
let folderId: string;
let sendId: string;

const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

beforeAll(async () => {
  admin = await authenticate('crossowner');
  cipherId = ((await (await api('POST', '/api/ciphers', admin.accessToken, {
    type: 1, name: ENC_STRING, login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
  })).json()) as any).id;
  folderId = ((await (await api('POST', '/api/folders', admin.accessToken, { name: ENC_STRING })).json()) as any).id;
  sendId = ((await (await api('POST', '/api/sends', admin.accessToken, {
    type: 0, name: ENC_STRING, key: ENC_STRING, deletionDate: future(), text: { text: ENC_STRING, hidden: false },
  })).json()) as any).id;

  const invite = (await (await api('POST', '/api/admin/invites', admin.accessToken, {})).json()) as any;
  const member = newAccount('member');
  expect((await register(member, invite.code)).status).toBe(200);
  memberToken = ((await (await login(member)).json()) as any).access_token;
});

describe('a user cannot access another user\'s resources', () => {
  it('404s reading another user\'s cipher', async () => {
    expect((await api('GET', `/api/ciphers/${cipherId}`, memberToken)).status).toBe(404);
  });

  it('404s updating another user\'s cipher', async () => {
    const res = await api('PUT', `/api/ciphers/${cipherId}`, memberToken, {
      type: 1, name: ENC_STRING, login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
    });
    expect(res.status).toBe(404);
  });

  it('404s deleting another user\'s cipher', async () => {
    expect((await api('DELETE', `/api/ciphers/${cipherId}`, memberToken)).status).toBe(404);
  });

  it('404s deleting another user\'s folder', async () => {
    expect((await api('DELETE', `/api/folders/${folderId}`, memberToken)).status).toBe(404);
  });

  it('404s reading another user\'s send', async () => {
    expect((await api('GET', `/api/sends/${sendId}`, memberToken)).status).toBe(404);
  });
});
