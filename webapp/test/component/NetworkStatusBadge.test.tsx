import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/preact';

// The badge's effect kicks off network probes/timers. Stub the network-status
// module so the component renders deterministically in isolation without doing
// real fetches or scheduling timers we cannot observe.
vi.mock('@/lib/network-status', () => {
  let status: 'online' | 'offline' = 'online';
  return {
    getCurrentNetworkStatus: () => status,
    setCurrentNetworkStatus: (s: 'online' | 'offline') => {
      status = s;
    },
    browserReportsOffline: () => status === 'offline',
    probeNodeWardenService: vi.fn(async () => true),
    subscribeNetworkStatus: () => () => {},
    __setStatus: (s: 'online' | 'offline') => {
      status = s;
    },
  };
});

import * as networkStatus from '@/lib/network-status';
import NetworkStatusBadge from '@/components/NetworkStatusBadge';

describe('<NetworkStatusBadge>', () => {
  beforeEach(() => {
    (networkStatus as unknown as { __setStatus: (s: 'online' | 'offline') => void }).__setStatus('online');
  });

  it('renders the online label when the current status is online', () => {
    render(<NetworkStatusBadge />);
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('exposes an accessible polite live region with the status label', () => {
    const { container } = render(<NetworkStatusBadge />);
    const badge = container.querySelector('.network-status-badge') as HTMLElement;
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('aria-live', 'polite');
    expect(badge).toHaveAttribute('aria-label', 'Online');
    expect(badge.className).toContain('online');
  });

  it('renders the offline label and class when the current status is offline', () => {
    (networkStatus as unknown as { __setStatus: (s: 'online' | 'offline') => void }).__setStatus('offline');
    const { container } = render(<NetworkStatusBadge />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
    const badge = container.querySelector('.network-status-badge') as HTMLElement;
    expect(badge.className).toContain('offline');
    expect(badge).toHaveAttribute('aria-label', 'Offline');
  });
});
