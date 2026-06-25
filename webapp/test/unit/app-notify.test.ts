import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_NOTIFY_EVENT, dispatchAppNotify, type AppNotifyDetail } from '@/lib/app-notify';

describe('app-notify', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes a stable event name', () => {
    expect(APP_NOTIFY_EVENT).toBe('nodewarden:notify');
  });

  it('dispatches a CustomEvent carrying the type and text in its detail', () => {
    const received: AppNotifyDetail[] = [];
    const listener = (event: Event) => {
      received.push((event as CustomEvent<AppNotifyDetail>).detail);
    };
    window.addEventListener(APP_NOTIFY_EVENT, listener);

    dispatchAppNotify('success', 'Saved');

    window.removeEventListener(APP_NOTIFY_EVENT, listener);
    expect(received).toEqual([{ type: 'success', text: 'Saved' }]);
  });

  it('dispatches for each notify type', () => {
    const seen: AppNotifyDetail[] = [];
    const listener = (event: Event) => {
      seen.push((event as CustomEvent<AppNotifyDetail>).detail);
    };
    window.addEventListener(APP_NOTIFY_EVENT, listener);

    dispatchAppNotify('error', 'boom');
    dispatchAppNotify('warning', 'careful');

    window.removeEventListener(APP_NOTIFY_EVENT, listener);
    expect(seen).toEqual([
      { type: 'error', text: 'boom' },
      { type: 'warning', text: 'careful' },
    ]);
  });

  it('uses a real CustomEvent so the configured event type matches', () => {
    let captured: Event | null = null;
    const listener = (event: Event) => {
      captured = event;
    };
    window.addEventListener(APP_NOTIFY_EVENT, listener);
    dispatchAppNotify('success', 'hi');
    window.removeEventListener(APP_NOTIFY_EVENT, listener);

    expect(captured).toBeInstanceOf(CustomEvent);
    expect((captured as unknown as Event).type).toBe(APP_NOTIFY_EVENT);
  });

  it('is a no-op when window is undefined', async () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    const originalWindow = globalThis.window;
    // Remove window for the duration of this call so the early return is taken.
    // @ts-expect-error intentionally deleting for the guard branch
    delete (globalThis as { window?: unknown }).window;
    try {
      expect(() => dispatchAppNotify('success', 'unseen')).not.toThrow();
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    // dispatchEvent should not have been invoked while window was absent.
    expect(spy).not.toHaveBeenCalled();
  });
});
