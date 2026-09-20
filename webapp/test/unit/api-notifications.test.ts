import { afterEach, describe, expect, it, vi } from 'vitest';
import { negotiateNotificationsHub } from '@/lib/api/notifications';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('negotiateNotificationsHub', () => {
  it('posts the bearer token to negotiate and returns the connection ticket', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ connectionId: 'c1', connectionToken: ' ticket-1 ' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(negotiateNotificationsHub('access-token')).resolves.toBe('ticket-1');
    expect(fetchMock).toHaveBeenCalledWith('/notifications/hub/negotiate?negotiateVersion=1', {
      method: 'POST',
      headers: { Authorization: 'Bearer access-token' },
    });
  });

  it('fails when negotiate is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Unauthorized' }, 401)));
    await expect(negotiateNotificationsHub('expired')).rejects.toThrow('Notification negotiation failed');
  });

  it('fails when the response carries no connection token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ connectionId: 'c1' })));
    await expect(negotiateNotificationsHub('access-token')).rejects.toThrow('Notification connection token missing');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    await expect(negotiateNotificationsHub('access-token')).rejects.toThrow('Notification connection token missing');
  });
});
