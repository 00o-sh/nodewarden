import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import ThemeSwitch from '@/components/ThemeSwitch';

describe('<ThemeSwitch>', () => {
  it('renders a labelled checkbox reflecting the checked state', () => {
    render(<ThemeSwitch checked title="Toggle theme" onToggle={() => {}} />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(screen.getByLabelText('Toggle theme')).toBeInTheDocument();
  });

  it('fires onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<ThemeSwitch checked={false} title="Toggle theme" onToggle={onToggle} />);
    fireEvent.input(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
