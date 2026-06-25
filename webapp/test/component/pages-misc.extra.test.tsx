import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import SendsPage from '@/components/SendsPage';
import DomainRulesPage from '@/components/DomainRulesPage';
import LogCenterPage from '@/components/LogCenterPage';
import PublicSendPage from '@/components/PublicSendPage';
import { t } from '@/lib/i18n';
import type { Send } from '@/lib/types';
import type { AuditLogEntry, AuditLogListResult, AuditLogSettings, DomainRules } from '@/lib/types';

// ----- PublicSendPage api/download mocks -----
const accessPublicSend = vi.fn();
const decryptPublicSend = vi.fn();
const accessPublicSendFile = vi.fn();
const decryptPublicSendFileBytes = vi.fn();

vi.mock('@/lib/api/send', () => ({
  accessPublicSend: (...args: unknown[]) => accessPublicSend(...args),
  decryptPublicSend: (...args: unknown[]) => decryptPublicSend(...args),
  accessPublicSendFile: (...args: unknown[]) => accessPublicSendFile(...args),
  decryptPublicSendFileBytes: (...args: unknown[]) => decryptPublicSendFileBytes(...args),
}));

const downloadBytesAsFile = vi.fn();
vi.mock('@/lib/download', () => ({
  downloadBytesAsFile: (...args: unknown[]) => downloadBytesAsFile(...args),
  readResponseBytesWithProgress: vi.fn(async (resp: Response) => new Uint8Array(await resp.arrayBuffer())),
}));

// =====================================================================
// SendsPage extra branches
// =====================================================================
function makeSend(overrides: Partial<Send> = {}): Send {
  return {
    id: 'send-1',
    accessId: 'access-1',
    type: 0,
    accessCount: 2,
    decName: 'Alpha Note',
    decText: 'hello world',
    deletionDate: '2026-07-01T00:00:00.000Z',
    expirationDate: null,
    ...overrides,
  };
}

function setupSends(overrides: Partial<Parameters<typeof SendsPage>[0]> = {}) {
  const onRefresh = vi.fn(async () => {});
  const onCreate = vi.fn(async () => {});
  const onUpdate = vi.fn(async () => {});
  const onDelete = vi.fn(async () => {});
  const onBulkDelete = vi.fn(async () => {});
  const onNotify = vi.fn();
  const sends: Send[] = overrides.sends ?? [makeSend()];
  const utils = render(
    <SendsPage
      sends={sends}
      loading={false}
      onRefresh={onRefresh}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onBulkDelete={onBulkDelete}
      uploadingSendFileName=""
      sendUploadPercent={null}
      mobileSidebarToggleKey={0}
      onNotify={onNotify}
      {...overrides}
    />
  );
  return { onRefresh, onCreate, onUpdate, onDelete, onBulkDelete, onNotify, sends, ...utils };
}

describe('<SendsPage> extra', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  });

  it('filters by the text type and hides file sends', () => {
    setupSends({
      sends: [
        makeSend({ id: 'a', type: 0, decName: 'A Text' }),
        makeSend({ id: 'b', type: 1, decName: 'B File' }),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t('txt_text')}$`) }));
    const list = document.querySelector('.list-panel') as HTMLElement;
    expect(within(list).getByText('A Text')).toBeInTheDocument();
    expect(within(list).queryByText('B File')).not.toBeInTheDocument();
  });

  it('filters by the file type and hides text sends', () => {
    setupSends({
      sends: [
        makeSend({ id: 'a', type: 0, decName: 'A Text' }),
        makeSend({ id: 'b', type: 1, decName: 'B File' }),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t('txt_file')}$`) }));
    const list = document.querySelector('.list-panel') as HTMLElement;
    expect(within(list).getByText('B File')).toBeInTheDocument();
    expect(within(list).queryByText('A Text')).not.toBeInTheDocument();
  });

  it('searches sends by name', () => {
    setupSends({
      sends: [
        makeSend({ id: 'a', decName: 'Alpha Note' }),
        makeSend({ id: 'b', decName: 'Beta Memo' }),
      ],
    });
    fireEvent.input(screen.getByPlaceholderText(t('txt_search_sends')), { target: { value: 'beta' } });
    const list = document.querySelector('.list-panel') as HTMLElement;
    expect(within(list).getByText('Beta Memo')).toBeInTheDocument();
    expect(within(list).queryByText('Alpha Note')).not.toBeInTheDocument();
  });

  it('validates that a file is required when creating a file send', async () => {
    const { onCreate, onNotify } = setupSends();
    fireEvent.click(screen.getByRole('button', { name: t('txt_add') }));
    // switch to file type radio
    const fileRadio = document.querySelector('input[type="radio"]') as HTMLInputElement;
    fireEvent.click(fileRadio);
    // name is required first; provide one
    const nameInput = document.querySelector('.field input.input') as HTMLInputElement;
    fireEvent.input(nameInput, { target: { value: 'File Send' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_save')) }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_please_select_a_file')));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('validates that text is required for a text send', async () => {
    const { onCreate, onNotify } = setupSends();
    fireEvent.click(screen.getByRole('button', { name: t('txt_add') }));
    const nameInput = document.querySelector('.field input.input') as HTMLInputElement;
    fireEvent.input(nameInput, { target: { value: 'Text Send' } });
    // leave text empty
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_save')) }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_text_is_required')));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('cancels the create form and returns to the list without creating', () => {
    const { onCreate } = setupSends();
    fireEvent.click(screen.getByRole('button', { name: t('txt_add') }));
    expect(screen.getByText(t('txt_new_send'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_cancel')) }));
    expect(screen.queryByText(t('txt_new_send'))).not.toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('copies the access link from the detail view', () => {
    setupSends();
    const copyBtn = screen.getByRole('button', { name: new RegExp(t('txt_copy_link')) });
    // Should not throw even if navigator.clipboard is absent (handler is fire-and-forget).
    expect(() => fireEvent.click(copyBtn)).not.toThrow();
  });

  it('clears a bulk selection with the cancel toolbar button', () => {
    setupSends({ sends: [makeSend(), makeSend({ id: 'send-2', decName: 'Second' })] });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_select_all')) }));
    // The toolbar cancel button appears once items are selected.
    const toolbar = document.querySelector('.toolbar') as HTMLElement;
    const cancelBtn = within(toolbar).getByRole('button', { name: new RegExp(t('txt_cancel')) });
    fireEvent.click(cancelBtn);
    // Delete-selected becomes disabled again (no selection).
    const bulkDeleteBtn = toolbar.querySelector('.btn-danger') as HTMLButtonElement;
    expect(bulkDeleteBtn.disabled).toBe(true);
  });

  it('toggles the password visibility in the edit form', () => {
    setupSends();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_edit')) }));
    const pwInput = document.querySelector('.password-wrap input') as HTMLInputElement;
    expect(pwInput.type).toBe('password');
    const toggle = document.querySelector('.password-toggle') as HTMLButtonElement;
    fireEvent.click(toggle);
    expect(pwInput.type).toBe('text');
  });
});

// =====================================================================
// DomainRulesPage extra branches
// =====================================================================
function makeRules(overrides: Partial<DomainRules> = {}): DomainRules {
  return {
    equivalentDomains: [],
    customEquivalentDomains: [
      { id: 'r1', domains: ['alpha.com', 'alpha.net'], excluded: false },
    ],
    globalEquivalentDomains: [
      { type: 1, domains: ['google.com', 'youtube.com'], excluded: false },
    ],
    object: 'domains',
    ...overrides,
  };
}

function baseDomainProps(overrides: Partial<Parameters<typeof DomainRulesPage>[0]> = {}): Parameters<typeof DomainRulesPage>[0] {
  return {
    rules: makeRules(),
    loading: false,
    error: '',
    onRefresh: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    onNotify: vi.fn(),
    ...overrides,
  };
}

describe('<DomainRulesPage> extra', () => {
  it('adds a new custom rule with two valid domains', async () => {
    const onNotify = vi.fn();
    render(<DomainRulesPage {...baseDomainProps({ onNotify })} />);
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));

    const inputs = document.querySelectorAll('.domain-rule-new-row input.domain-rule-inline-input');
    fireEvent.input(inputs[0], { target: { value: 'one.com' } });
    fireEvent.input(inputs[1], { target: { value: 'two.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));

    await waitFor(() => expect(screen.getByText('one.com, two.com')).toBeInTheDocument());
    // No warning should have fired for a valid rule.
    expect(onNotify).not.toHaveBeenCalled();
  });

  it('edits an existing custom rule and updates its displayed domains', async () => {
    render(<DomainRulesPage {...baseDomainProps()} />);
    fireEvent.click(screen.getByRole('button', { name: t('txt_edit') }));
    const inputs = document.querySelectorAll('.domain-rule-editing-row input.domain-rule-inline-input');
    fireEvent.input(inputs[0], { target: { value: 'gamma.com' } });
    fireEvent.input(inputs[1], { target: { value: 'gamma.net' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));
    await waitFor(() => expect(screen.getByText('gamma.com, gamma.net')).toBeInTheDocument());
  });

  it('deletes a custom rule and shows the empty state', async () => {
    render(<DomainRulesPage {...baseDomainProps()} />);
    expect(screen.getByText('alpha.com, alpha.net')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t('txt_delete') }));
    await waitFor(() => expect(screen.getByText('No custom domain rules')).toBeInTheDocument());
  });

  it('cancels the new-rule editor without adding a rule', () => {
    render(<DomainRulesPage {...baseDomainProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));
    expect(document.querySelector('.domain-rule-new-row')).toBeTruthy();
    // The cancel button inside the new-rule row.
    const newRow = document.querySelector('.domain-rule-new-row') as HTMLElement;
    fireEvent.click(within(newRow).getByRole('button', { name: new RegExp(t('txt_cancel')) }));
    expect(document.querySelector('.domain-rule-new-row')).toBeFalsy();
  });

  it('notifies an error when onSave rejects', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('save-failed'));
    const onNotify = vi.fn();
    render(<DomainRulesPage {...baseDomainProps({ onSave, onNotify })} />);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'save-failed'));
  });

  it('disables a custom rule via its enabled checkbox and still saves it', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DomainRulesPage {...baseDomainProps({ onSave })} />);
    const customSection = screen.getByText('Custom equivalent domains').closest('section')!;
    const checkbox = within(customSection).getAllByRole('checkbox')[0] as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0][0].excluded).toBe(true);
  });
});

// =====================================================================
// LogCenterPage extra branches
// =====================================================================
const LOG_ENTRIES: AuditLogEntry[] = [
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
];

function makeLogResult(logs: AuditLogEntry[], extra: Partial<AuditLogListResult> = {}): AuditLogListResult {
  return { logs, total: logs.length, limit: 50, offset: 0, hasMore: false, ...extra };
}

const LOG_SETTINGS: AuditLogSettings = { retentionDays: 90, maxEntries: null };

function setupLogs(overrides: Partial<Parameters<typeof LogCenterPage>[0]> = {}) {
  const handlers = {
    onLoadLogs: vi.fn().mockResolvedValue(makeLogResult(LOG_ENTRIES)),
    onLoadSettings: vi.fn().mockResolvedValue(LOG_SETTINGS),
    onSaveSettings: vi.fn().mockResolvedValue(LOG_SETTINGS),
    onClearLogs: vi.fn().mockResolvedValue(1),
    onNotify: vi.fn(),
  };
  const merged = { ...handlers, ...overrides };
  render(<LogCenterPage {...merged} />);
  return merged;
}

describe('<LogCenterPage> extra', () => {
  it('reloads when the level filter changes', async () => {
    const handlers = setupLogs();
    await screen.findAllByText('Auth / Login');
    handlers.onLoadLogs.mockClear();
    // Level select is the 2nd combobox in the filter form.
    const levelSelect = screen.getAllByRole('combobox')[1];
    fireEvent.change(levelSelect, { target: { value: 'error' } });
    await waitFor(() => expect(handlers.onLoadLogs).toHaveBeenCalled());
    expect(handlers.onLoadLogs.mock.calls.at(-1)![0].level).toBe('error');
  });

  it('reloads with an "all" time range that omits from/to', async () => {
    const handlers = setupLogs();
    await screen.findAllByText('Auth / Login');
    handlers.onLoadLogs.mockClear();
    const rangeSelect = screen.getAllByRole('combobox')[2];
    fireEvent.change(rangeSelect, { target: { value: 'all' } });
    await waitFor(() => expect(handlers.onLoadLogs).toHaveBeenCalled());
    const call = handlers.onLoadLogs.mock.calls.at(-1)![0];
    expect(call.from).toBeUndefined();
    expect(call.to).toBeUndefined();
  });

  it('paginates to the next page when more results exist', async () => {
    const handlers = setupLogs({
      onLoadLogs: vi.fn().mockResolvedValue(makeLogResult(LOG_ENTRIES, { total: 120, hasMore: true })),
    });
    await screen.findAllByText('Auth / Login');
    handlers.onLoadLogs.mockClear();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_next')) }));
    await waitFor(() => expect(handlers.onLoadLogs).toHaveBeenCalled());
    expect(handlers.onLoadLogs.mock.calls.at(-1)![0].offset).toBe(50);
  });

  it('refreshes logs via the toolbar refresh button', async () => {
    const handlers = setupLogs();
    await screen.findAllByText('Auth / Login');
    handlers.onLoadLogs.mockClear();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_refresh')) }));
    await waitFor(() => expect(handlers.onLoadLogs).toHaveBeenCalled());
  });

  it('switches the retention settings into entries mode', async () => {
    const handlers = setupLogs();
    await screen.findAllByText('Auth / Login');
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/i }));
    // The entries-mode toggle button switches the popover to max-entries.
    fireEvent.click(await screen.findByRole('button', { name: t('txt_log_retention_mode_entries') }));
    expect(await screen.findByText(t('txt_log_max_entries'))).toBeInTheDocument();
    void handlers;
  });

  it('notifies an error when saving settings fails', async () => {
    const handlers = setupLogs({ onSaveSettings: vi.fn().mockRejectedValue(new Error('x')) });
    await screen.findAllByText('Auth / Login');
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(handlers.onNotify).toHaveBeenCalledWith('error', t('txt_log_settings_save_failed')));
  });

  it('notifies an error when clearing logs fails', async () => {
    const handlers = setupLogs({ onClearLogs: vi.fn().mockRejectedValue(new Error('x')) });
    await screen.findAllByText('Auth / Login');
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Clear logs/i }));
    const confirmButtons = screen.getAllByRole('button', { name: /Clear logs/i });
    fireEvent.click(confirmButtons.at(-1)!);
    await waitFor(() => expect(handlers.onNotify).toHaveBeenCalledWith('error', t('txt_clear_logs_failed')));
  });

  it('notifies an error when settings loading fails', async () => {
    const handlers = setupLogs({ onLoadSettings: vi.fn().mockRejectedValue(new Error('x')) });
    await waitFor(() => expect(handlers.onNotify).toHaveBeenCalledWith('error', t('txt_load_log_settings_failed')));
  });
});

// =====================================================================
// PublicSendPage extra branches
// =====================================================================
const VALID_KEY = 'AAAAAAAAAAAAAAAAAAAAAA'; // 16 zero bytes

describe('<PublicSendPage> extra', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the expiration note for a text send with an expiration date', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue({
      id: 'send-1',
      type: 0,
      decName: 'Expiring',
      decText: 'soon gone',
      expirationDate: '2030-12-31T00:00:00.000Z',
    });
    render(<PublicSendPage accessId="acc-1" keyPart={VALID_KEY} />);
    await screen.findByText('soon gone');
    expect(screen.getByText(t('txt_expires_at_value', { value: '2030-12-31T00:00:00.000Z' }))).toBeInTheDocument();
  });

  it('downloads a file send and writes bytes to disk', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue({
      id: 'send-2',
      type: 1,
      decName: 'A File Send',
      decFileName: 'report.pdf',
      file: { id: 'file-1', fileName: 'report.enc', sizeName: '12 KB' },
    });
    accessPublicSendFile.mockResolvedValue('https://example.test/blob');
    decryptPublicSendFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([9, 9, 9]), { status: 200 })
    );

    render(<PublicSendPage accessId="acc-2" keyPart={VALID_KEY} />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_download')) }));

    await waitFor(() => expect(accessPublicSendFile).toHaveBeenCalled());
    await waitFor(() => expect(downloadBytesAsFile).toHaveBeenCalled());
    fetchSpy.mockRestore();
  });

  it('shows a download error when the file fetch fails', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue({
      id: 'send-3',
      type: 1,
      decName: 'A File Send',
      decFileName: 'report.pdf',
      file: { id: 'file-1', fileName: 'report.enc', sizeName: '12 KB' },
    });
    accessPublicSendFile.mockResolvedValue('https://example.test/blob');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500 })
    );

    render(<PublicSendPage accessId="acc-3" keyPart={VALID_KEY} />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_download')) }));
    await screen.findByText(t('txt_download_failed'));
    fetchSpy.mockRestore();
  });

  it('shows the send-unavailable message when the decrypted payload is unparseable', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    // Returns a payload missing a valid id/type so parsePublicSendData -> null,
    // which throws txt_send_unavailable in loadSend.
    decryptPublicSend.mockResolvedValue({ nonsense: true });
    render(<PublicSendPage accessId="acc-4" keyPart={VALID_KEY} />);
    expect(await screen.findByText(t('txt_send_unavailable'))).toBeInTheDocument();
  });
});
