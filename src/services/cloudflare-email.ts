import type { Env } from '../types';

// Thin client over the Cloudflare Email Routing API.
//
// Only used for the "advanced" alias paths:
//   - a custom (non-default) forwarding destination, and
//   - disabling a catch-all alias (a "drop" rule that overrides the catch-all).
//
// Default alias generation relies on the zone catch-all and needs no API call,
// so these credentials are optional. When they are absent, callers should fall
// back to catch-all behavior and surface a clear "not configured" error for the
// operations that genuinely require the API.

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

export class CloudflareEmailConfigError extends Error {}
export class CloudflareEmailApiError extends Error {}

export interface CloudflareEmailClient {
  /** Create a rule forwarding `address` to `destination`. Returns the rule id. */
  createForwardRule(address: string, destination: string): Promise<string>;
  /** Create a rule that drops mail to `address` (used to disable a catch-all alias). Returns the rule id. */
  createDropRule(address: string): Promise<string>;
  /** Delete a routing rule by id. Best-effort: missing rules resolve successfully. */
  deleteRule(ruleId: string): Promise<void>;
}

export function isCloudflareEmailConfigured(env: Env): boolean {
  return !!(env.CF_API_TOKEN && env.CF_ZONE_ID);
}

// Pure response helpers (unit-tested directly). The Cloudflare API wraps results
// in `{ success, errors, result }`; these tolerate partial/garbage payloads.
export function isCloudflareFailure(payload: unknown): boolean {
  return typeof payload === 'object' && payload !== null && (payload as { success?: unknown }).success === false;
}

export function cloudflareErrorDetail(payload: unknown, status: number): string {
  const errors = (payload as { errors?: unknown })?.errors;
  const first = Array.isArray(errors) ? errors[0] : undefined;
  const message = first && typeof first === 'object' ? (first as { message?: unknown }).message : undefined;
  return typeof message === 'string' && message ? message : `HTTP ${status}`;
}

export function readCloudflareRuleId(payload: unknown): string | null {
  const result = (payload as { result?: unknown })?.result;
  const id = result && typeof result === 'object' ? (result as { id?: unknown }).id : undefined;
  return typeof id === 'string' && id ? id : null;
}

export function getCloudflareEmailClient(env: Env): CloudflareEmailClient {
  const token = (env.CF_API_TOKEN || '').trim();
  const zoneId = (env.CF_ZONE_ID || '').trim();
  if (!token || !zoneId) {
    throw new CloudflareEmailConfigError(
      'Cloudflare API credentials (CF_API_TOKEN, CF_ZONE_ID) are not configured.'
    );
  }

  async function request(method: string, path: string, body?: unknown): Promise<any> {
    const response = await fetch(`${CF_API_BASE}/zones/${zoneId}/email/routing/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const failed = !response.ok || isCloudflareFailure(payload);
    if (failed) {
      throw new CloudflareEmailApiError(
        `Cloudflare Email Routing API error: ${cloudflareErrorDetail(payload, response.status)}`
      );
    }
    return payload;
  }

  async function createRule(
    address: string,
    action: { type: 'forward'; value: string[] } | { type: 'drop' }
  ): Promise<string> {
    const payload = await request('POST', 'rules', {
      enabled: true,
      name: `nodewarden-alias:${address}`,
      matchers: [{ type: 'literal', field: 'to', value: address }],
      actions: [action],
    });
    const ruleId = readCloudflareRuleId(payload);
    if (ruleId === null) {
      throw new CloudflareEmailApiError('Cloudflare Email Routing API returned no rule id.');
    }
    return ruleId;
  }

  return {
    async createForwardRule(address: string, destination: string): Promise<string> {
      return createRule(address, { type: 'forward', value: [destination] });
    },
    async createDropRule(address: string): Promise<string> {
      return createRule(address, { type: 'drop' });
    },
    async deleteRule(ruleId: string): Promise<void> {
      await request('DELETE', `rules/${encodeURIComponent(ruleId)}`);
    },
  };
}
