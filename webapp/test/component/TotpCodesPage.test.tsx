import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import TotpCodesPage from '@/components/TotpCodesPage';
import type { Cipher } from '@/lib/types';

// jsdom has no ResizeObserver; TotpCodesPage uses it unconditionally for its
// responsive column layout. Provide a minimal no-op implementation.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

// A valid RFC 6238 base32 secret so calcTotpNow (real implementation) yields a code.
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

function makeCipher(overrides: Partial<Cipher> = {}): Cipher {
  return {
    id: 'c1',
    type: 1,
    name: 'enc-name',
    decName: 'GitHub',
    login: {
      decUsername: 'octocat',
      decTotp: TOTP_SECRET,
    },
    ...overrides,
  } as Cipher;
}

describe('<TotpCodesPage>', () => {
  it('shows a loading state when loading and no items yet', () => {
    render(<TotpCodesPage ciphers={[]} loading onNotify={vi.fn()} />);
    // Empty message should NOT be shown while loading.
    expect(screen.queryByText('No verification codes')).not.toBeInTheDocument();
    expect(screen.getByText('Verification Code')).toBeInTheDocument();
  });

  it('shows the empty message when not loading and no TOTP items', () => {
    render(<TotpCodesPage ciphers={[]} loading={false} onNotify={vi.fn()} />);
    expect(screen.getByText('No verification codes')).toBeInTheDocument();
  });

  it('excludes ciphers without a decTotp secret', () => {
    const noTotp = makeCipher({ id: 'no', decName: 'NoTotp', login: { decUsername: 'x' } });
    render(<TotpCodesPage ciphers={[noTotp]} loading={false} onNotify={vi.fn()} />);
    expect(screen.getByText('No verification codes')).toBeInTheDocument();
    expect(screen.queryByText('NoTotp')).not.toBeInTheDocument();
  });

  it('excludes deleted/archived ciphers from the normal vault view', () => {
    const deleted = makeCipher({ id: 'del', decName: 'Deleted', deletedDate: '2024-01-01' });
    render(<TotpCodesPage ciphers={[deleted]} loading={false} onNotify={vi.fn()} />);
    expect(screen.getByText('No verification codes')).toBeInTheDocument();
  });

  it('renders a row for a visible TOTP cipher with name and username', () => {
    render(<TotpCodesPage ciphers={[makeCipher()]} loading={false} onNotify={vi.fn()} />);
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('octocat')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('computes and displays a live TOTP code via calcTotpNow', async () => {
    render(<TotpCodesPage ciphers={[makeCipher()]} loading={false} onNotify={vi.fn()} />);
    // Initially placeholder dashes; then a numeric code (possibly space-grouped) appears.
    await waitFor(() => {
      const codeEl = document.querySelector('.totp-code-main strong');
      expect(codeEl?.textContent?.replace(/\s/g, '')).toMatch(/^\d{6}$/);
    });
  });

  it('copies the live code to the clipboard when the copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<TotpCodesPage ciphers={[makeCipher()]} loading={false} onNotify={vi.fn()} />);

    await waitFor(() => {
      const codeEl = document.querySelector('.totp-code-main strong');
      expect(codeEl?.textContent?.replace(/\s/g, '')).toMatch(/^\d{6}$/);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(String(writeText.mock.calls[0][0]).replace(/\s/g, '')).toMatch(/^\d{6}$/);
  });
});
