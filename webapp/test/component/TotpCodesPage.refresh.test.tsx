import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import type { Cipher } from '@/lib/types';

// This suite isolates the periodic-refresh reconciliation in TotpCodesPage: the
// setTotpCodes updater compares each freshly computed code against the previous
// live value and only rewrites state when code/remain/period actually changed.
// By stubbing calcTotpNow with a CONSTANT result, two successive refresh ticks
// yield identical values, driving the "unchanged -> continue" branch that the
// real time-varying implementation never hits within a single test.
vi.mock('@/lib/crypto', async () => {
  const actual = await vi.importActual<typeof import('@/lib/crypto')>('@/lib/crypto');
  return {
    ...actual,
    calcTotpNow: vi.fn().mockResolvedValue({ code: '424242', remain: 21, period: 30 }),
  };
});

import TotpCodesPage from '@/components/TotpCodesPage';
import { calcTotpNow } from '@/lib/crypto';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

function makeCipher(overrides: Partial<Cipher> = {}): Cipher {
  return {
    id: 'c1',
    type: 1,
    name: 'enc-name',
    decName: 'GitHub',
    login: { decUsername: 'octocat', decTotp: 'JBSWY3DPEHPK3PXP' },
    ...overrides,
  } as Cipher;
}

describe('<TotpCodesPage> refresh reconciliation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (calcTotpNow as unknown as ReturnType<typeof vi.fn>).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a stable code across ticks and skips rewriting unchanged rows', async () => {
    render(<TotpCodesPage ciphers={[makeCipher()]} loading={false} onNotify={vi.fn()} />);

    // First tick populates the code (prev was empty => new entry written).
    await vi.advanceTimersByTimeAsync(0);
    const codeEl = document.querySelector('.totp-code-main strong');
    expect(codeEl?.textContent?.replace(/\s/g, '')).toBe('424242');

    // Second interval tick recomputes the SAME code/remain/period; the updater's
    // per-row comparison hits its `continue` (no-change) branch and preserves state.
    await vi.advanceTimersByTimeAsync(1000);
    expect((calcTotpNow as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    const codeElAfter = document.querySelector('.totp-code-main strong');
    expect(codeElAfter?.textContent?.replace(/\s/g, '')).toBe('424242');
    // The timer value reflects the constant remain.
    expect(screen.getByText('21')).toBeInTheDocument();
  });
});
