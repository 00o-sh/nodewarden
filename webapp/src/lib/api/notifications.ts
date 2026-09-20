import { parseJson } from './shared';

interface NotificationsNegotiateResponse {
  connectionToken?: string;
}

/**
 * SignalR negotiate for the realtime notifications hub. Returns the one-time,
 * short-lived connection token that the websocket upgrade is authenticated with
 * (`/notifications/hub?id=<token>`), so the long-lived access JWT never has to
 * travel in the websocket URL.
 */
export async function negotiateNotificationsHub(accessToken: string): Promise<string> {
  const response = await fetch('/notifications/hub/negotiate?negotiateVersion=1', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('Notification negotiation failed');
  const body = await parseJson<NotificationsNegotiateResponse>(response);
  const connectionToken = String(body?.connectionToken || '').trim();
  if (!connectionToken) throw new Error('Notification connection token missing');
  return connectionToken;
}
