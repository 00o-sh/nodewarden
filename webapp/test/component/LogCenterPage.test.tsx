import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import LogCenterPage from '@/components/LogCenterPage';
import type { AuditLogEntry, AuditLogListResult, AuditLogSettings } from '@/lib/types';

const ENTRIES: AuditLogEntry[] = [
  {
    id: 'log-1',
    actorUserId: 'u1',
    actorEmail: 'actor@example.com',
    action: 'auth.login',
    category: 'auth',
    level: 'info',
    targetType: null,
    targetId: null,
    targetUserEmail: null,
    metadata: JSON.stringify({ ip: '1.1.1.1' }),
    createdAt: '2030-01-01T00:00:00.000Z',
  },
  {
    id: 'log-2',
    actorUserId: 'u2',
    actorEmail: 'admin@example.com',
    action: 'admin.user.ban',
    category: 'security',
    level: 'security',
    targetType: 'user',
    targetId: 't1',
    targetUserEmail: 'victim@example.com',
    metadata: null,
    createdAt: '2030-02-01T00:00:00.000Z',
  },
];

function makeResult(logs: AuditLogEntry[]): AuditLogListResult {
  return { logs, total: logs.length, limit: 50, offset: 0, hasMore: false };
}

const DEFAULT_SETTINGS: AuditLogSettings = { retentionDays: 90, maxEntries: null };

function setup(overrides: Partial<Parameters<typeof LogCenterPage>[0]> = {}) {
  const handlers = {
    onLoadLogs: vi.fn().mockResolvedValue(makeResult(ENTRIES)),
    onLoadSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    onSaveSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    onClearLogs: vi.fn().mockResolvedValue(2),
    onNotify: vi.fn(),
  };
  const merged = { ...handlers, ...overrides };
  render(<LogCenterPage {...merged} />);
  return merged;
}

describe('<LogCenterPage>', () => {
  it('loads and renders audit log entries on mount', async () => {
    const handlers = setup();
    expect(handlers.onLoadLogs).toHaveBeenCalled();
    // formatAction humanizes auth.login -> "Auth / Login" when no translation key
    await screen.findAllByText('Auth / Login');
    expect(screen.getByText('Admin / User / Ban')).toBeInTheDocument();
  });

  it('passes initial filter values (offset 0, 7d range) to onLoadLogs', async () => {
    const handlers = setup();
    await waitFor(() => expect(handlers.onLoadLogs).toHaveBeenCalled());
    const firstCall = handlers.onLoadLogs.mock.calls[0][0];
    expect(firstCall.offset).toBe(0);
    expect(firstCall.category).toBe('all');
    expect(firstCall.level).toBe('all');
    // 7d default => from/to present
    expect(firstCall.from).toBeTruthy();
    expect(firstCall.to).toBeTruthy();
  });

  it('reloads logs with the chosen category when the category filter changes', async () => {
    const handlers = setup();
    await screen.findAllByText('Auth / Login');
    handlers.onLoadLogs.mockClear();

    // The category select is the first combobox in the filter form.
    const categorySelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(categorySelect, { target: { value: 'security' } });

    await waitFor(() => expect(handlers.onLoadLogs).toHaveBeenCalled());
    expect(handlers.onLoadLogs.mock.calls.at(-1)![0].category).toBe('security');
  });

  it('reloads with the search query when the filter form is submitted', async () => {
    const handlers = setup();
    await screen.findAllByText('Auth / Login');
    handlers.onLoadLogs.mockClear();

    const searchInput = screen.getByPlaceholderText(/.+/) as HTMLInputElement;
    fireEvent.input(searchInput, { target: { value: 'login' } });
    // submit the form
    fireEvent.submit(searchInput.closest('form')!);

    await waitFor(() => expect(handlers.onLoadLogs).toHaveBeenCalled());
    expect(handlers.onLoadLogs.mock.calls.at(-1)![0].q).toBe('login');
  });

  it('loads settings on mount', async () => {
    const handlers = setup();
    await waitFor(() => expect(handlers.onLoadSettings).toHaveBeenCalledTimes(1));
  });

  it('saves settings when the settings popover save button is clicked', async () => {
    const handlers = setup();
    await screen.findAllByText('Auth / Login');

    // open the settings popover (toolbar trigger)
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/i }));
    const save = await screen.findByRole('button', { name: /^Save$/i });
    fireEvent.click(save);

    await waitFor(() => expect(handlers.onSaveSettings).toHaveBeenCalledTimes(1));
  });

  it('clears logs through the settings danger zone confirm flow', async () => {
    const handlers = setup();
    await screen.findAllByText('Auth / Login');

    fireEvent.click(screen.getByRole('button', { name: /^Settings$/i }));
    // first click reveals the confirm UI
    fireEvent.click(await screen.findByRole('button', { name: /Clear logs/i }));
    // now a confirming "Clear logs" button exists; click it
    const confirmButtons = screen.getAllByRole('button', { name: /Clear logs/i });
    fireEvent.click(confirmButtons.at(-1)!);

    await waitFor(() => expect(handlers.onClearLogs).toHaveBeenCalledTimes(1));
  });

  it('renders the empty state when no logs are returned', async () => {
    const handlers = setup({ onLoadLogs: vi.fn().mockResolvedValue(makeResult([])) });
    await waitFor(() => expect(handlers.onLoadLogs).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getAllByText('No logs found').length).toBeGreaterThan(0);
    });
  });

  it('shows an error and notifies when log loading fails', async () => {
    const handlers = setup({ onLoadLogs: vi.fn().mockRejectedValue(new Error('nope')) });
    await waitFor(() => {
      expect(handlers.onNotify).toHaveBeenCalledWith('error', expect.any(String));
    });
    expect(screen.getByText('Failed to load logs')).toBeInTheDocument();
  });

  it('renders selected log detail metadata', async () => {
    setup();
    await screen.findAllByText('Auth / Login');
    // first log selected by default; its metadata ip should be visible in detail panel
    expect(screen.getByText('1.1.1.1')).toBeInTheDocument();
  });
});
