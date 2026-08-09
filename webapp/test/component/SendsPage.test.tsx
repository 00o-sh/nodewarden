import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import SendsPage from '@/components/SendsPage';
import { t } from '@/lib/i18n';
import type { Send } from '@/lib/types';

let matchMediaMatches = false;
const mediaListeners = new Set<(e: { matches: boolean }) => void>();
const originalMatchMedia = window.matchMedia;

function installMatchMedia(matches: boolean) {
  matchMediaMatches = matches;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return matchMediaMatches;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, cb: (e: { matches: boolean }) => void) => mediaListeners.add(cb),
    removeEventListener: (_type: string, cb: (e: { matches: boolean }) => void) => mediaListeners.delete(cb),
    addListener: (cb: (e: { matches: boolean }) => void) => mediaListeners.add(cb),
    removeListener: (cb: (e: { matches: boolean }) => void) => mediaListeners.delete(cb),
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
}

function setMobileLayout(next: boolean) {
  matchMediaMatches = next;
  act(() => {
    for (const cb of Array.from(mediaListeners)) cb({ matches: next });
  });
}

function ensureClipboardSpy() {
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.resolve() },
      configurable: true,
    });
  }
  return vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
}

function makeSend(overrides: Partial<Send> = {}): Send {
  return {
    id: 'send-1',
    accessId: 'access-1',
    type: 0,
    accessCount: 2,
    decName: 'My Secret Note',
    decText: 'hello world',
    deletionDate: '2026-07-01T00:00:00.000Z',
    expirationDate: null,
    ...overrides,
  };
}

function setup(overrides: Partial<Parameters<typeof SendsPage>[0]> = {}) {
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

describe('<SendsPage>', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mediaListeners.clear();
    installMatchMedia(false);
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    matchMediaMatches = false;
    mediaListeners.clear();
  });

  it('renders the send list from the fixture', () => {
    setup({ sends: [makeSend(), makeSend({ id: 'send-2', decName: 'Second Send' })] });
    // The first send also appears as the auto-selected detail title, so it shows
    // up more than once; the second appears only in the list.
    expect(screen.getAllByText('My Secret Note').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Second Send')).toBeInTheDocument();
  });

  it('shows the empty state when there are no sends', () => {
    setup({ sends: [] });
    expect(screen.getByText(t('txt_no_sends'))).toBeInTheDocument();
  });

  it('auto-selects the first send and shows its detail view', () => {
    setup();
    // The detail view shows the type label for a text send.
    expect(screen.getByText(t('txt_text_send'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(t('txt_edit')) })).toBeInTheDocument();
  });

  it('opens the create form and fires onCreate after filling required fields', async () => {
    const { onCreate } = setup();
    // The add button is icon-only with aria-label txt_add.
    fireEvent.click(screen.getByRole('button', { name: t('txt_add') }));
    expect(screen.getByText(t('txt_new_send'))).toBeInTheDocument();

    // Default draft type is 'text'; fill name + text.
    const nameInput = document.querySelector('.field input.input') as HTMLInputElement;
    fireEvent.input(nameInput, { target: { value: 'New Send Name' } });
    const textArea = document.querySelector('textarea.input') as HTMLTextAreaElement;
    fireEvent.input(textArea, { target: { value: 'some body text' } });

    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_save')) }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const draftArg = onCreate.mock.calls[0][0];
    expect(draftArg.name).toBe('New Send Name');
    expect(draftArg.text).toBe('some body text');
  });

  it('validates required name on create and notifies instead of calling onCreate', async () => {
    const { onCreate, onNotify } = setup();
    fireEvent.click(screen.getByRole('button', { name: t('txt_add') }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_save')) }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_name_is_required')));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('opens the edit form for the selected send and fires onUpdate', async () => {
    const { onUpdate } = setup();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_edit')) }));
    expect(screen.getByText(t('txt_edit_send'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_save')) }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0][0].id).toBe('send-1');
  });

  it('fires onDelete from the detail view delete button', async () => {
    const { onDelete } = setup();
    // txt_delete and txt_delete_selected share the label "Delete"; the detail
    // delete button is uniquely marked with the detail-delete-btn class.
    const deleteBtn = document.querySelector('.detail-delete-btn') as HTMLButtonElement;
    expect(deleteBtn).toBeTruthy();
    fireEvent.click(deleteBtn);
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(onDelete.mock.calls[0][0].id).toBe('send-1');
  });

  it('fires onRefresh when the refresh button is clicked', async () => {
    const { onRefresh } = setup();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_refresh')) }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('shows a lock icon in the list row for a password-protected send', () => {
    setup({ sends: [makeSend({ password: 'secret' })] });
    // The list-sub line renders an inline lock icon only when send.password is set.
    const lockIcon = document.querySelector('.list-sub .inline-icon');
    expect(lockIcon).toBeTruthy();
  });

  it('edits a password-protected send: shows the masked field + Remove, then reveals a fresh password input', async () => {
    setup({ sends: [makeSend({ password: 'secret' })] });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_edit')) }));
    expect(screen.getByText(t('txt_edit_send'))).toBeInTheDocument();

    // hasPassword branch: a disabled masked input plus a Remove button.
    const removeBtn = screen.getByRole('button', { name: t('txt_remove') });
    const maskedInput = document.querySelector('.password-wrap input[disabled]') as HTMLInputElement;
    expect(maskedInput).toBeTruthy();
    expect(maskedInput.value).toContain('•');

    // Removing the password flips to the editable input (else branch).
    fireEvent.click(removeBtn);
    const editable = document.querySelector('.password-wrap input:not([disabled])') as HTMLInputElement;
    expect(editable).toBeTruthy();
    expect(editable.type).toBe('password');

    // Typing updates the draft password via the onInput handler.
    fireEvent.input(editable, { target: { value: 'new-pass' } });
    expect((document.querySelector('.password-wrap input:not([disabled])') as HTMLInputElement).value).toBe('new-pass');

    // Toggling visibility exercises the showPassword branch (type -> text).
    const toggle = document.querySelector('.password-wrap .password-toggle') as HTMLButtonElement;
    fireEvent.click(toggle);
    const revealed = document.querySelector('.password-wrap input:not([disabled])') as HTMLInputElement;
    expect(revealed.type).toBe('text');
  });

  it('fires onBulkDelete after selecting all and clicking delete selected', async () => {
    const { onBulkDelete } = setup({
      sends: [makeSend(), makeSend({ id: 'send-2', decName: 'Second' })],
    });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_select_all')) }));
    // The "Delete selected" toolbar button shares the "Delete" label but lives
    // in the list toolbar with the btn-danger class (the detail delete button
    // only renders inside .detail-actions).
    const bulkDeleteBtn = document.querySelector('.toolbar .btn-danger') as HTMLButtonElement;
    expect(bulkDeleteBtn).toBeTruthy();
    fireEvent.click(bulkDeleteBtn);
    await waitFor(() => expect(onBulkDelete).toHaveBeenCalledTimes(1));
    expect(onBulkDelete.mock.calls[0][0]).toEqual(expect.arrayContaining(['send-1', 'send-2']));
  });

  it('renders the file-send detail view with file name + size and a notes card', () => {
    setup({
      sends: [
        makeSend({
          type: 1,
          decName: 'A File',
          decNotes: 'private note',
          file: { id: 'f1', fileName: 'report.pdf', sizeName: '10 KB' },
          expirationDate: '2026-09-01T00:00:00.000Z',
        }),
      ],
    });
    // File-send detail branch shows the file label + name + size.
    expect(screen.getByText(t('txt_file_send'))).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('10 KB')).toBeInTheDocument();
    // Notes card renders when decNotes is non-empty.
    expect(screen.getByText('private note')).toBeInTheDocument();
    // The expiration date is formatted rather than shown as the dash fallback.
    const formatted = new Date('2026-09-01T00:00:00.000Z').toLocaleString();
    expect(screen.getByText(formatted)).toBeInTheDocument();
  });

  it('falls back to encrypted-file/dash placeholders for a file send with no file metadata', () => {
    setup({ sends: [makeSend({ type: 1, decName: 'Bare File', file: undefined })] });
    expect(screen.getByText(t('txt_encrypted_file_2'))).toBeInTheDocument();
    // Multiple dashes may render (file size + expiration date); at least one present.
    expect(screen.getAllByText(t('txt_dash')).length).toBeGreaterThanOrEqual(1);
  });

  it('selects a send via the row-main button and toggles its checkbox', () => {
    setup({
      sends: [
        makeSend({ id: 'send-1', decName: 'First' }),
        makeSend({ id: 'send-2', decName: 'Second' }),
      ],
    });
    // Click the second row's main button to select it.
    const rowButtons = document.querySelectorAll('.row-main');
    fireEvent.click(rowButtons[1] as HTMLButtonElement);
    // Its detail title now shows.
    expect(screen.getAllByText('Second').length).toBeGreaterThanOrEqual(1);
    // Toggle the row checkbox on -> the delete-selected button enables.
    const checkbox = document.querySelectorAll('.row-check')[1] as HTMLInputElement;
    fireEvent.input(checkbox, { target: { checked: true } });
    const bulkBtn = document.querySelector('.toolbar .btn-danger') as HTMLButtonElement;
    expect(bulkBtn.disabled).toBe(false);
  });

  it('does not change selection when the checkbox area of a row is clicked', () => {
    setup({
      sends: [
        makeSend({ id: 'send-1', decName: 'First' }),
        makeSend({ id: 'send-2', decName: 'Second' }),
      ],
    });
    // Clicking the row wrapper directly on the checkbox should not switch selection
    // (the list-item onClick early-returns when target is inside .row-check).
    const checkbox = document.querySelectorAll('.row-check')[1] as HTMLInputElement;
    fireEvent.click(checkbox);
    // First send remains the auto-selected detail.
    expect(screen.getAllByText('First').length).toBeGreaterThanOrEqual(1);
  });

  it('edits a file send draft, toggling disable + auto-copy options and saving via onUpdate', async () => {
    const { onUpdate } = setup({
      sends: [
        makeSend({
          type: 1,
          decName: 'Payload',
          maxAccessCount: 5,
          disabled: true,
          deletionDate: '2026-12-01T00:00:00.000Z',
          expirationDate: '2026-12-15T00:00:00.000Z',
          file: { id: 'f1', fileName: 'a.pdf', sizeName: '1 KB' },
        }),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_edit')) }));
    // The disable checkbox reflects the draft (checked) and can be toggled off.
    const checkboxes = Array.from(document.querySelectorAll('.send-options input[type="checkbox"]')) as HTMLInputElement[];
    expect(checkboxes[0].checked).toBe(true);
    fireEvent.click(checkboxes[0]);
    // Auto-copy checkbox toggled on.
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_save')) }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    // autoCopyLink argument is the 3rd param and should now be true.
    expect(onUpdate.mock.calls[0][2]).toBe(true);
  });

  it('shows the dash fallback for a send with an unparseable expiration date', () => {
    setup({ sends: [makeSend({ expirationDate: 'not-a-date' })] });
    // formatSendDate returns the dash for NaN dates.
    expect(screen.getAllByText(t('txt_dash')).length).toBeGreaterThanOrEqual(1);
  });

  it('copies an absolute share URL unchanged from the detail view', () => {
    const copySpy = ensureClipboardSpy();
    setup({ sends: [makeSend({ shareUrl: 'https://share.example/abc' })] });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_copy_link')) }));
    expect(copySpy).toHaveBeenCalledWith('https://share.example/abc');
  });

  it('builds an access URL from the origin when only an accessId is available', () => {
    const copySpy = ensureClipboardSpy();
    setup({ sends: [makeSend({ shareUrl: undefined, accessId: 'xyz' })] });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_copy_link')) }));
    expect(copySpy).toHaveBeenCalledWith(`${window.location.origin}/#/send/xyz`);
  });

  it('persists the auto-copy preference to localStorage when toggled', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_edit')) }));
    const checkboxes = Array.from(document.querySelectorAll('.send-options input[type="checkbox"]')) as HTMLInputElement[];
    // Second options checkbox is the auto-copy toggle.
    fireEvent.click(checkboxes[1]);
    expect(localStorage.getItem('nodewarden.send.auto_copy_link.v1')).toBe('1');
  });

  it('reads the stored auto-copy preference as checked on mount', () => {
    localStorage.setItem('nodewarden.send.auto_copy_link.v1', '1');
    setup();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_edit')) }));
    const checkboxes = Array.from(document.querySelectorAll('.send-options input[type="checkbox"]')) as HTMLInputElement[];
    expect(checkboxes[1].checked).toBe(true);
  });

  it('normalizes a root-relative hash share URL against the origin', () => {
    const copySpy = ensureClipboardSpy();
    setup({ sends: [makeSend({ shareUrl: '/#/send/abc' })] });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_copy_link')) }));
    expect(copySpy).toHaveBeenCalledWith(`${window.location.origin}/#/send/abc`);
  });

  it('normalizes a bare hash share URL against the origin', () => {
    const copySpy = ensureClipboardSpy();
    setup({ sends: [makeSend({ shareUrl: '#/send/abc' })] });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_copy_link')) }));
    expect(copySpy).toHaveBeenCalledWith(`${window.location.origin}/#/send/abc`);
  });

  it('shows the no-name fallback in the detail title for an unnamed send', () => {
    setup({ sends: [makeSend({ decName: '' })] });
    expect(screen.getAllByText(t('txt_no_name')).length).toBeGreaterThanOrEqual(1);
  });

  it('shows the list loading skeleton when loading with no sends yet', () => {
    setup({ sends: [], loading: true });
    expect(document.querySelector('.list-panel')?.children.length).toBeGreaterThan(0);
    // The empty "no sends" message is suppressed while loading.
    expect(screen.queryByText(t('txt_no_sends'))).not.toBeInTheDocument();
  });

  it('captures a chosen file in the create form file input', async () => {
    const { onCreate } = setup();
    fireEvent.click(screen.getByRole('button', { name: t('txt_add') }));
    // Switch to the file type radio.
    const fileRadio = document.querySelector('input[type="radio"]') as HTMLInputElement;
    fireEvent.click(fileRadio);
    const nameInput = document.querySelector('.field input.input') as HTMLInputElement;
    fireEvent.input(nameInput, { target: { value: 'With File' } });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['data'], 'doc.txt', { type: 'text/plain' });
    fireEvent.input(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_save')) }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0].file).toBeTruthy();
  });
});

describe('<SendsPage> mobile layout', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mediaListeners.clear();
    installMatchMedia(true);
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    matchMediaMatches = false;
    mediaListeners.clear();
  });

  function mobileSetup(overrides: Partial<Parameters<typeof SendsPage>[0]> = {}) {
    const onRefresh = vi.fn(async () => {});
    const onCreate = vi.fn(async () => {});
    const onUpdate = vi.fn(async () => {});
    const onDelete = vi.fn(async () => {});
    const onBulkDelete = vi.fn(async () => {});
    const onNotify = vi.fn();
    const sends: Send[] = overrides.sends ?? [
      makeSend({ id: 'send-1', decName: 'First' }),
      makeSend({ id: 'send-2', decName: 'Second' }),
    ];
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

  it('starts in the mobile list panel and switches to detail when a send is opened', () => {
    mobileSetup();
    const grid = document.querySelector('.vault-grid') as HTMLElement;
    expect(grid.className).toContain('mobile-panel-list');
    // Opening a row via its main button switches to the detail panel.
    fireEvent.click((document.querySelectorAll('.row-main')[1]) as HTMLButtonElement);
    expect((document.querySelector('.vault-grid') as HTMLElement).className).toContain('mobile-panel-detail');
    // The mobile back button is present and returns to the list.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_back')) }));
    expect((document.querySelector('.vault-grid') as HTMLElement).className).toContain('mobile-panel-list');
  });

  it('opens the create editor into the mobile edit panel and cancels back to the list', () => {
    mobileSetup({ sends: [] });
    fireEvent.click(screen.getByRole('button', { name: t('txt_add') }));
    expect((document.querySelector('.vault-grid') as HTMLElement).className).toContain('mobile-panel-edit');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_cancel')) }));
    expect((document.querySelector('.vault-grid') as HTMLElement).className).toContain('mobile-panel-list');
  });

  it('toggles the mobile sidebar sheet when the toggle key changes', () => {
    const { rerender, sends, onRefresh, onCreate, onUpdate, onDelete, onBulkDelete, onNotify } = mobileSetup();
    const commonProps = {
      sends,
      loading: false,
      onRefresh,
      onCreate,
      onUpdate,
      onDelete,
      onBulkDelete,
      uploadingSendFileName: '',
      sendUploadPercent: null,
      onNotify,
    };
    expect(document.querySelector('.mobile-sidebar-sheet.open')).toBeFalsy();
    rerender(<SendsPage {...commonProps} mobileSidebarToggleKey={1} />);
    expect(document.querySelector('.mobile-sidebar-sheet.open')).toBeTruthy();
    // Close via the sidebar close button.
    fireEvent.click(screen.getByRole('button', { name: t('txt_close') }));
    expect(document.querySelector('.mobile-sidebar-sheet.open')).toBeFalsy();
  });

  it('closes the mobile sidebar sheet when the backdrop mask is clicked', () => {
    const { rerender, sends, onRefresh, onCreate, onUpdate, onDelete, onBulkDelete, onNotify } = mobileSetup();
    rerender(
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
        onNotify={onNotify}
        mobileSidebarToggleKey={1}
      />
    );
    const mask = document.querySelector('.mobile-sidebar-mask.open') as HTMLElement;
    expect(mask).toBeTruthy();
    fireEvent.click(mask);
    expect(document.querySelector('.mobile-sidebar-mask.open')).toBeFalsy();
  });

  it('reacts to a matchMedia change leaving mobile layout', () => {
    mobileSetup();
    expect((document.querySelector('.vault-grid') as HTMLElement).className).toContain('mobile-panel-list');
    setMobileLayout(false);
    expect((document.querySelector('.vault-grid') as HTMLElement).className).not.toContain('mobile-panel-list');
  });

  it('shows the upload progress label while a send file is uploading', () => {
    mobileSetup({ uploadingSendFileName: 'big.zip', sendUploadPercent: 42 });
    fireEvent.click(screen.getByRole('button', { name: t('txt_add') }));
    expect(
      screen.getByText(t('txt_uploading_file_named_percent', { name: 'big.zip', percent: 42 }))
    ).toBeInTheDocument();
  });

  it('returns to the detail panel after saving an edit in mobile layout', async () => {
    const { onUpdate } = mobileSetup();
    // Open the detail for the first send, then edit + save.
    fireEvent.click((document.querySelectorAll('.row-main')[0]) as HTMLButtonElement);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_edit')) }));
    expect((document.querySelector('.vault-grid') as HTMLElement).className).toContain('mobile-panel-edit');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_save')) }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect((document.querySelector('.vault-grid') as HTMLElement).className).toContain('mobile-panel-detail');
  });

  it('returns to the list after deleting the selected send in mobile layout', async () => {
    const { onDelete } = mobileSetup();
    fireEvent.click((document.querySelectorAll('.row-main')[0]) as HTMLButtonElement);
    const deleteBtn = document.querySelector('.detail-delete-btn') as HTMLButtonElement;
    fireEvent.click(deleteBtn);
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect((document.querySelector('.vault-grid') as HTMLElement).className).toContain('mobile-panel-list');
  });

  it('returns from the mobile edit panel to the detail via the back button', () => {
    mobileSetup();
    fireEvent.click((document.querySelectorAll('.row-main')[0]) as HTMLButtonElement);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_edit')) }));
    expect((document.querySelector('.vault-grid') as HTMLElement).className).toContain('mobile-panel-edit');
    // The mobile back button cancels the edit and returns to detail.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_back')) }));
    expect((document.querySelector('.vault-grid') as HTMLElement).className).toContain('mobile-panel-detail');
  });
});
