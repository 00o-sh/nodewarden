import type { AliasGeneratorSettings, Env } from '../types';
import { StorageService } from './storage';

// Instance-level alias generator settings live in the `config` table under a
// single JSON key. Domains/destinations are operator-managed (admin only); the
// Cloudflare API token + zone are deployment secrets, not stored here.
const ALIAS_SETTINGS_KEY = 'alias.generator.settings';

const DEFAULT_SETTINGS: AliasGeneratorSettings = {
  enabled: false,
  domains: [],
  defaultDomain: null,
  defaultDestination: null,
  recipients: [],
};

const RANDOM_WORDS = [
  'amber', 'basil', 'cedar', 'delta', 'ember', 'fable', 'glade', 'harbor',
  'indigo', 'jade', 'koala', 'lunar', 'maple', 'nimbus', 'opal', 'pebble',
  'quartz', 'raven', 'sage', 'tulip', 'umber', 'velvet', 'willow', 'zephyr',
];

// Label-based validation (no ambiguous regex) to avoid polynomial backtracking
// on attacker-influenced input. Each dot-separated label uses a single,
// non-overlapping character class, and the TLD is letters only.
const LABEL_RE = /^[a-z0-9-]+$/;
const TLD_RE = /^[a-z]{2,}$/;

function normalizeDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase().replace(/^@/, '');
  if (!trimmed || trimmed.length > 253) return null;
  const labels = trimmed.split('.');
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (!LABEL_RE.test(label)) return null;
  }
  if (!TLD_RE.test(labels[labels.length - 1])) return null;
  return trimmed;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  const at = trimmed.indexOf('@');
  // Exactly one '@', a non-empty local part with no whitespace, and a valid domain.
  if (at <= 0 || at !== trimmed.lastIndexOf('@')) return null;
  const local = trimmed.slice(0, at);
  if (/\s/.test(local)) return null;
  return normalizeDomain(trimmed.slice(at + 1)) ? trimmed : null;
}

export function sanitizeAliasSettings(raw: unknown): AliasGeneratorSettings {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const domains = Array.isArray(input.domains)
    ? Array.from(new Set(input.domains.map(normalizeDomain).filter((d): d is string => !!d)))
    : [];
  const recipients = Array.isArray(input.recipients)
    ? Array.from(new Set(input.recipients.map(normalizeEmail).filter((e): e is string => !!e)))
    : [];
  const defaultDomainCandidate = normalizeDomain(input.defaultDomain);
  const defaultDomain = defaultDomainCandidate && domains.includes(defaultDomainCandidate)
    ? defaultDomainCandidate
    : domains[0] ?? null;
  const defaultDestinationCandidate = normalizeEmail(input.defaultDestination);
  const defaultDestination = defaultDestinationCandidate
    ?? (recipients.length ? recipients[0] : null);
  return {
    enabled: input.enabled === true,
    domains,
    defaultDomain,
    defaultDestination,
    recipients,
  };
}

export async function getAliasSettings(storage: StorageService): Promise<AliasGeneratorSettings> {
  const raw = await storage.getConfigValue(ALIAS_SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return sanitizeAliasSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveAliasSettings(
  storage: StorageService,
  settings: AliasGeneratorSettings
): Promise<void> {
  await storage.setConfigValue(ALIAS_SETTINGS_KEY, JSON.stringify(settings));
}

// Unbiased index in [0, n) from a CSPRNG using the multiply method (no modulo,
// so no modulo-bias). The 2^32 scaling makes the residual bias negligible for
// the small ranges used here.
function randomIndex(n: number): number {
  const value = crypto.getRandomValues(new Uint32Array(1))[0];
  return Math.floor((value / 0x100000000) * n);
}

function randomLocalPart(format: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  switch (format) {
    case 'uuid':
      return crypto.randomUUID();
    case 'random_words': {
      const pick = () => RANDOM_WORDS[randomIndex(RANDOM_WORDS.length)];
      return `${pick()}.${pick()}.${randomIndex(1000)}`;
    }
    case 'random_characters':
    default:
      return hex;
  }
}

function sanitizeLocalPart(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-z0-9._-]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

export interface AliasGenerationRequest {
  domain?: string | null;
  format?: string | null;
  localPart?: string | null;
}

export interface AliasGenerationResult {
  address: string;
  domain: string;
}

// Resolve the alias domain and local-part into a full address, validating the
// domain against the configured allow-list. Throws on invalid input.
export function buildAliasAddress(
  settings: AliasGeneratorSettings,
  req: AliasGenerationRequest
): AliasGenerationResult {
  const requestedDomain = normalizeDomain(req.domain);
  const domain = requestedDomain ?? settings.defaultDomain;
  if (!domain) {
    throw new Error('No alias domain is configured.');
  }
  if (!settings.domains.includes(domain)) {
    throw new Error(`Domain "${domain}" is not in the configured alias domains.`);
  }

  const format = (req.format || 'random_characters').trim();
  let local: string | null;
  if (format === 'custom') {
    if (!req.localPart) throw new Error('A local part is required for the "custom" format.');
    local = sanitizeLocalPart(req.localPart);
    if (!local) throw new Error('Invalid local part.');
  } else {
    local = randomLocalPart(format);
  }

  return { address: `${local}@${domain}`, domain };
}

export function isAliasGeneratorReady(env: Env, settings: AliasGeneratorSettings): boolean {
  // The generator is usable as soon as it is enabled with at least one domain.
  // Cloudflare credentials are only needed for advanced (rule-creating) paths.
  return settings.enabled && settings.domains.length > 0 && !!settings.defaultDomain && !!env;
}
