import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { BackupIncludeAttachmentsField } from '@/components/backup-center/BackupIncludeAttachmentsField';

function setup(overrides: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  const props = { checked: false, onChange, ...overrides };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = render(<BackupIncludeAttachmentsField {...(props as any)} />);
  return { onChange, ...result };
}

describe('<BackupIncludeAttachmentsField>', () => {
  it('renders the checkbox with the label by default', () => {
    setup();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(screen.getByText('Include attachments')).toBeInTheDocument();
  });

  it('reflects the checked prop', () => {
    setup({ checked: true });
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('fires onChange with the new checked value when toggled', () => {
    const { onChange } = setup({ checked: false });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('honors the disabled prop', () => {
    setup({ disabled: true });
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('hides the label when showLabel is false', () => {
    setup({ showLabel: false });
    expect(screen.queryByText('Include attachments')).not.toBeInTheDocument();
  });

  it('shows the help trigger by default and toggles the tooltip open state', () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Attachment backup help' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('hides the help trigger when showHelp is false', () => {
    setup({ showHelp: false });
    expect(screen.queryByRole('button', { name: 'Attachment backup help' })).not.toBeInTheDocument();
  });
});
