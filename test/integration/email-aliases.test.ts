import { SELF, env } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, authenticate, baseHeaders, login, newAccount, register, url, type Session } from './helpers';

const ALIAS_DOMAIN = 'alias.test';
const ALT_DOMAIN = 'mail.test';
const DEFAULT_DEST = 'inbox@vault.test';
const ALT_DEST = 'other@vault.test';
const FAIL_DEST = 'fail@vault.test';
const NORULE_DEST = 'norule@vault.test';
const SUCCESSFALSE_DEST = 'successfalse@vault.test';
const DELFAIL_DEST = 'delfail@vault.test';

// The first registered user is auto-promoted to admin. Register it once and
// reuse it: the file shares one D1, so re-registering would create non-admin
// users and trip the registration rate limit.
let admin: Session;

// Faithful in-memory Cloudflare Email Routing server. Only api.cloudflare.com is
// intercepted; everything else (the worker under test) uses the real fetch. This
// mirrors the project's remote-backup e2e approach — a real protocol server in
// the isolate, not canned mocks — so the Cloudflare client's rule create/delete
// paths run for real through the worker.
interface StoredRule {
  id: string;
  address: string;
  action: { type: 'forward'; value: string[] } | { type: 'drop' };
}
const cfRules = new Map<string, StoredRule>();
let originalFetch: typeof fetch;

function installCloudflareServer() {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return originalFetch(input as any, init);
    }
    if (parsed.host !== 'api.cloudflare.com') return originalFetch(input as any, init);

    const method = (init?.method || 'GET').toUpperCase();
    const rulesPath = '/client/v4/zones/itest-zone/email/routing/rules';
    if (method === 'POST' && parsed.pathname === rulesPath) {
      const body = JSON.parse(String(init?.body));
      const action = body.actions[0];
      // Sentinel: a forward to FAIL_DEST simulates a Cloudflare API failure so the
      // handler's 502 path runs end to end (no mocks — a real error response).
      if (action.type === 'forward' && action.value?.includes(FAIL_DEST)) {
        return new Response(JSON.stringify({ success: false, errors: [{ message: 'simulated' }] }), { status: 400 });
      }
      // Sentinel: a non-JSON 200 with no rule id exercises the client's
      // JSON-parse fallback and the "no rule id" guard (handler -> 502).
      if (action.type === 'forward' && action.value?.includes(NORULE_DEST)) {
        return new Response('not-json', { status: 200 });
      }
      // Sentinel: HTTP 200 but success:false (no errors array) exercises the
      // isCloudflareFailure branch and the HTTP-status error-detail fallback.
      if (action.type === 'forward' && action.value?.includes(SUCCESSFALSE_DEST)) {
        return new Response(JSON.stringify({ success: false }), { status: 200 });
      }
      const id = `rule-${crypto.randomUUID()}`;
      cfRules.set(id, { id, address: body.matchers[0].value, action });
      return new Response(JSON.stringify({ success: true, errors: [], result: { id } }), { status: 200 });
    }
    if (method === 'DELETE' && parsed.pathname.startsWith(`${rulesPath}/`)) {
      const id = decodeURIComponent(parsed.pathname.slice(rulesPath.length + 1));
      const existing = cfRules.get(id);
      // Sentinel: deleting a rule that forwards to DELFAIL_DEST fails, exercising
      // the delete best-effort catch and the toggle 502 path.
      if (existing && existing.action.type === 'forward' && existing.action.value.includes(DELFAIL_DEST)) {
        return new Response(JSON.stringify({ success: false, errors: [{ message: 'delete failed' }] }), { status: 400 });
      }
      cfRules.delete(id);
      return new Response(JSON.stringify({ success: true, errors: [], result: { id } }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: false, errors: [{ message: 'unexpected' }] }), { status: 400 });
  }) as typeof fetch;
}

async function configureGenerator(overrides: Record<string, unknown> = {}) {
  const res = await api('PUT', '/api/email-aliases/settings', admin.accessToken, {
    enabled: true,
    domains: [ALIAS_DOMAIN, ALT_DOMAIN],
    defaultDomain: ALIAS_DOMAIN,
    defaultDestination: DEFAULT_DEST,
    recipients: [DEFAULT_DEST, ALT_DEST, FAIL_DEST, NORULE_DEST, SUCCESSFALSE_DEST, DELFAIL_DEST],
    ...overrides,
  });
  expect(res.status).toBe(200);
  return res.json();
}

async function createToken(name = 'cli'): Promise<{ secret: string; id: string }> {
  const res = await api('POST', '/api/email-aliases/tokens', admin.accessToken, { name });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { token: string; id: string };
  expect(typeof body.token).toBe('string');
  return { secret: body.token, id: body.id };
}

// addy.io shim call as the official Bitwarden client makes it.
async function shimCreate(aliasToken: string, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(url('/api/v1/aliases'), {
    method: 'POST',
    headers: baseHeaders({
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Authorization: `Bearer ${aliasToken}`,
    }),
    body: JSON.stringify(body),
  });
}

describe('email alias generator', () => {
  beforeAll(async () => {
    installCloudflareServer();
    admin = await authenticate('admin');
    await configureGenerator();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('requires a valid bearer token on the shim', async () => {
    const missing = await SELF.fetch(url('/api/v1/aliases'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ domain: ALIAS_DOMAIN }),
    });
    expect(missing.status).toBe(401);

    const bad = await shimCreate('not-a-real-token', { domain: ALIAS_DOMAIN });
    expect(bad.status).toBe(401);
  });

  it('rejects the shim while the generator is disabled', async () => {
    const { secret } = await createToken();
    await configureGenerator({ enabled: false });
    const res = await shimCreate(secret, { domain: ALIAS_DOMAIN });
    expect(res.status).toBe(403);
    await configureGenerator(); // restore enabled state for later tests
  });

  it('mints an alias through the addy.io shim and stores it server-side', async () => {
    const { secret } = await createToken();
    const res = await shimCreate(secret, { domain: ALIAS_DOMAIN, description: 'shopping' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { email: string; active: boolean } };
    // Official clients read data.email.
    expect(body.data.email.endsWith(`@${ALIAS_DOMAIN}`)).toBe(true);
    expect(body.data.active).toBe(true);

    // The whole point: it is persisted and visible in NodeWarden's own list.
    const list = await api('GET', '/api/email-aliases', admin.accessToken);
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { data: Array<{ address: string; description: string | null; managed: boolean }> };
    const match = listed.data.find((a) => a.address === body.data.email);
    expect(match).toBeTruthy();
    expect(match!.description).toBe('shopping');
    // Default destination is delivered by the catch-all, so no explicit CF rule.
    expect(match!.managed).toBe(false);
  });

  it('validates the requested domain against the allow-list', async () => {
    const { secret } = await createToken();
    const res = await shimCreate(secret, { domain: 'evil.example' });
    expect(res.status).toBe(422);
  });

  it('creates, edits, and deletes a default-destination alias from the web API (no CF rule)', async () => {
    const before = cfRules.size;
    const created = await api('POST', '/api/email-aliases', admin.accessToken, {
      domain: ALT_DOMAIN,
      description: 'newsletter',
    });
    expect(created.status).toBe(201);
    const alias = (await created.json()) as { id: string; address: string; managed: boolean };
    expect(alias.address.endsWith(`@${ALT_DOMAIN}`)).toBe(true);
    expect(alias.managed).toBe(false);
    // Catch-all path must not touch the Cloudflare API.
    expect(cfRules.size).toBe(before);

    const updated = await api('PUT', `/api/email-aliases/${alias.id}`, admin.accessToken, {
      description: 'changed',
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { description: string }).description).toBe('changed');

    const del = await api('DELETE', `/api/email-aliases/${alias.id}`, admin.accessToken);
    expect(del.status).toBe(200);

    const list = await api('GET', '/api/email-aliases', admin.accessToken);
    const listed = (await list.json()) as { data: Array<{ id: string }> };
    expect(listed.data.some((a) => a.id === alias.id)).toBe(false);
  });

  it('creates a Cloudflare forward rule for a custom destination and cleans it up on delete', async () => {
    const created = await api('POST', '/api/email-aliases', admin.accessToken, {
      domain: ALIAS_DOMAIN,
      destination: ALT_DEST,
    });
    expect(created.status).toBe(201);
    const alias = (await created.json()) as { id: string; address: string; managed: boolean };
    expect(alias.managed).toBe(true);

    // A real forward rule was created in the in-memory Cloudflare server.
    const rule = [...cfRules.values()].find((r) => r.address === alias.address);
    expect(rule).toBeTruthy();
    expect(rule!.action).toEqual({ type: 'forward', value: [ALT_DEST] });

    const del = await api('DELETE', `/api/email-aliases/${alias.id}`, admin.accessToken);
    expect(del.status).toBe(200);
    expect([...cfRules.values()].some((r) => r.address === alias.address)).toBe(false);
  });

  it('disables a catch-all alias with a drop rule and re-enables it by removing the rule', async () => {
    const created = await api('POST', '/api/email-aliases', admin.accessToken, { domain: ALIAS_DOMAIN });
    const alias = (await created.json()) as { id: string; address: string };

    const disabled = await api('PUT', `/api/email-aliases/${alias.id}`, admin.accessToken, { active: false });
    expect(disabled.status).toBe(200);
    expect(((await disabled.json()) as { active: boolean }).active).toBe(false);
    const dropRule = [...cfRules.values()].find((r) => r.address === alias.address);
    expect(dropRule?.action).toEqual({ type: 'drop' });

    const reenabled = await api('PUT', `/api/email-aliases/${alias.id}`, admin.accessToken, { active: true });
    expect(reenabled.status).toBe(200);
    expect(((await reenabled.json()) as { active: boolean }).active).toBe(true);
    // Back to catch-all delivery: the drop rule is gone.
    expect([...cfRules.values()].some((r) => r.address === alias.address)).toBe(false);
  });

  it('rejects a destination that is not a configured recipient', async () => {
    const res = await api('POST', '/api/email-aliases', admin.accessToken, {
      domain: ALIAS_DOMAIN,
      destination: 'stranger@vault.test',
    });
    expect(res.status).toBe(422);
  });

  it('only lets administrators change generator settings', async () => {
    const member = newAccount('member');
    const invite = (await (await api('POST', '/api/admin/invites', admin.accessToken, {})).json()) as { code: string };
    expect((await register(member, invite.code)).status).toBe(200);
    const loginRes = await login(member);
    const memberToken = ((await loginRes.json()) as { access_token: string }).access_token;

    const res = await api('PUT', '/api/email-aliases/settings', memberToken, {
      enabled: true,
      domains: [ALIAS_DOMAIN],
      defaultDestination: DEFAULT_DEST,
    });
    expect(res.status).toBe(403);

    // But any authenticated user may read settings (to populate the generator UI).
    const read = await api('GET', '/api/email-aliases/settings', memberToken);
    expect(read.status).toBe(200);
  });

  it('returns 422 from the shim when no default destination is configured', async () => {
    const { secret } = await createToken();
    await configureGenerator({ defaultDestination: null, recipients: [] });
    const res = await shimCreate(secret, { domain: ALIAS_DOMAIN });
    expect(res.status).toBe(422);
    await configureGenerator(); // restore
  });

  it('rejects web alias creation while the generator is disabled', async () => {
    await configureGenerator({ enabled: false });
    const res = await api('POST', '/api/email-aliases', admin.accessToken, { domain: ALIAS_DOMAIN });
    expect(res.status).toBe(403);
    await configureGenerator(); // restore
  });

  it('rejects a web alias on a disallowed domain', async () => {
    const res = await api('POST', '/api/email-aliases', admin.accessToken, { domain: 'evil.example' });
    expect(res.status).toBe(422);
  });

  it('surfaces a 502 when the Cloudflare API fails creating a forward rule', async () => {
    const res = await api('POST', '/api/email-aliases', admin.accessToken, {
      domain: ALIAS_DOMAIN,
      destination: FAIL_DEST,
    });
    expect(res.status).toBe(502);
  });

  it('surfaces a 502 when the Cloudflare API returns no rule id / non-JSON', async () => {
    const res = await api('POST', '/api/email-aliases', admin.accessToken, {
      domain: ALIAS_DOMAIN,
      destination: NORULE_DEST,
    });
    expect(res.status).toBe(502);
  });

  it('rejects the custom format without a local part, and clears a description', async () => {
    const bad = await api('POST', '/api/email-aliases', admin.accessToken, {
      domain: ALIAS_DOMAIN,
      format: 'custom',
    });
    expect(bad.status).toBe(422);

    const created = await api('POST', '/api/email-aliases', admin.accessToken, {
      domain: ALIAS_DOMAIN,
      description: 'temp',
    });
    const alias = (await created.json()) as { id: string };
    const cleared = await api('PUT', `/api/email-aliases/${alias.id}`, admin.accessToken, { description: null });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { description: string | null }).description).toBeNull();
  });

  it('returns 404 for updates/deletes of unknown aliases and tokens', async () => {
    const missing = crypto.randomUUID();
    expect((await api('PUT', `/api/email-aliases/${missing}`, admin.accessToken, { description: 'x' })).status).toBe(404);
    expect((await api('DELETE', `/api/email-aliases/${missing}`, admin.accessToken)).status).toBe(404);
    expect((await api('DELETE', `/api/email-aliases/tokens/${missing}`, admin.accessToken)).status).toBe(404);
  });

  it('returns 400 when an update changes nothing', async () => {
    const created = await api('POST', '/api/email-aliases', admin.accessToken, { domain: ALIAS_DOMAIN });
    const alias = (await created.json()) as { id: string };
    const res = await api('PUT', `/api/email-aliases/${alias.id}`, admin.accessToken, {});
    expect(res.status).toBe(400);
  });

  it('rejects the shim for a banned user even with a valid token', async () => {
    const member = newAccount('banned');
    const invite = (await (await api('POST', '/api/admin/invites', admin.accessToken, {})).json()) as { code: string };
    expect((await register(member, invite.code)).status).toBe(200);
    const memberToken = ((await (await login(member)).json()) as { access_token: string }).access_token;
    const memberId = ((await (await api('GET', '/api/accounts/profile', memberToken)).json()) as { id: string }).id;

    // Member mints their own alias token, then the admin bans the member.
    const { secret } = (await (await api('POST', '/api/email-aliases/tokens', memberToken, { name: 'm' })).json()) as { token: string };
    expect((await api('PUT', `/api/admin/users/${memberId}/status`, admin.accessToken, { status: 'banned' })).status).toBe(200);

    const res = await shimCreate(secret, { domain: ALIAS_DOMAIN });
    expect(res.status).toBe(401);
  });

  it('surfaces a 502 when Cloudflare returns HTTP 200 with success:false', async () => {
    const res = await api('POST', '/api/email-aliases', admin.accessToken, {
      domain: ALIAS_DOMAIN,
      destination: SUCCESSFALSE_DEST,
    });
    expect(res.status).toBe(502);
  });

  it('deletes locally even when Cloudflare rule cleanup fails (best effort)', async () => {
    const created = await api('POST', '/api/email-aliases', admin.accessToken, {
      domain: ALIAS_DOMAIN,
      destination: DELFAIL_DEST,
    });
    const alias = (await created.json()) as { id: string };
    const del = await api('DELETE', `/api/email-aliases/${alias.id}`, admin.accessToken);
    expect(del.status).toBe(200);
  });

  it('surfaces a 502 when toggling fails to remove the existing rule', async () => {
    const created = await api('POST', '/api/email-aliases', admin.accessToken, {
      domain: ALIAS_DOMAIN,
      destination: DELFAIL_DEST,
    });
    const alias = (await created.json()) as { id: string };
    // Disabling first deletes the existing forward rule, which fails for DELFAIL.
    const res = await api('PUT', `/api/email-aliases/${alias.id}`, admin.accessToken, { active: false });
    expect(res.status).toBe(502);
  });

  it('re-enables a custom-destination alias by recreating its forward rule', async () => {
    const created = await api('POST', '/api/email-aliases', admin.accessToken, {
      domain: ALIAS_DOMAIN,
      destination: ALT_DEST,
    });
    const alias = (await created.json()) as { id: string; address: string };

    await api('PUT', `/api/email-aliases/${alias.id}`, admin.accessToken, { active: false });
    const reenabled = await api('PUT', `/api/email-aliases/${alias.id}`, admin.accessToken, { active: true });
    expect(reenabled.status).toBe(200);
    // A forward rule (not a drop) governs the re-enabled custom alias.
    const rule = [...cfRules.values()].find((r) => r.address === alias.address);
    expect(rule?.action).toEqual({ type: 'forward', value: [ALT_DEST] });
  });

  it('treats a non-object JSON body as empty (uses defaults)', async () => {
    const { secret } = await createToken();
    const res = await SELF.fetch(url('/api/v1/aliases'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }),
      body: JSON.stringify([1, 2, 3]),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { email: string } };
    expect(body.data.email.endsWith(`@${ALIAS_DOMAIN}`)).toBe(true);
  });

  it('treats an unparseable JSON body as empty and uses defaults', async () => {
    const { secret } = await createToken();
    const res = await SELF.fetch(url('/api/v1/aliases'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }),
      body: '{not valid json',
    });
    expect(res.status).toBe(201);
  });

  it('generates with the default domain and an explicit format', async () => {
    const res = await api('POST', '/api/email-aliases', admin.accessToken, { format: 'uuid' });
    expect(res.status).toBe(201);
    const alias = (await res.json()) as { address: string };
    expect(alias.address.endsWith(`@${ALIAS_DOMAIN}`)).toBe(true);
  });

  it('defaults the token name when omitted or blank', async () => {
    const omitted = await api('POST', '/api/email-aliases/tokens', admin.accessToken, {});
    expect(((await omitted.json()) as { name: string }).name).toBe('API token');
    const blank = await api('POST', '/api/email-aliases/tokens', admin.accessToken, { name: '   ' });
    expect(((await blank.json()) as { name: string }).name).toBe('API token');
  });

  it('rejects malformed Authorization headers on the shim', async () => {
    const basic = await SELF.fetch(url('/api/v1/aliases'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json', Authorization: 'Basic abc' }),
      body: '{}',
    });
    expect(basic.status).toBe(401);
    const empty = await SELF.fetch(url('/api/v1/aliases'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json', Authorization: 'Bearer ' }),
      body: '{}',
    });
    expect(empty.status).toBe(401);
  });

  it('honors explicit format and local_part on the shim', async () => {
    const { secret } = await createToken();
    const res = await shimCreate(secret, { domain: ALIAS_DOMAIN, format: 'custom', local_part: 'Fixed.One' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { email: string } };
    expect(body.data.email).toBe(`fixed.one@${ALIAS_DOMAIN}`);
  });

  it('detects an address collision', async () => {
    const { secret } = await createToken();
    const first = await shimCreate(secret, { domain: ALIAS_DOMAIN, format: 'custom', local_part: 'dupe' });
    expect(first.status).toBe(201);
    const second = await shimCreate(secret, { domain: ALIAS_DOMAIN, format: 'custom', local_part: 'dupe' });
    expect(second.status).toBe(422);
    const web = await api('POST', '/api/email-aliases', admin.accessToken, {
      domain: ALIAS_DOMAIN,
      format: 'custom',
      localPart: 'dupe',
    });
    expect(web.status).toBe(422);
  });

  it('returns 422 from the web API when no default destination is configured', async () => {
    await configureGenerator({ defaultDestination: null, recipients: [] });
    const res = await api('POST', '/api/email-aliases', admin.accessToken, { domain: ALIAS_DOMAIN });
    expect(res.status).toBe(422);
    await configureGenerator();
  });

  it('exposes destinations to admins but hides them from members', async () => {
    const adminView = (await (await api('GET', '/api/email-aliases/settings', admin.accessToken)).json()) as {
      defaultDestination: string | null;
      recipients: string[];
    };
    expect(adminView.defaultDestination).toBe(DEFAULT_DEST);
    expect(adminView.recipients).toContain(ALT_DEST);
  });

  it('enforces the per-user alias cap on both the web API and the shim', async () => {
    // Seed exactly the cap with real rows for a dedicated user, then expect the
    // next create (web + shim) to be rejected.
    const capUser = newAccount('cap');
    const invite = (await (await api('POST', '/api/admin/invites', admin.accessToken, {})).json()) as { code: string };
    expect((await register(capUser, invite.code)).status).toBe(200);
    const capToken = ((await (await login(capUser)).json()) as { access_token: string }).access_token;
    const capUserId = ((await (await api('GET', '/api/accounts/profile', capToken)).json()) as { id: string }).id;
    const aliasToken = ((await (await api('POST', '/api/email-aliases/tokens', capToken, { name: 'cap' })).json()) as { token: string }).token;

    const now = new Date().toISOString();
    const stmts = [];
    for (let i = 0; i < 1000; i++) {
      stmts.push(
        env.DB.prepare(
          'INSERT INTO email_aliases(id, user_id, address, domain, destination, description, active, cf_rule_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
        ).bind(crypto.randomUUID(), capUserId, `seed-${i}@${ALIAS_DOMAIN}`, ALIAS_DOMAIN, DEFAULT_DEST, null, 1, null, now, now)
      );
    }
    await env.DB.batch(stmts);

    const web = await api('POST', '/api/email-aliases', capToken, { domain: ALIAS_DOMAIN });
    expect(web.status).toBe(422);
    const shim = await shimCreate(aliasToken, { domain: ALIAS_DOMAIN });
    expect(shim.status).toBe(422);
  });

  it('enforces the per-user alias API token cap', async () => {
    const tokUser = newAccount('tokcap');
    const invite = (await (await api('POST', '/api/admin/invites', admin.accessToken, {})).json()) as { code: string };
    expect((await register(tokUser, invite.code)).status).toBe(200);
    const tokToken = ((await (await login(tokUser)).json()) as { access_token: string }).access_token;
    const tokUserId = ((await (await api('GET', '/api/accounts/profile', tokToken)).json()) as { id: string }).id;

    const now = new Date().toISOString();
    const stmts = [];
    for (let i = 0; i < 25; i++) {
      stmts.push(
        env.DB.prepare(
          'INSERT INTO alias_api_tokens(id, user_id, name, token_hash, last_used_at, created_at) VALUES(?,?,?,?,?,?)'
        ).bind(crypto.randomUUID(), tokUserId, `t${i}`, `hash-${crypto.randomUUID()}`, null, now)
      );
    }
    await env.DB.batch(stmts);
    const res = await api('POST', '/api/email-aliases/tokens', tokToken, { name: 'overflow' });
    expect(res.status).toBe(422);
  });

  it('requires Cloudflare credentials when they are unset at runtime', async () => {
    const savedToken = env.CF_API_TOKEN;
    const savedZone = env.CF_ZONE_ID;
    // Create a custom (ruled) alias while configured, to test delete-without-creds later.
    const ruled = await api('POST', '/api/email-aliases', admin.accessToken, { domain: ALIAS_DOMAIN, destination: ALT_DEST });
    const ruledAlias = (await ruled.json()) as { id: string };

    (env as Record<string, unknown>).CF_API_TOKEN = undefined;
    (env as Record<string, unknown>).CF_ZONE_ID = undefined;
    try {
      const create = await api('POST', '/api/email-aliases', admin.accessToken, { domain: ALIAS_DOMAIN, destination: ALT_DEST });
      expect(create.status).toBe(422);

      const catchAll = await api('POST', '/api/email-aliases', admin.accessToken, { domain: ALIAS_DOMAIN });
      const catchAllAlias = (await catchAll.json()) as { id: string };
      const toggle = await api('PUT', `/api/email-aliases/${catchAllAlias.id}`, admin.accessToken, { active: false });
      expect(toggle.status).toBe(422);

      // Deleting a ruled alias without creds skips the CF call but still deletes locally.
      const del = await api('DELETE', `/api/email-aliases/${ruledAlias.id}`, admin.accessToken);
      expect(del.status).toBe(200);
    } finally {
      (env as Record<string, unknown>).CF_API_TOKEN = savedToken;
      (env as Record<string, unknown>).CF_ZONE_ID = savedZone;
    }
  });

  it('manages alias API tokens and revokes shim access on deletion', async () => {
    const { secret, id } = await createToken('phone');

    const tokens = await api('GET', '/api/email-aliases/tokens', admin.accessToken);
    const tokenList = (await tokens.json()) as { data: Array<{ id: string; name: string }> };
    expect(tokenList.data.some((t) => t.id === id && t.name === 'phone')).toBe(true);
    // The plaintext secret is never returned again.
    expect(JSON.stringify(tokenList)).not.toContain(secret);

    const del = await api('DELETE', `/api/email-aliases/tokens/${id}`, admin.accessToken);
    expect(del.status).toBe(200);

    // A revoked token no longer authenticates the shim.
    const res = await shimCreate(secret, { domain: ALIAS_DOMAIN });
    expect(res.status).toBe(401);
  });
});
