import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { baseHeaders, url } from './helpers';

// A couple of public routes that aren't on the main auth path: the Chrome
// devtools well-known probe (always 200 {}), and the password-prelogin endpoint
// which returns KDF parameters for any email. Real worker, no mocks.
describe('public router extra routes', () => {
  it('serves the chrome devtools well-known probe', async () => {
    const res = await SELF.fetch(url('/.well-known/appspecific/com.chrome.devtools.json'), {
      headers: baseHeaders(),
    });
    expect(res.status).toBe(200);
  });

  it('returns KDF parameters from the password-prelogin endpoint', async () => {
    const res = await SELF.fetch(url('/identity/accounts/prelogin/password'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email: 'someone@vault.test' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // Prelogin always returns KDF info (defaults for unknown accounts).
    expect(body).toHaveProperty('kdf');
  });
});
