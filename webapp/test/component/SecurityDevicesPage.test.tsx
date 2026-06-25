import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/preact';
import type { AuthorizedDevice } from '@/lib/types';

// PendingAuthRequestsPanel is an unrelated child; stub it to a marker.
vi.mock('@/components/PendingAuthRequestsPanel', () => ({
  default: () => <div data-testid="pending-auth-panel" />,
}));

import SecurityDevicesPage from '@/components/SecurityDevicesPage';

function makeDevice(overrides: Partial<AuthorizedDevice> = {}): AuthorizedDevice {
  return {
    id: 'dev-1',
    name: 'My Laptop',
    systemName: 'Chrome on Linux',
    deviceNote: null,
    identifier: 'identifier-1',
    type: 9,
    creationDate: '2024-01-01T00:00:00Z',
    revisionDate: '2024-02-01T00:00:00Z',
    lastSeenAt: '2024-03-01T00:00:00Z',
    hasStoredDevice: true,
    online: true,
    trusted: true,
    trustedTokenCount: 1,
    trustedUntil: '2024-04-01T00:00:00Z',
    ...overrides,
  };
}

function buildProps(overrides: Partial<Parameters<typeof SecurityDevicesPage>[0]> = {}) {
  const callbacks = {
    onRefresh: vi.fn(),
    onRefreshPendingAuthRequests: vi.fn(async () => {}),
    onApproveAuthRequest: vi.fn(async () => {}),
    onDenyAuthRequest: vi.fn(async () => {}),
    onRenameDevice: vi.fn(async () => {}),
    onRevokeTrust: vi.fn(),
    onTrustPermanently: vi.fn(),
    onRemoveDevice: vi.fn(),
    onRevokeAll: vi.fn(),
    onRemoveAll: vi.fn(),
  };
  const props = {
    devices: [makeDevice()],
    loading: false,
    error: '',
    pendingAuthRequests: [],
    pendingAuthRequestsLoading: false,
    ...callbacks,
    ...overrides,
  };
  render(<SecurityDevicesPage {...props} />);
  return { ...callbacks, ...overrides, props };
}

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe('<SecurityDevicesPage>', () => {
  it('renders the authorized devices section and a device row', () => {
    buildProps();
    expect(screen.getByRole('heading', { name: 'Authorized Devices' })).toBeInTheDocument();
    expect(screen.getByText('My Laptop')).toBeInTheDocument();
    expect(screen.getByText('identifier-1')).toBeInTheDocument();
    // type 9 => Chrome browser; online => Online pill.
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByTestId('pending-auth-panel')).toBeInTheDocument();
  });

  it('renders the empty state when no devices and not loading', () => {
    buildProps({ devices: [] });
    expect(screen.getByText('No devices found.')).toBeInTheDocument();
  });

  it('renders the error banner when error is set', () => {
    buildProps({ error: 'Failed to load devices' });
    expect(screen.getByText('Failed to load devices')).toBeInTheDocument();
  });

  it('fires onRefresh when the device-management refresh button is clicked', () => {
    const { onRefresh } = buildProps();
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0]);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('fires onRevokeAll and onRemoveAll for the bulk actions', () => {
    const { onRevokeAll, onRemoveAll } = buildProps();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke All Trusted' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove all devices' }));
    expect(onRevokeAll).toHaveBeenCalledTimes(1);
    expect(onRemoveAll).toHaveBeenCalledTimes(1);
  });

  it('fires onRevokeTrust when untrusting a trusted device', () => {
    const { onRevokeTrust } = buildProps();
    fireEvent.click(screen.getByRole('button', { name: 'Untrust' }));
    expect(onRevokeTrust).toHaveBeenCalledTimes(1);
    expect(onRevokeTrust).toHaveBeenCalledWith(expect.objectContaining({ identifier: 'identifier-1' }));
  });

  it('fires onTrustPermanently for a temporarily-trusted device', () => {
    const { onTrustPermanently } = buildProps();
    fireEvent.click(screen.getByRole('button', { name: 'Trust permanently' }));
    expect(onTrustPermanently).toHaveBeenCalledTimes(1);
  });

  it('fires onRemoveDevice when delete is clicked', () => {
    const { onRemoveDevice } = buildProps();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onRemoveDevice).toHaveBeenCalledWith(expect.objectContaining({ identifier: 'identifier-1' }));
  });

  it('opens the rename dialog and fires onRenameDevice on save', async () => {
    const { onRenameDevice } = buildProps();
    fireEvent.click(screen.getByRole('button', { name: 'Device Note' }));
    const dialog = await screen.findByRole('dialog');
    const input = dialog.querySelector('input.input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'Work laptop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(onRenameDevice).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'identifier-1' }),
        'Work laptop',
      ),
    );
  });

  it('disables untrust/trust-permanently for an untrusted device', () => {
    buildProps({ devices: [makeDevice({ trusted: false, trustedUntil: null })] });
    expect(screen.getByRole('button', { name: 'Untrust' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Trust permanently' })).toBeDisabled();
  });

  it('disables note/delete when the device has no stored device record', () => {
    buildProps({ devices: [makeDevice({ hasStoredDevice: false })] });
    expect(screen.getByRole('button', { name: 'Device Note' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});
