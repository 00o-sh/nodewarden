import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { url } from './helpers';

// Grant-type validation branches of handleToken (POST /identity/connect/token),
// driven through the real worker with genuinely-invalid inputs. No mocks.
let ipCounter = 30;
function token(params: Record<string, string>, opts: { ip?: boolean } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    Origin: 'https://vault.test',
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (opts.ip !== false) headers['CF-Connecting-IP'] = `198.51.105.${ipCounter++}`;
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers,
    body: new URLSearchParams(params).toString(),
  });
}

describe('handleToken grant validation', () => {
  it('403s when the client IP cannot be determined', async () => {
    const res = await token({ grant_type: 'password', username: 'a@b.test', password: 'x' }, { ip: false });
    expect(res.status).toBe(403);
  });

  it('400s a webauthn grant missing token and deviceResponse', async () => {
    const res = await token({ grant_type: 'webauthn' });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('required');
  });

  it('400s a webauthn grant with an unparseable deviceResponse', async () => {
    const res = await token({ grant_type: 'webauthn', token: 'tok', deviceResponse: '{not-json' });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid passkey response');
  });

  it('400s client_credentials with invalid parameters', async () => {
    const res = await token({ grant_type: 'client_credentials', client_id: 'web', client_secret: 's', scope: 'api offline_access' });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('parameter error');
  });

  it('400s client_credentials for an unknown user', async () => {
    const res = await token({ grant_type: 'client_credentials', client_id: `user.${crypto.randomUUID()}`, client_secret: 'secret', scope: 'api' });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('clientid or clientsecret is incorrect');
  });

  it('400s a send_access grant with no send_id', async () => {
    const res = await token({ grant_type: 'send_access' });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('send_id is required');
  });
});
