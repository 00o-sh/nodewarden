import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import AuthRequestApprovalDialog from '@/components/AuthRequestApprovalDialog';
import type { AuthRequest } from '@/lib/types';

const REQUEST: AuthRequest = {
  id: 'req-1',
  publicKey: 'pk1',
  requestDeviceType: 'Android',
  requestDeviceIdentifier: 'device-zzz',
  requestIpAddress: '9.8.7.6',
  creationDate: '2030-01-01T00:00:00.000Z',
  fingerprintPhrase: 'delta-echo-foxtrot',
};

function setup(overrides: Partial<Parameters<typeof AuthRequestApprovalDialog>[0]> = {}) {
  const handlers = {
    onApprove: vi.fn(),
    onDeny: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <AuthRequestApprovalDialog
      open
      authRequest={REQUEST}
      submitting={false}
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

describe('<AuthRequestApprovalDialog>', () => {
  it('renders the dialog with the request details when open', () => {
    setup();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Android')).toBeInTheDocument();
    expect(screen.getByText('device-zzz')).toBeInTheDocument();
    expect(screen.getByText('9.8.7.6')).toBeInTheDocument();
    expect(screen.getByText('delta-echo-foxtrot')).toBeInTheDocument();
  });

  it('fires onApprove when the approve (confirm) button is clicked', () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/i }));
    expect(handlers.onApprove).toHaveBeenCalledTimes(1);
  });

  it('fires onDeny when the deny button is clicked', () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole('button', { name: /Deny/i }));
    expect(handlers.onDeny).toHaveBeenCalledTimes(1);
  });

  it('fires onClose when the cancel (Later) button is clicked', () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole('button', { name: /Later/i }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('disables approve and deny while submitting', () => {
    setup({ submitting: true });
    // confirm text becomes "Approving..." while submitting
    expect(screen.getByRole('button', { name: /Approving/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Deny/i })).toBeDisabled();
  });

  it('renders nothing when there is no auth request', () => {
    setup({ authRequest: null });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
