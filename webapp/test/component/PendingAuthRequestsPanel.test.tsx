import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import PendingAuthRequestsPanel from '@/components/PendingAuthRequestsPanel';
import type { AuthRequest } from '@/lib/types';

const REQUESTS: AuthRequest[] = [
  {
    id: 'req-1',
    publicKey: 'pk1',
    requestDeviceType: 'iPhone',
    requestDeviceIdentifier: 'device-aaa',
    requestIpAddress: '1.2.3.4',
    creationDate: '2030-01-01T00:00:00.000Z',
    fingerprintPhrase: 'apple-banana-cherry',
  },
  {
    id: 'req-2',
    publicKey: 'pk2',
    requestDeviceType: null,
    requestDeviceIdentifier: 'device-bbb',
    creationDate: '2030-02-01T00:00:00.000Z',
  },
];

function setup(overrides: Partial<Parameters<typeof PendingAuthRequestsPanel>[0]> = {}) {
  const handlers = {
    onRefreshPendingAuthRequests: vi.fn().mockResolvedValue(undefined),
    onApproveAuthRequest: vi.fn().mockResolvedValue(undefined),
    onDenyAuthRequest: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <PendingAuthRequestsPanel
      pendingAuthRequests={REQUESTS}
      pendingAuthRequestsLoading={false}
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

describe('<PendingAuthRequestsPanel>', () => {
  it('renders a row per pending request with device info', () => {
    setup();
    expect(screen.getByText('iPhone')).toBeInTheDocument();
    expect(screen.getByText('device-aaa')).toBeInTheDocument();
    expect(screen.getByText('apple-banana-cherry')).toBeInTheDocument();
    // null device type falls back to translated unknown-device label
    expect(screen.getByText('Unknown device')).toBeInTheDocument();
  });

  it('fires onApproveAuthRequest with the request when approve is clicked', () => {
    const handlers = setup();
    const row = screen.getByText('iPhone').closest('.auth-request-row')! as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /Approve/i }));
    expect(handlers.onApproveAuthRequest).toHaveBeenCalledWith(REQUESTS[0]);
  });

  it('fires onDenyAuthRequest with the request when deny is clicked', () => {
    const handlers = setup();
    const row = screen.getByText('iPhone').closest('.auth-request-row')! as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /Deny/i }));
    expect(handlers.onDenyAuthRequest).toHaveBeenCalledWith(REQUESTS[0]);
  });

  it('fires onRefreshPendingAuthRequests when refresh is clicked', () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    expect(handlers.onRefreshPendingAuthRequests).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state when there are no pending requests', () => {
    setup({ pendingAuthRequests: [] });
    expect(screen.getByText('No pending device logins')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/i })).not.toBeInTheDocument();
  });

  it('disables refresh while loading', () => {
    setup({ pendingAuthRequests: [], pendingAuthRequestsLoading: true });
    expect(screen.getByRole('button', { name: /Refresh/i })).toBeDisabled();
  });
});
