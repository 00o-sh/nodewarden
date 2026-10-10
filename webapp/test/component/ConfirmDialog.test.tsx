import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import ConfirmDialog from '@/components/ConfirmDialog';

function setup(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      open
      title="Delete item"
      message="Are you sure?"
      confirmText="Delete"
      cancelText="Keep"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />
  );
  return { onConfirm, onCancel };
}

describe('<ConfirmDialog>', () => {
  it('renders title and message in a modal dialog when open', () => {
    setup();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Delete item')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('invokes onConfirm when the confirm button is clicked', () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('invokes onCancel when the cancel button is clicked', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title="Hidden"
        message="nope"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('hides the cancel button when hideCancel is set', () => {
    setup({ hideCancel: true });
    expect(screen.queryByRole('button', { name: 'Keep' })).not.toBeInTheDocument();
  });

  it('omits aria-describedby when no message is provided', () => {
    // With no `message`, hasMessage is false so the dialog must not point
    // aria-describedby at a (nonexistent) message node.
    render(
      <ConfirmDialog
        open
        title="No message here"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).not.toHaveAttribute('aria-describedby');
  });

  it('routes the header close button to onCancel, but ignores it while cancel is disabled', () => {
    // Enabled close button dismisses via onCancel.
    const { onCancel } = setup({ closeButton: true });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    // With cancelDisabled, the guard short-circuits the handler so onCancel
    // never fires even if a click event reaches the disabled button.
    const onCancel2 = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Busy"
        message="working"
        closeButton
        cancelDisabled
        onConfirm={() => {}}
        onCancel={onCancel2}
      />
    );
    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(onCancel2).not.toHaveBeenCalled();
  });
});

describe('<ConfirmDialog> markup', () => {
  it('puts the dialog role on a container that wraps the submit form', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog open title="Name it" confirmText="Save" onConfirm={onConfirm} onCancel={vi.fn()}>
        <input aria-label="Name" />
      </ConfirmDialog>
    );
    const dialog = screen.getByRole('dialog', { name: 'Name it' });
    expect(dialog.tagName).toBe('DIV');
    const form = dialog.querySelector('form');
    expect(form).not.toBeNull();
    // Fields rendered as children live inside the form, so pressing Enter in
    // them submits it and confirms the dialog.
    expect(form!.contains(screen.getByLabelText('Name'))).toBe(true);
    fireEvent.submit(form!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
