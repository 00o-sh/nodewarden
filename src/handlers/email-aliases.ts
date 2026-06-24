import type { AliasApiToken, EmailAlias, Env, User } from '../types';
import { StorageService } from '../services/storage';
import { errorResponse, jsonResponse } from '../utils/response';
import { generateUUID } from '../utils/uuid';
import {
  buildAliasAddress,
  getAliasSettings,
  isAliasGeneratorReady,
  sanitizeAliasSettings,
  saveAliasSettings,
} from '../services/alias-generator';
import {
  getCloudflareEmailClient,
  isCloudflareEmailConfigured,
} from '../services/cloudflare-email';
import { auditRequestMetadata, safeWriteAuditEvent } from '../services/audit-events';

const MAX_ALIASES_PER_USER = 1000;
const MAX_TOKENS_PER_USER = 25;

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function generateApiTokenSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function bearerToken(request: Request): string | null {
  // Requires at least one non-space char after "Bearer ", so an empty/whitespace
  // token yields null without a separate emptiness branch.
  const match = String(request.headers.get('Authorization') || '').match(/^Bearer\s+(\S.*)$/i);
  return match ? match[1].trim() : null;
}

// addy.io-compatible response shape. Official Bitwarden clients read `data.email`.
function aliasToAddyResponse(alias: EmailAlias): Record<string, unknown> {
  const [localPart] = alias.address.split('@');
  return {
    data: {
      id: alias.id,
      user_id: alias.userId,
      email: alias.address,
      local_part: localPart,
      domain: alias.domain,
      description: alias.description,
      active: alias.active,
      created_at: alias.createdAt,
      updated_at: alias.updatedAt,
    },
  };
}

function aliasToResponse(alias: EmailAlias): Record<string, unknown> {
  return {
    id: alias.id,
    address: alias.address,
    domain: alias.domain,
    destination: alias.destination,
    description: alias.description,
    active: alias.active,
    managed: alias.cfRuleId !== null,
    createdAt: alias.createdAt,
    updatedAt: alias.updatedAt,
    object: 'emailAlias',
  };
}

function tokenToResponse(token: AliasApiToken): Record<string, unknown> {
  return {
    id: token.id,
    name: token.name,
    lastUsedAt: token.lastUsedAt,
    createdAt: token.createdAt,
    object: 'aliasApiToken',
  };
}

// POST /api/v1/aliases  (addy.io-compatible shim used by official Bitwarden clients)
// Authenticated by a per-user alias API token (Bearer), NOT a NodeWarden session.
export async function handleCreateAliasShim(request: Request, env: Env): Promise<Response> {
  const presented = bearerToken(request);
  if (!presented) {
    return jsonResponse({ message: 'Unauthenticated.' }, 401);
  }

  const storage = new StorageService(env.DB);
  await storage.initializeDatabase();

  const tokenHash = await sha256Hex(presented);
  const token = await storage.getActiveAliasApiTokenByHash(tokenHash);
  if (!token) {
    return jsonResponse({ message: 'Unauthenticated.' }, 401);
  }

  const settings = await getAliasSettings(storage);
  if (!isAliasGeneratorReady(env, settings)) {
    return jsonResponse({ message: 'Email alias generator is not enabled on this server.' }, 403);
  }

  const body = await readJson(request);
  let built: ReturnType<typeof buildAliasAddress>;
  try {
    built = buildAliasAddress(settings, {
      domain: typeof body.domain === 'string' ? body.domain : null,
      format: typeof body.format === 'string' ? body.format : null,
      localPart: typeof body.local_part === 'string' ? body.local_part : null,
    });
  } catch (error) {
    return jsonResponse({ message: (error as Error).message }, 422);
  }

  if (!settings.defaultDestination) {
    return jsonResponse({ message: 'No default forwarding destination is configured.' }, 422);
  }

  if ((await storage.countEmailAliasesByUserId(token.userId)) >= MAX_ALIASES_PER_USER) {
    return jsonResponse({ message: 'Alias limit reached.' }, 422);
  }

  // Guard against the (rare) random collision on the unique address.
  if (await storage.getEmailAliasByAddress(built.address)) {
    return jsonResponse({ message: 'Alias already exists, please retry.' }, 422);
  }

  const now = new Date().toISOString();
  const alias: EmailAlias = {
    id: generateUUID(),
    userId: token.userId,
    address: built.address,
    domain: built.domain,
    destination: settings.defaultDestination,
    description: typeof body.description === 'string' ? body.description.slice(0, 200) : null,
    active: true,
    // Default destination is delivered by the zone catch-all; no explicit rule.
    cfRuleId: null,
    createdAt: now,
    updatedAt: now,
  };
  await storage.createEmailAlias(alias);
  await storage.touchAliasApiTokenLastUsed(token.id);
  await safeWriteAuditEvent(env, {
    actorUserId: token.userId,
    action: 'alias.created',
    category: 'data',
    level: 'info',
    targetType: 'emailAlias',
    targetId: alias.id,
    metadata: { source: 'shim', domain: alias.domain, ...auditRequestMetadata(request) },
  });

  return jsonResponse(aliasToAddyResponse(alias), 201);
}

// GET /api/email-aliases
export async function handleListAliases(env: Env, userId: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const aliases = await storage.listEmailAliasesByUserId(userId);
  return jsonResponse({ data: aliases.map(aliasToResponse), object: 'list' });
}

// POST /api/email-aliases  (webapp generator; supports advanced destination override)
export async function handleCreateAlias(request: Request, env: Env, userId: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const settings = await getAliasSettings(storage);
  if (!isAliasGeneratorReady(env, settings)) {
    return errorResponse('Email alias generator is not enabled on this server.', 403);
  }

  const body = await readJson(request);
  let built: ReturnType<typeof buildAliasAddress>;
  try {
    built = buildAliasAddress(settings, {
      domain: typeof body.domain === 'string' ? body.domain : null,
      format: typeof body.format === 'string' ? body.format : null,
      localPart: typeof body.localPart === 'string' ? body.localPart : null,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 422);
  }

  // Resolve destination: default (catch-all) unless an allowed override is given.
  const requestedDestination =
    typeof body.destination === 'string' ? body.destination.trim().toLowerCase() : '';
  const useDefault = !requestedDestination || requestedDestination === settings.defaultDestination;
  if (!useDefault && !settings.recipients.includes(requestedDestination)) {
    return errorResponse('Destination is not in the configured recipients.', 422);
  }
  const destination = useDefault ? settings.defaultDestination : requestedDestination;
  if (!destination) {
    return errorResponse('No forwarding destination is configured.', 422);
  }

  if ((await storage.countEmailAliasesByUserId(userId)) >= MAX_ALIASES_PER_USER) {
    return errorResponse('Alias limit reached.', 422);
  }
  if (await storage.getEmailAliasByAddress(built.address)) {
    return errorResponse('Alias already exists, please retry.', 422);
  }

  // A non-default destination needs an explicit Email Routing rule (overrides catch-all).
  let cfRuleId: string | null = null;
  if (!useDefault) {
    if (!isCloudflareEmailConfigured(env)) {
      return errorResponse(
        'A custom destination requires Cloudflare API credentials (CF_API_TOKEN, CF_ZONE_ID).',
        422
      );
    }
    try {
      cfRuleId = await getCloudflareEmailClient(env).createForwardRule(built.address, destination);
    } catch {
      // Credentials were already verified above, so a failure here is an API error.
      return errorResponse('Failed to create the Cloudflare Email Routing rule.', 502);
    }
  }

  const now = new Date().toISOString();
  const alias: EmailAlias = {
    id: generateUUID(),
    userId,
    address: built.address,
    domain: built.domain,
    destination,
    description: typeof body.description === 'string' ? body.description.slice(0, 200) : null,
    active: true,
    cfRuleId,
    createdAt: now,
    updatedAt: now,
  };
  await storage.createEmailAlias(alias);
  await safeWriteAuditEvent(env, {
    actorUserId: userId,
    action: 'alias.created',
    category: 'data',
    level: 'info',
    targetType: 'emailAlias',
    targetId: alias.id,
    metadata: { source: 'web', domain: alias.domain, custom: !useDefault, ...auditRequestMetadata(request) },
  });
  return jsonResponse(aliasToResponse(alias), 201);
}

// PUT /api/email-aliases/:id  (enable/disable, edit description)
export async function handleUpdateAlias(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const alias = await storage.getEmailAliasById(userId, id);
  if (!alias) return errorResponse('Alias not found.', 404);

  const body = await readJson(request);
  const update: { active?: boolean; description?: string | null; cfRuleId?: string | null } = {};

  if (typeof body.description === 'string' || body.description === null) {
    update.description = typeof body.description === 'string' ? body.description.slice(0, 200) : null;
  }

  if (typeof body.active === 'boolean' && body.active !== alias.active) {
    // Toggling delivery means recomputing the alias's Email Routing rule:
    //   - active  -> custom destination needs a forward rule; a default
    //                (catch-all) destination needs no rule at all.
    //   - disabled -> a "drop" rule that overrides the zone catch-all.
    // Any existing rule is removed first. This always touches the CF API.
    if (!isCloudflareEmailConfigured(env)) {
      return errorResponse(
        'Enabling/disabling an alias requires Cloudflare API credentials (CF_API_TOKEN, CF_ZONE_ID).',
        422
      );
    }
    const client = getCloudflareEmailClient(env);
    const settings = await getAliasSettings(storage);
    try {
      if (alias.cfRuleId) {
        await client.deleteRule(alias.cfRuleId);
      }
      if (body.active === false) {
        update.cfRuleId = await client.createDropRule(alias.address);
      } else if (alias.destination !== settings.defaultDestination) {
        update.cfRuleId = await client.createForwardRule(alias.address, alias.destination);
      } else {
        update.cfRuleId = null;
      }
    } catch {
      return errorResponse('Failed to update the Cloudflare Email Routing rule.', 502);
    }
    update.active = body.active;
  }

  const changed = await storage.updateEmailAlias(userId, id, update);
  if (!changed) return errorResponse('No changes applied.', 400);
  const updated = await storage.getEmailAliasById(userId, id);
  return jsonResponse(aliasToResponse(updated!));
}

// DELETE /api/email-aliases/:id
export async function handleDeleteAlias(env: Env, userId: string, id: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const alias = await storage.getEmailAliasById(userId, id);
  if (!alias) return errorResponse('Alias not found.', 404);

  if (alias.cfRuleId && isCloudflareEmailConfigured(env)) {
    try {
      await getCloudflareEmailClient(env).deleteRule(alias.cfRuleId);
    } catch {
      // Best-effort: proceed with local deletion even if rule cleanup fails.
    }
  }
  await storage.deleteEmailAlias(userId, id);
  return jsonResponse({ deleted: true, id, object: 'emailAlias' });
}

// GET /api/email-aliases/settings
// Any authenticated user may read the fields needed to drive the generator UI
// (enabled + domains). Forwarding destinations are operator inboxes, so they are
// only exposed to admins to avoid leaking real addresses in multi-user setups.
export async function handleGetAliasSettings(env: Env, currentUser: User): Promise<Response> {
  const storage = new StorageService(env.DB);
  const settings = await getAliasSettings(storage);
  const isAdmin = currentUser.role === 'admin';
  return jsonResponse({
    enabled: settings.enabled,
    domains: settings.domains,
    defaultDomain: settings.defaultDomain,
    defaultDestination: isAdmin ? settings.defaultDestination : null,
    recipients: isAdmin ? settings.recipients : [],
    cloudflareConfigured: isCloudflareEmailConfigured(env),
    object: 'aliasSettings',
  });
}

// PUT /api/email-aliases/settings  (admin only)
export async function handleUpdateAliasSettings(
  request: Request,
  env: Env,
  currentUser: User
): Promise<Response> {
  if (currentUser.role !== 'admin') {
    return errorResponse('Administrator privileges required.', 403);
  }
  const storage = new StorageService(env.DB);
  const body = await readJson(request);
  const settings = sanitizeAliasSettings(body);
  await saveAliasSettings(storage, settings);
  return jsonResponse({
    ...settings,
    cloudflareConfigured: isCloudflareEmailConfigured(env),
    object: 'aliasSettings',
  });
}

// GET /api/email-aliases/tokens
export async function handleListAliasTokens(env: Env, userId: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const tokens = await storage.listAliasApiTokensByUserId(userId);
  return jsonResponse({ data: tokens.map(tokenToResponse), object: 'list' });
}

// POST /api/email-aliases/tokens  (returns the plaintext token exactly once)
export async function handleCreateAliasToken(request: Request, env: Env, userId: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const existing = await storage.listAliasApiTokensByUserId(userId);
  if (existing.length >= MAX_TOKENS_PER_USER) {
    return errorResponse('Token limit reached.', 422);
  }
  const body = await readJson(request);
  const name = (typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'API token').slice(0, 100);

  const secret = generateApiTokenSecret();
  const token: AliasApiToken = {
    id: generateUUID(),
    userId,
    name,
    tokenHash: await sha256Hex(secret),
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
  };
  await storage.createAliasApiToken(token);
  await safeWriteAuditEvent(env, {
    actorUserId: userId,
    action: 'alias.token.created',
    category: 'security',
    level: 'info',
    targetType: 'aliasApiToken',
    targetId: token.id,
    metadata: auditRequestMetadata(request),
  });
  // `token` is only ever returned here; afterwards only its hash is stored.
  return jsonResponse({ ...tokenToResponse(token), token: secret }, 201);
}

// DELETE /api/email-aliases/tokens/:id
export async function handleDeleteAliasToken(env: Env, userId: string, id: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const deleted = await storage.deleteAliasApiToken(userId, id);
  if (!deleted) return errorResponse('Token not found.', 404);
  return jsonResponse({ deleted: true, id, object: 'aliasApiToken' });
}
