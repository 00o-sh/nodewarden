import { describe, expect, it } from 'vitest';
import {
  createWebSocketConnectionToken,
  verifyWebSocketConnectionToken,
} from '../src/utils/websocket-connection-token';

const secret = `ws-ticket-secret-${'x'.repeat(32)}`;
const userId = 'd75020e1-2de4-46e8-b8f1-475d127b51f2';

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Signs arbitrary claims with the same HMAC scheme so the claim validation
// branches can be exercised with otherwise-authentic tokens.
async function signClaims(claims: Record<string, unknown>, signingSecret = secret): Promise<string> {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(signingSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  return `${payload}.${base64Url(signature)}`;
}

describe('websocket connection token', () => {
  it('round-trips the signed claims', async () => {
    const expiresAt = Date.now() + 60_000;
    const token = await createWebSocketConnectionToken(userId, expiresAt, secret);
    expect(token.split('.')).toHaveLength(2);

    const claims = await verifyWebSocketConnectionToken(token, secret);
    expect(claims).toMatchObject({ userId, expiresAt, scope: 'notifications.websocket' });
    expect(typeof claims?.nonce).toBe('string');
  });

  it('issues a fresh nonce per ticket', async () => {
    const expiresAt = Date.now() + 60_000;
    const a = await createWebSocketConnectionToken(userId, expiresAt, secret);
    const b = await createWebSocketConnectionToken(userId, expiresAt, secret);
    expect(a).not.toBe(b);
  });

  it('rejects structurally invalid tokens', async () => {
    expect(await verifyWebSocketConnectionToken('', secret)).toBeNull();
    expect(await verifyWebSocketConnectionToken('a'.repeat(1025), secret)).toBeNull();
    expect(await verifyWebSocketConnectionToken('one-part', secret)).toBeNull();
    expect(await verifyWebSocketConnectionToken('a.b.c', secret)).toBeNull();
    expect(await verifyWebSocketConnectionToken('payload.!!!not-base64!!!', secret)).toBeNull();
  });

  it('rejects a token signed with another secret or tampered with', async () => {
    const token = await createWebSocketConnectionToken(userId, Date.now() + 60_000, secret);
    expect(await verifyWebSocketConnectionToken(token, `${secret}-other`)).toBeNull();

    const [payload, signature] = token.split('.');
    const tampered = `${payload.slice(0, -2)}AA.${signature}`;
    expect(await verifyWebSocketConnectionToken(tampered, secret)).toBeNull();
  });

  it('rejects authentic tokens with unusable claims', async () => {
    const future = Date.now() + 60_000;
    expect(await verifyWebSocketConnectionToken(await signClaims({ userId, expiresAt: future, scope: 'other' }), secret)).toBeNull();
    expect(await verifyWebSocketConnectionToken(await signClaims({ userId: ' ', expiresAt: future, scope: 'notifications.websocket' }), secret)).toBeNull();
    expect(await verifyWebSocketConnectionToken(await signClaims({ expiresAt: future, scope: 'notifications.websocket' }), secret)).toBeNull();
    expect(await verifyWebSocketConnectionToken(await signClaims({ userId, expiresAt: 'soon', scope: 'notifications.websocket' }), secret)).toBeNull();
    expect(await verifyWebSocketConnectionToken(await signClaims({ userId, expiresAt: Date.now() - 1, scope: 'notifications.websocket' }), secret)).toBeNull();
    expect(await verifyWebSocketConnectionToken(await signClaims({ userId, expiresAt: future, scope: 'notifications.websocket' }), secret)).toMatchObject({ userId });
  });
});
