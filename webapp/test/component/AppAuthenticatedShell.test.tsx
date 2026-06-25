import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { createWouterMock } from './helpers/wouterMock';

// Real wouter resolves its internal `react` import to real React under the jsdom
// config (no renderer -> crash). Swap it for a faithful preact implementation that
// preserves Switch/Route/Link semantics so the shell's <Link>s render real <a>s
// with the correct hrefs and active classes. See the helper.
vi.mock('wouter', () => createWouterMock());

// The shell embeds AppMainRoutes (the route outlet) and NetworkStatusBadge (which
// runs network probes on a 30s timer). Neither is the subject here, so stub both
// with markers to keep the test focused on the shell's OWN layout/nav/branching.
vi.mock('@/components/AppMainRoutes', () => ({
  default: (p: Record<string, unknown>) => <div data-testid="main-routes" data-profile-email={String((p.profile as { email?: string } | null)?.email ?? '')} />,
}));
vi.mock('@/components/NetworkStatusBadge', () => ({
  default: () => <div data-testid="network-badge" />,
}));

import AppAuthenticatedShell from '@/components/AppAuthenticatedShell';
import type { Profile } from '@/lib/types';

const userProfile: Profile = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'User',
  key: 'enc-key',
  masterPasswordHint: '',
  role: 'user',
};
const adminProfile: Profile = { ...userProfile, id: 'admin-1', email: 'admin@example.com', role: 'admin' };

type ShellProps = Parameters<typeof AppAuthenticatedShell>[0];

function buildProps(overrides: Partial<ShellProps> = {}): ShellProps {
  return {
    profile: userProfile,
    location: '/vault',
    mobilePrimaryRoute: '/vault',
    currentPageTitle: 'Vault',
    showSidebarToggle: false,
    sidebarToggleTitle: 'Toggle sidebar',
    settingsAccountRoute: '/settings/account',
    importRoute: '/tools/import-export',
    isImportRoute: false,
    darkMode: false,
    themeToggleTitle: 'Toggle theme',
    onLock: vi.fn(),
    onLogout: vi.fn(),
    onToggleTheme: vi.fn(),
    onToggleMobileSidebar: vi.fn(),
    // mainRoutesProps is forwarded wholesale to the (mocked) AppMainRoutes; only
    // `profile` is read by the marker, so a minimal object is enough.
    mainRoutesProps: { profile: userProfile } as unknown as ShellProps['mainRoutesProps'],
    ...overrides,
  };
}

// Resolve the localStorage nav-layout key so we start each test from a known mode.
const NAV_KEY = 'nodewarden.navLayoutMode';

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState(null, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
  // Link clicks in these tests mutate history via the wouter mock; reset so the
  // URL never leaks into other test files sharing this worker.
  window.history.pushState(null, '', '/');
});

describe('AppAuthenticatedShell', () => {
  it('renders the brand, current page title, and embeds the route outlet + network badge', () => {
    render(<AppAuthenticatedShell {...buildProps({ currentPageTitle: 'Page Heading XYZ' })} />);
    expect(screen.getByText('Page Heading XYZ')).toBeInTheDocument();
    expect(screen.getByTestId('network-badge')).toBeInTheDocument();
    const outlet = screen.getByTestId('main-routes');
    expect(outlet).toBeInTheDocument();
    // mainRoutesProps thread through to the outlet.
    expect(outlet).toHaveAttribute('data-profile-email', 'user@example.com');
  });

  it('shows the signed-in user email in the user chip', () => {
    render(<AppAuthenticatedShell {...buildProps({ profile: adminProfile })} />);
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
  });

  it('renders the core flat nav links for a regular user', () => {
    render(<AppAuthenticatedShell {...buildProps()} />);
    // These nav items are visible to everyone.
    expect(screen.getAllByText('Vault').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sends').length).toBeGreaterThan(0);
    expect(screen.getByText('Account Settings')).toBeInTheDocument();
    expect(screen.getByText('Domain Rules')).toBeInTheDocument();
    expect(screen.getByText('Import & Export')).toBeInTheDocument();
    expect(screen.getByText('Device Management')).toBeInTheDocument();
    // Admin-only links are hidden for a user.
    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Log Center')).not.toBeInTheDocument();
    expect(screen.queryByText('Cloud Backup')).not.toBeInTheDocument();
  });

  it('reveals admin-only nav links for an admin profile', () => {
    render(<AppAuthenticatedShell {...buildProps({ profile: adminProfile })} />);
    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
    expect(screen.getByText('Log Center')).toBeInTheDocument();
    expect(screen.getByText('Cloud Backup')).toBeInTheDocument();
  });

  it('marks the nav link for the current location as active', () => {
    render(<AppAuthenticatedShell {...buildProps({ location: '/sends' })} />);
    const sendsLinks = screen.getAllByText('Sends');
    // The side-link <a> wrapping the "Sends" span carries the active class.
    const sideLink = sendsLinks.map((s) => s.closest('a')).find((a) => a?.className.includes('side-link'));
    expect(sideLink?.className).toContain('active');
  });

  it('fires onLock from the lock button', () => {
    const onLock = vi.fn();
    render(<AppAuthenticatedShell {...buildProps({ onLock })} />);
    // There are two lock buttons (desktop + mobile); click the labelled one.
    fireEvent.click(screen.getByText('Lock'));
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('fires onLogout from the sign-out button', () => {
    const onLogout = vi.fn();
    render(<AppAuthenticatedShell {...buildProps({ onLogout })} />);
    fireEvent.click(screen.getByText('Sign Out'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('fires onToggleTheme when the theme switch changes', () => {
    const onToggleTheme = vi.fn();
    render(<AppAuthenticatedShell {...buildProps({ onToggleTheme })} />);
    // Two ThemeSwitch instances (desktop + mobile); toggling either fires the cb.
    const checkboxes = document.querySelectorAll<HTMLInputElement>('.theme-switch-input');
    expect(checkboxes.length).toBeGreaterThan(0);
    fireEvent.input(checkboxes[0]);
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('only renders the mobile sidebar toggle when showSidebarToggle is set, and fires its callback', () => {
    const onToggleMobileSidebar = vi.fn();
    const { rerender } = render(<AppAuthenticatedShell {...buildProps({ showSidebarToggle: false })} />);
    expect(screen.queryByLabelText('Toggle sidebar')).not.toBeInTheDocument();

    rerender(<AppAuthenticatedShell {...buildProps({ showSidebarToggle: true, onToggleMobileSidebar })} />);
    const toggle = screen.getByLabelText('Toggle sidebar');
    fireEvent.click(toggle);
    expect(onToggleMobileSidebar).toHaveBeenCalledTimes(1);
  });

  it('renders the mobile tabbar and marks the active primary tab', () => {
    render(<AppAuthenticatedShell {...buildProps({ mobilePrimaryRoute: '/settings' })} />);
    const tabbar = screen.getByLabelText('Menu');
    const settingsTab = within(tabbar).getByText('Settings').closest('a');
    expect(settingsTab?.className).toContain('mobile-tab');
    expect(settingsTab?.className).toContain('active');
    // A non-active tab does not get the active class.
    const vaultTab = within(tabbar).getByText('My Vault').closest('a');
    expect(vaultTab?.className).not.toContain('active');
  });

  it('starts in flat nav layout by default (single Vault link, no group trigger)', () => {
    render(<AppAuthenticatedShell {...buildProps()} />);
    // Flat layout exposes Vault as a direct side-link, not a "My Vault" group.
    expect(screen.queryByText('My Vault')).toBeInTheDocument(); // present only in the mobile tabbar
    expect(document.querySelector('.side-nav-group')).toBeNull();
  });

  it('switches to grouped nav layout via the layout picker and persists the choice', () => {
    render(<AppAuthenticatedShell {...buildProps()} />);
    // Open the layout picker.
    fireEvent.click(screen.getByTitle('Navigation style'));
    // Pick the "Grouped" (always-expanded) option.
    const expandedOption = screen.getByText('Grouped');
    fireEvent.click(expandedOption);
    // Grouped layout now renders collapsible nav groups.
    expect(document.querySelector('.side-nav-group')).not.toBeNull();
    // Choice persisted to localStorage.
    expect(window.localStorage.getItem(NAV_KEY)).toBe('grouped-expanded');
  });

  it('honours a persisted grouped-smart nav layout on mount and toggles groups', () => {
    window.localStorage.setItem(NAV_KEY, 'grouped-smart');
    render(<AppAuthenticatedShell {...buildProps({ profile: adminProfile, location: '/sends' })} />);
    const groups = document.querySelectorAll('.side-nav-group');
    expect(groups.length).toBeGreaterThan(0);
    // The "Management" group trigger starts collapsed (location is /sends, not a
    // management route) and toggling it flips aria-expanded.
    const managementTrigger = screen.getByText('Management').closest('button');
    expect(managementTrigger).not.toBeNull();
    const before = managementTrigger!.getAttribute('aria-expanded');
    fireEvent.click(managementTrigger!);
    expect(managementTrigger!.getAttribute('aria-expanded')).not.toBe(before);
  });
});
