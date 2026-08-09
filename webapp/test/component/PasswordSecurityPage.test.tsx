import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { createWouterMock } from './helpers/wouterMock';
import PasswordSecurityPage from '@/components/PasswordSecurityPage';
import { t } from '@/lib/i18n';
import type { PasswordSecurityReport, PasswordSecurityItem } from '@/lib/password-security';
import type { Cipher } from '@/lib/types';

// Real wouter resolves its internal `react` import to the real React under
// jsdom, which has no renderer; use the shared preact-native stand-in.
vi.mock('wouter', () => createWouterMock());

// A controllable in-memory stand-in for the shared password-security cache.
// Tests push state transitions through `setState`, which notifies the
// component's subscription exactly like the real cache would.
const cache = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const store: { state: Record<string, unknown> } = { state: {} };
  const emptyState = () => ({
    fingerprint: 'fp',
    report: null,
    scannedAt: null,
    scanning: false,
    progress: { checked: 0, total: 0 },
    scanError: false,
  });
  const reset = () => {
    store.state = emptyState();
    listeners.clear();
  };
  const setState = (patch: Record<string, unknown>) => {
    store.state = { ...store.state, ...patch };
    listeners.forEach((listener) => listener());
  };
  reset();
  return { listeners, store, reset, setState, startScan: vi.fn() };
});

vi.mock('@/lib/password-security-cache', () => ({
  getPasswordSecurityState: () => cache.store.state,
  readPasswordSecurityState: () => cache.store.state,
  subscribePasswordSecurityState: (listener: () => void) => {
    cache.listeners.add(listener);
    return () => cache.listeners.delete(listener);
  },
  startPasswordSecurityScan: (...args: unknown[]) => cache.startScan(...args),
}));

function makeCipher(overrides: Partial<Cipher> = {}): Cipher {
  return {
    id: 'c1',
    type: 1,
    decName: 'Example Login',
    login: { decPassword: 'p@ssword123' },
    revisionDate: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeItem(overrides: Partial<PasswordSecurityItem> = {}): PasswordSecurityItem {
  return { cipherId: 'c1', exposedCount: 0, reusedCount: 1, weak: false, ...overrides };
}

function makeReport(overrides: Partial<PasswordSecurityReport> = {}): PasswordSecurityReport {
  return {
    eligibleCount: 1,
    checkedCount: 1,
    exposedCount: 0,
    reusedCount: 0,
    weakCount: 0,
    unavailableCount: 0,
    items: [makeItem()],
    ...overrides,
  };
}

function renderPage(overrides: { ciphers?: Cipher[]; loading?: boolean } = {}) {
  return render(
    <PasswordSecurityPage
      ciphers={overrides.ciphers ?? [makeCipher()]}
      loading={overrides.loading ?? false}
    />,
  );
}

function pushState(patch: Record<string, unknown>) {
  act(() => cache.setState(patch));
}

describe('<PasswordSecurityPage>', () => {
  beforeEach(() => {
    cache.reset();
    cache.startScan.mockReset();
  });

  it('shows the ready empty state when there are eligible logins but no report', () => {
    renderPage();
    expect(screen.getByText(t('txt_password_security_ready'))).toBeInTheDocument();
    const scanBtn = screen.getByRole('button', { name: new RegExp(t('txt_check_password_security')) });
    expect(scanBtn).not.toBeDisabled();
  });

  it('shows the no-login empty state and disables scan when nothing is eligible', () => {
    renderPage({ ciphers: [makeCipher({ login: { decPassword: '' } })] });
    expect(screen.getByText(t('txt_password_security_no_login'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(t('txt_check_password_security')) })).toBeDisabled();
  });

  it('starts a scan when the scan button is clicked', () => {
    const ciphers = [makeCipher()];
    renderPage({ ciphers });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_check_password_security')) }));
    expect(cache.startScan).toHaveBeenCalledTimes(1);
    expect(cache.startScan.mock.calls[0][1]).toBe(ciphers);
  });

  it('renders the scanning progress summary', () => {
    renderPage();
    pushState({ scanning: true, progress: { checked: 2, total: 5 } });
    expect(screen.getByText('2 / 5')).toBeInTheDocument();
    expect(screen.getByText(t('txt_checking_password_security'))).toBeInTheDocument();
    // While scanning without a report, the metric filter buttons are disabled.
    expect(screen.getByRole('button', { name: new RegExp(t('txt_exposed_passwords')) })).toBeDisabled();
  });

  it('renders a finished report with risk badges and a last-checked timestamp', () => {
    renderPage();
    pushState({
      report: makeReport({
        exposedCount: 1,
        reusedCount: 1,
        weakCount: 1,
        items: [makeItem({ exposedCount: 3, reusedCount: 2, weak: true })],
      }),
      scannedAt: Date.UTC(2026, 0, 2, 3, 4),
    });
    expect(screen.getByText('Example Login')).toBeInTheDocument();
    // Scope badge assertions to the item's badge container ("Reused" also
    // appears as a summary-metric label).
    const badges = document.querySelector('.password-security-badges') as HTMLElement;
    expect(within(badges).getByText(t('txt_password_security_exposed_short', { count: 3 }))).toBeInTheDocument();
    expect(within(badges).getByText(t('txt_password_security_weak_short'))).toBeInTheDocument();
    expect(within(badges).getByText(t('txt_password_security_reused_short'))).toBeInTheDocument();
    expect(document.querySelector('.password-security-checked-at')).toBeTruthy();
    // The recheck label replaces the initial check label once a report exists.
    expect(screen.getByRole('button', { name: new RegExp(t('txt_recheck_password_security')) })).toBeInTheDocument();
  });

  it('shows the not-checked badge when a password could not be verified', () => {
    renderPage();
    pushState({ report: makeReport({ items: [makeItem({ exposedCount: null })] }) });
    expect(screen.getByText(t('txt_password_security_not_checked'))).toBeInTheDocument();
  });

  it('toggles a single password visibility', () => {
    renderPage();
    pushState({ report: makeReport() });
    const secret = document.querySelector('.password-security-password') as HTMLElement;
    expect(secret.textContent).not.toBe('p@ssword123');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t('txt_reveal')}$`) }));
    expect((document.querySelector('.password-security-password') as HTMLElement).textContent).toBe('p@ssword123');
    // Once the only item is revealed the toggle-all button becomes "Hide all",
    // so anchor the item's own control to an exact "Hide" match.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t('txt_hide')}$`) }));
    expect((document.querySelector('.password-security-password') as HTMLElement).textContent).not.toBe('p@ssword123');
  });

  it('reveals and hides all passwords via the toggle-all button', () => {
    renderPage();
    pushState({ report: makeReport() });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_password_security_show_all')) }));
    expect((document.querySelector('.password-security-password') as HTMLElement).textContent).toBe('p@ssword123');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_password_security_hide_all')) }));
    expect((document.querySelector('.password-security-password') as HTMLElement).textContent).not.toBe('p@ssword123');
  });

  it('filters the item list by the metric buttons and shows the empty-filter state', () => {
    renderPage({
      ciphers: [makeCipher({ id: 'c1', decName: 'Exposed One' }), makeCipher({ id: 'c2', decName: 'Clean Two' })],
    });
    pushState({
      report: makeReport({
        eligibleCount: 2,
        checkedCount: 2,
        exposedCount: 1,
        items: [
          makeItem({ cipherId: 'c1', exposedCount: 4 }),
          makeItem({ cipherId: 'c2', exposedCount: 0 }),
        ],
      }),
    });
    // Filter to exposed: only the exposed item remains.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_exposed_passwords')) }));
    const list = document.querySelector('.password-security-list') as HTMLElement;
    expect(within(list).getByText('Exposed One')).toBeInTheDocument();
    expect(within(list).queryByText('Clean Two')).not.toBeInTheDocument();
    // Filter to weak: no weak items -> empty-in-filter message.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_weak_passwords')) }));
    expect(screen.getByText(t('txt_no_password_risks_in_filter'))).toBeInTheDocument();
    // Filter to reused: none reused (reusedCount 1) -> still empty.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_reused_passwords')) }));
    expect(screen.getByText(t('txt_no_password_risks_in_filter'))).toBeInTheDocument();
    // Back to all via the checked metric.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_passwords_checked')) }));
    expect(within(document.querySelector('.password-security-list') as HTMLElement).getByText('Clean Two')).toBeInTheDocument();
  });

  it('shows the no-risks state for a report with no items', () => {
    renderPage();
    pushState({ report: makeReport({ items: [] }) });
    expect(screen.getByText(t('txt_no_password_risks'))).toBeInTheDocument();
  });

  it('renders the unavailable-count notice', () => {
    renderPage();
    pushState({ report: makeReport({ unavailableCount: 2 }) });
    expect(screen.getByText(t('txt_password_security_unavailable', { count: 2 }))).toBeInTheDocument();
  });

  it('renders the scan-failed notice on error', () => {
    renderPage();
    pushState({ scanError: true, scanning: false });
    expect(screen.getByText(t('txt_password_security_check_failed'))).toBeInTheDocument();
  });

  it('falls back to the no-name label when the cipher has no name', () => {
    renderPage({ ciphers: [makeCipher({ id: 'c1', decName: '', name: '' })] });
    pushState({ report: makeReport() });
    expect(screen.getByText(t('txt_no_name'))).toBeInTheDocument();
  });

  it('renders a jump-to-item link pointing at the vault cipher', () => {
    renderPage();
    pushState({ report: makeReport() });
    const link = screen.getByRole('link', { name: new RegExp(t('txt_password_security_jump')) }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain('c1');
  });

  it('re-initialises state when the vault fingerprint changes', async () => {
    const { rerender } = renderPage();
    pushState({ report: makeReport() });
    expect(document.querySelector('.password-security-list')).toBeTruthy();
    // Swapping to a different vault produces a new fingerprint; the effect
    // re-reads the (now empty) cache state and drops the previous report.
    cache.store.state = { fingerprint: 'fp2', report: null, scannedAt: null, scanning: false, progress: { checked: 0, total: 0 }, scanError: false };
    rerender(<PasswordSecurityPage ciphers={[makeCipher({ id: 'other', decName: 'Other' })]} loading={false} />);
    await waitFor(() => expect(document.querySelector('.password-security-list')).toBeFalsy());
  });
});
