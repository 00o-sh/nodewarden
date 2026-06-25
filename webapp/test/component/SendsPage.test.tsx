import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import SendsPage from '@/components/SendsPage';
import { t } from '@/lib/i18n';
import type { Send } from '@/lib/types';

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
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
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
});
