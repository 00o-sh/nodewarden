import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import JwtWarningPage from '@/components/JwtWarningPage';

describe('<JwtWarningPage>', () => {
  it('renders the "missing" title when reason is missing', () => {
    render(<JwtWarningPage reason="missing" minLength={32} />);
    expect(screen.getByRole('heading', { name: 'JWT_SECRET is missing' })).toBeInTheDocument();
    expect(screen.getByText('How to add JWT_SECRET')).toBeInTheDocument();
  });

  it('renders the "default" title when reason is default', () => {
    render(<JwtWarningPage reason="default" minLength={32} />);
    expect(
      screen.getByRole('heading', { name: 'JWT_SECRET is using the default value' })
    ).toBeInTheDocument();
  });

  it('renders the "too_short" title when reason is too_short', () => {
    render(<JwtWarningPage reason="too_short" minLength={32} />);
    expect(screen.getByRole('heading', { name: 'JWT_SECRET is too short' })).toBeInTheDocument();
  });

  it('renders the warning subtitle and the JWT_SECRET env var name', () => {
    render(<JwtWarningPage reason="missing" minLength={32} />);
    expect(screen.getByText('JWT secret is not configured safely.')).toBeInTheDocument();
    expect(screen.getByText('JWT_SECRET')).toBeInTheDocument();
  });

  it('renders a readonly generated secret of the expected length', () => {
    const { container } = render(<JwtWarningPage reason="missing" minLength={32} />);
    const input = container.querySelector('input.input-readonly') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('readonly');
    expect(input.value).toHaveLength(32);
  });

  it('regenerates the secret when the Regenerate button is clicked', () => {
    const { container } = render(<JwtWarningPage reason="missing" minLength={32} />);
    const input = container.querySelector('input.input-readonly') as HTMLInputElement;
    const before = input.value;
    fireEvent.click(screen.getByRole('button', { name: /Regenerate/i }));
    const after = (container.querySelector('input.input-readonly') as HTMLInputElement).value;
    expect(after).toHaveLength(32);
    // Overwhelmingly likely to differ for a 32-char random secret.
    expect(after).not.toBe(before);
  });

  it('renders a link to settings in the fix steps', () => {
    render(<JwtWarningPage reason="missing" minLength={32} />);
    const link = screen.getByRole('link', { name: 'Settings' });
    expect(link).toHaveAttribute('href');
    expect(link.getAttribute('href')).toContain('dash.cloudflare.com');
  });

  it('invokes the clipboard copy when the Copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<JwtWarningPage reason="missing" minLength={32} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy/i }));
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
