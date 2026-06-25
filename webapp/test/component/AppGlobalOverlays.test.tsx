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

    fireEvent.click(within(dialog).getByText('Cancel'));
    expect(props.onCancelTotp).toHaveBeenCalledTimes(1);
  });

  it('disables TOTP confirm/cancel/recovery while submitting', () => {
    render(<AppGlobalOverlays {...buildProps({ pendingTotpOpen: true, totpSubmitting: true })} />);
    const dialog = openDialog();
    expect(within(dialog).getByText('Verify').closest('button')).toBeDisabled();
    expect(within(dialog).getByText('Cancel').closest('button')).toBeDisabled();
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

    fireEvent.click(within(dialog).getByText('Cancel'));
    expect(props.onCancelDisableTotp).toHaveBeenCalledTimes(1);
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
