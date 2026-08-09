import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/preact';

import AppGlobalOverlays from '@/components/AppGlobalOverlays';
import type { AppConfirmState } from '@/components/AppGlobalOverlays';
import type { ToastMessage } from '@/lib/types';

// AppGlobalOverlays orchestrates three ConfirmDialog instances (generic confirm,
// the pending-TOTP prompt, the disable-TOTP prompt) plus a ToastHost. We render
// the REAL ConfirmDialog/ToastHost so we exercise the actual wiring, asserting the
// shell shows the right overlay for each open-state and routes confirm/cancel to
// the right callbacks. ConfirmDialog renders into document.body via a portal.

type OverlayProps = Parameters<typeof AppGlobalOverlays>[0];

function buildProps(overrides: Partial<OverlayProps> = {}): OverlayProps {
  return {
    toasts: [],
    onCloseToast: vi.fn(),
    confirm: null,
    onCancelConfirm: vi.fn(),
    pendingTotpOpen: false,
    totpCode: '',
    rememberDevice: false,
    onTotpCodeChange: vi.fn(),
    onRememberDeviceChange: vi.fn(),
    onConfirmTotp: vi.fn(),
    onSelectTotpProvider: vi.fn(),
    onCancelTotp: vi.fn(),
    onUseRecoveryCode: vi.fn(),
    totpSubmitting: false,
    disableTotpOpen: false,
    disableTotpPassword: '',
    onDisableTotpPasswordChange: vi.fn(),
    onConfirmDisableTotp: vi.fn(),
    onCancelDisableTotp: vi.fn(),
    disableTotpSubmitting: false,
    ...overrides,
  };
}

function makeConfirm(overrides: Partial<AppConfirmState> = {}): AppConfirmState {
  return {
    title: 'Delete item?',
    message: 'This cannot be undone.',
    onConfirm: vi.fn(),
    ...overrides,
  };
}

// Returns the open dialog card (role=dialog) currently in the document.
function openDialog() {
  return screen.getByRole('dialog');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AppGlobalOverlays', () => {
  it('renders no dialog and no toasts when everything is closed/empty', () => {
    render(<AppGlobalOverlays {...buildProps()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.toast-stack')).toBeNull();
  });

  it('shows the generic confirm dialog with its title/message when confirm is set', () => {
    render(<AppGlobalOverlays {...buildProps({ confirm: makeConfirm() })} />);
    const dialog = openDialog();
    expect(within(dialog).getByText('Delete item?')).toBeInTheDocument();
    expect(within(dialog).getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('routes the generic confirm action to confirm.onConfirm', () => {
    const onConfirm = vi.fn();
    render(<AppGlobalOverlays {...buildProps({ confirm: makeConfirm({ confirmText: 'Delete', onConfirm }) })} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('uses confirm.onCancel for cancel when provided', () => {
    const onCancel = vi.fn();
    const onCancelConfirm = vi.fn();
    render(<AppGlobalOverlays {...buildProps({ confirm: makeConfirm({ cancelText: 'Keep', onCancel }), onCancelConfirm })} />);
    fireEvent.click(screen.getByText('Keep'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancelConfirm).not.toHaveBeenCalled();
  });

  it('falls back to onCancelConfirm for cancel when confirm.onCancel is absent', () => {
    const onCancelConfirm = vi.fn();
    render(<AppGlobalOverlays {...buildProps({ confirm: makeConfirm({ cancelText: 'Keep' }), onCancelConfirm })} />);
    fireEvent.click(screen.getByText('Keep'));
    expect(onCancelConfirm).toHaveBeenCalledTimes(1);
  });

  it('hides the cancel button when confirm.hideCancel is set', () => {
    render(<AppGlobalOverlays {...buildProps({ confirm: makeConfirm({ confirmText: 'OK', hideCancel: true }) })} />);
    const dialog = openDialog();
    expect(within(dialog).getByText('OK')).toBeInTheDocument();
    // The only action button is the confirm button.
    expect(within(dialog).queryByText('No')).not.toBeInTheDocument();
  });

  it('shows the pending-TOTP prompt with its code field and recovery-code action', () => {
    render(<AppGlobalOverlays {...buildProps({ pendingTotpOpen: true })} />);
    const dialog = openDialog();
    expect(within(dialog).getByText('Two-step verification')).toBeInTheDocument();
    expect(within(dialog).getByText('Use Recovery Code')).toBeInTheDocument();
  });

  it('routes TOTP code input, remember-device, confirm, cancel and recovery callbacks', () => {
    const props = buildProps({ pendingTotpOpen: true });
    render(<AppGlobalOverlays {...props} />);
    const dialog = openDialog();

    const codeInput = within(dialog).getByLabelText('TOTP Code') as HTMLInputElement;
    fireEvent.input(codeInput, { target: { value: '123456' } });
    expect(props.onTotpCodeChange).toHaveBeenCalledWith('123456');

    const remember = dialog.querySelector('input[type="checkbox"]') as HTMLInputElement;
    // Clicking toggles `checked` to true before the change handler reads it.
    fireEvent.click(remember);
    expect(props.onRememberDeviceChange).toHaveBeenCalledWith(true);

    fireEvent.click(within(dialog).getByText('Use Recovery Code'));
    expect(props.onUseRecoveryCode).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByText('Verify'));
    expect(props.onConfirmTotp).toHaveBeenCalledTimes(1);

    // The TOTP dialog now dismisses via the header close (X) button (aria-label
    // "Close"), which routes to onCancelTotp — there is no separate Cancel button.
    fireEvent.click(within(dialog).getByLabelText('Close'));
    expect(props.onCancelTotp).toHaveBeenCalledTimes(1);
  });

  // Provider type constants mirrored from the component.
  const PROVIDER_AUTHENTICATOR = 0;
  const PROVIDER_YUBIKEY = 3;
  const PROVIDER_WEBAUTHN = 7;

  it('renders the YubiKey OTP prompt variant and switches provider via the method chooser', () => {
    const props = buildProps({
      pendingTotpOpen: true,
      pendingTotpProviderType: PROVIDER_YUBIKEY,
      pendingTotpAvailableProviders: [PROVIDER_WEBAUTHN, PROVIDER_YUBIKEY, PROVIDER_AUTHENTICATOR],
    });
    render(<AppGlobalOverlays {...props} />);
    const dialog = openDialog();

    // YubiKey title + press-to-authenticate copy, and a masked OTP input.
    expect(within(dialog).getByText('Two-step verification YubiKey')).toBeInTheDocument();
    expect(within(dialog).getByText('Press your YubiKey to authenticate.')).toBeInTheDocument();
    const otpInput = within(dialog).getByLabelText('OTP from YubiKey') as HTMLInputElement;
    expect(otpInput.type).toBe('password');

    // Alternate providers (all except the current YubiKey) drive the switcher.
    const switcher = within(dialog).getByText('Select another verification method');
    fireEvent.click(switcher);
    // The chooser lists Passkey (WebAuthn) and Authenticator app alternates.
    fireEvent.click(within(dialog).getByText('Passkey'));
    expect(props.onSelectTotpProvider).toHaveBeenCalledWith(PROVIDER_WEBAUTHN);
  });

  it('renders the WebAuthn/passkey prompt variant with its passkey note and no code field', () => {
    const props = buildProps({
      pendingTotpOpen: true,
      pendingTotpProviderType: PROVIDER_WEBAUTHN,
      pendingTotpAvailableProviders: [PROVIDER_WEBAUTHN, PROVIDER_YUBIKEY, PROVIDER_AUTHENTICATOR],
    });
    render(<AppGlobalOverlays {...props} />);
    const dialog = openDialog();

    // Passkey title stack + passkey message + the "touch your passkey" note.
    expect(within(dialog).getByText('Use your passkey to complete two-step verification.')).toBeInTheDocument();
    expect(within(dialog).getByText('Continue and approve the browser passkey prompt.')).toBeInTheDocument();
    // The passkey variant does not render the TOTP code input.
    expect(within(dialog).queryByLabelText('TOTP Code')).not.toBeInTheDocument();

    // Alternate providers here include YubiKey, exercising its label.
    fireEvent.click(within(dialog).getByText('Select another verification method'));
    fireEvent.click(within(dialog).getByText('OTP from YubiKey'));
    expect(props.onSelectTotpProvider).toHaveBeenCalledWith(PROVIDER_YUBIKEY);
  });

  it('disables TOTP confirm/cancel/recovery while submitting', () => {
    render(<AppGlobalOverlays {...buildProps({ pendingTotpOpen: true, totpSubmitting: true })} />);
    const dialog = openDialog();
    expect(within(dialog).getByText('Verify').closest('button')).toBeDisabled();
    // Dismissal is the header close (X) button now; it disables while submitting.
    expect(within(dialog).getByLabelText('Close')).toBeDisabled();
    expect(within(dialog).getByText('Use Recovery Code').closest('button')).toBeDisabled();
  });

  it('shows the disable-TOTP prompt and routes its password/confirm/cancel callbacks', () => {
    const props = buildProps({ disableTotpOpen: true });
    render(<AppGlobalOverlays {...props} />);
    const dialog = openDialog();
    // Title and the confirm button both read "Disable TOTP".
    expect(within(dialog).getAllByText('Disable TOTP').length).toBeGreaterThanOrEqual(1);

    const pwd = within(dialog).getByLabelText('Master Password') as HTMLInputElement;
    fireEvent.input(pwd, { target: { value: 'hunter2' } });
    expect(props.onDisableTotpPasswordChange).toHaveBeenCalledWith('hunter2');

    // The submit/confirm button carries the data-dialog-confirm marker.
    const confirmBtn = dialog.querySelector('[data-dialog-confirm="true"]') as HTMLElement;
    fireEvent.click(confirmBtn);
    expect(props.onConfirmDisableTotp).toHaveBeenCalledTimes(1);

    // Dismissal is via the header close (X) button, which routes to
    // onCancelDisableTotp — the standalone Cancel button was removed.
    fireEvent.click(within(dialog).getByLabelText('Close'));
    expect(props.onCancelDisableTotp).toHaveBeenCalledTimes(1);
  });

  it('gates the master-password confirm: disabled until a password is typed, then passes it to onConfirm', () => {
    const onConfirm = vi.fn();
    render(
      <AppGlobalOverlays
        {...buildProps({ confirm: makeConfirm({ confirmText: 'Confirm', requireMasterPassword: true, onConfirm }) })}
      />,
    );
    const dialog = openDialog();

    // The master-password field is rendered for this variant.
    const pwd = within(dialog).getByLabelText('Master Password') as HTMLInputElement;
    // Confirm is disabled while the password is empty; clicking it is a no-op.
    const confirmBtn = dialog.querySelector('[data-dialog-confirm="true"]') as HTMLElement;
    expect(confirmBtn).toBeDisabled();
    fireEvent.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled();

    // Typing a password enables confirm and forwards the value to onConfirm.
    fireEvent.input(pwd, { target: { value: 'master-pass' } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledWith('master-pass');
  });

  it('clears the typed master password when cancelling the confirm dialog', () => {
    const onCancel = vi.fn();
    render(
      <AppGlobalOverlays
        {...buildProps({ confirm: makeConfirm({ cancelText: 'Keep', requireMasterPassword: true, onCancel }) })}
      />,
    );
    const dialog = openDialog();
    const pwd = within(dialog).getByLabelText('Master Password') as HTMLInputElement;
    fireEvent.input(pwd, { target: { value: 'typed-secret' } });
    expect(pwd.value).toBe('typed-secret');

    fireEvent.click(within(dialog).getByText('Keep'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders toasts and routes the close button to onCloseToast', () => {
    const toasts: ToastMessage[] = [
      { id: 't1', type: 'success', text: 'Saved!' },
      { id: 't2', type: 'error', text: 'Failed!' },
    ];
    const onCloseToast = vi.fn();
    render(<AppGlobalOverlays {...buildProps({ toasts, onCloseToast })} />);
    expect(screen.getByText('Saved!')).toBeInTheDocument();
    expect(screen.getByText('Failed!')).toBeInTheDocument();

    const closeButtons = screen.getAllByRole('button', { name: '关闭通知' });
    fireEvent.click(closeButtons[1]);
    expect(onCloseToast).toHaveBeenCalledWith('t2');
  });
});
