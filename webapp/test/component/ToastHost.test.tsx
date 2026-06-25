import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import ToastHost from '@/components/ToastHost';
import type { ToastMessage } from '@/lib/types';

const toasts: ToastMessage[] = [
  { id: 'a', type: 'success', text: 'Saved successfully' },
  { id: 'b', type: 'error', text: 'Something failed' },
];

describe('<ToastHost>', () => {
  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastHost toasts={[]} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders each toast message', () => {
    render(<ToastHost toasts={toasts} onClose={vi.fn()} />);
    expect(screen.getByText('Saved successfully')).toBeInTheDocument();
    expect(screen.getByText('Something failed')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('applies the toast type as a class modifier', () => {
    const { container } = render(<ToastHost toasts={toasts} onClose={vi.fn()} />);
    const items = container.querySelectorAll('.toast-item');
    expect(items[0].className).toContain('success');
    expect(items[1].className).toContain('error');
  });

  it('invokes onClose with the toast id when its dismiss button is clicked', () => {
    const onClose = vi.fn();
    render(<ToastHost toasts={toasts} onClose={onClose} />);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('b');
  });
});
