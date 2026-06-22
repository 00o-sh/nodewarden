import type { AliasApiToken, EmailAlias } from '../types';

// Storage adapter for the email-alias generator tables (email_aliases,
// alias_api_tokens). Every generated alias is persisted here — including those
// created through the addy.io shim by official Bitwarden clients — so the
// NodeWarden UI can list, disable, and delete them centrally.

interface EmailAliasRow {
  id: string;
  user_id: string;
  address: string;
  domain: string;
  destination: string;
  description: string | null;
  active: number;
  cf_rule_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapAliasRow(row: EmailAliasRow): EmailAlias {
  return {
    id: row.id,
    userId: row.user_id,
    address: row.address,
    domain: row.domain,
    destination: row.destination,
    description: row.description,
    active: row.active !== 0,
    cfRuleId: row.cf_rule_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createEmailAlias(db: D1Database, alias: EmailAlias): Promise<void> {
  await db
    .prepare(
      'INSERT INTO email_aliases(id, user_id, address, domain, destination, description, active, cf_rule_id, created_at, updated_at) ' +
        'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      alias.id,
      alias.userId,
      alias.address,
      alias.domain,
      alias.destination,
      alias.description,
      alias.active ? 1 : 0,
      alias.cfRuleId,
      alias.createdAt,
      alias.updatedAt
    )
    .run();
}

export async function getEmailAliasById(
  db: D1Database,
  userId: string,
  id: string
): Promise<EmailAlias | null> {
  const row = await db
    .prepare('SELECT * FROM email_aliases WHERE user_id = ? AND id = ?')
    .bind(userId, id)
    .first<EmailAliasRow>();
  return row ? mapAliasRow(row) : null;
}

export async function getEmailAliasByAddress(
  db: D1Database,
  address: string
): Promise<EmailAlias | null> {
  const row = await db
    .prepare('SELECT * FROM email_aliases WHERE address = ?')
    .bind(address.toLowerCase())
    .first<EmailAliasRow>();
  return row ? mapAliasRow(row) : null;
}

export async function listEmailAliasesByUserId(
  db: D1Database,
  userId: string
): Promise<EmailAlias[]> {
  const result = await db
    .prepare('SELECT * FROM email_aliases WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all<EmailAliasRow>();
  return result.results.map(mapAliasRow);
}

export async function updateEmailAlias(
  db: D1Database,
  userId: string,
  id: string,
  update: { active?: boolean; description?: string | null; destination?: string; cfRuleId?: string | null },
  updatedAt: string
): Promise<boolean> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (update.active !== undefined) {
    sets.push('active = ?');
    binds.push(update.active ? 1 : 0);
  }
  if (update.description !== undefined) {
    sets.push('description = ?');
    binds.push(update.description);
  }
  if (update.destination !== undefined) {
    sets.push('destination = ?');
    binds.push(update.destination);
  }
  if (update.cfRuleId !== undefined) {
    sets.push('cf_rule_id = ?');
    binds.push(update.cfRuleId);
  }
  if (sets.length === 0) return false;
  sets.push('updated_at = ?');
  binds.push(updatedAt);
  binds.push(userId, id);

  const result = await db
    .prepare(`UPDATE email_aliases SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`)
    .bind(...binds)
    .run();
  return result.meta.changes > 0;
}

export async function deleteEmailAlias(db: D1Database, userId: string, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM email_aliases WHERE user_id = ? AND id = ?')
    .bind(userId, id)
    .run();
  return result.meta.changes > 0;
}

export async function countEmailAliasesByUserId(db: D1Database, userId: string): Promise<number> {
  // COUNT(*) always returns exactly one row, so the result is never null.
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM email_aliases WHERE user_id = ?')
    .bind(userId)
    .first<{ count: number }>();
  return row!.count;
}

// --- Alias API tokens (addy.io shim auth) ---

interface AliasApiTokenRow {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  last_used_at: string | null;
  created_at: string;
}

function mapTokenRow(row: AliasApiTokenRow): AliasApiToken {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    tokenHash: row.token_hash,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

export async function createAliasApiToken(db: D1Database, token: AliasApiToken): Promise<void> {
  await db
    .prepare(
      'INSERT INTO alias_api_tokens(id, user_id, name, token_hash, last_used_at, created_at) VALUES(?, ?, ?, ?, ?, ?)'
    )
    .bind(token.id, token.userId, token.name, token.tokenHash, token.lastUsedAt, token.createdAt)
    .run();
}

// Returns the token only when it belongs to an active user. Folding the user's
// status into the lookup keeps the shim handler to a single auth check (a token
// for a banned/deleted user simply resolves to null).
export async function getActiveAliasApiTokenByHash(
  db: D1Database,
  tokenHash: string
): Promise<AliasApiToken | null> {
  const row = await db
    .prepare(
      'SELECT t.* FROM alias_api_tokens t JOIN users u ON u.id = t.user_id ' +
        "WHERE t.token_hash = ? AND u.status = 'active'"
    )
    .bind(tokenHash)
    .first<AliasApiTokenRow>();
  return row ? mapTokenRow(row) : null;
}

export async function listAliasApiTokensByUserId(
  db: D1Database,
  userId: string
): Promise<AliasApiToken[]> {
  const result = await db
    .prepare('SELECT * FROM alias_api_tokens WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all<AliasApiTokenRow>();
  return result.results.map(mapTokenRow);
}

export async function touchAliasApiTokenLastUsed(
  db: D1Database,
  id: string,
  lastUsedAt: string
): Promise<void> {
  await db
    .prepare('UPDATE alias_api_tokens SET last_used_at = ? WHERE id = ?')
    .bind(lastUsedAt, id)
    .run();
}

export async function deleteAliasApiToken(db: D1Database, userId: string, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM alias_api_tokens WHERE user_id = ? AND id = ?')
    .bind(userId, id)
    .run();
  return result.meta.changes > 0;
}
