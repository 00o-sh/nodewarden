import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/preact';

// Mock the leaf children (each is already covered by its own test). The mocks
// surface just the orchestration we want to assert: the filtered cipher list,
// item selection, the search input wiring, and which detail/editor pane is shown.
vi.mock('@/components/vault/VaultSidebar', () => ({
  default: (props: any) => (
    <div data-testid="sidebar">
      <button type="button" onClick={() => props.onChangeFilter({ kind: 'favorite' })}>
        filter-favorites
      </button>
    </div>
  ),
}));

vi.mock('@/components/vault/VaultListPanel', () => ({
  default: (props: any) => (
    <div data-testid="list-panel">
      <input
        data-testid="search"
        value={props.searchInput}
        onInput={(e: any) => props.onSearchInput(e.currentTarget.value)}
      />
      <ul>
        {props.filteredCiphers.map((cipher: any) => (
          <li key={cipher.id}>
            <button
              type="button"
              data-testid={`select-${cipher.id}`}
              onClick={() => props.onSelectCipher(cipher.id)}
            >
              {props.listSubtitle ? `${cipher.decName} :: ${props.listSubtitle(cipher)}` : cipher.decName}
            </button>
          </li>
        ))}
      </ul>
    </div>
  ),
}));

vi.mock('@/components/vault/VaultDetailView', () => ({
  default: (props: any) => (
    <div data-testid="detail-view">
      <span data-testid="detail-name">{props.selectedCipher?.decName}</span>
      <span data-testid="detail-folder">{props.folderName(props.selectedCipher?.folderId)}</span>
      <button type="button" onClick={props.onStartEdit}>start-edit</button>
    </div>
  ),
}));

vi.mock('@/components/vault/VaultEditor', () => ({
  default: (props: any) => (
    <div data-testid="editor">
      <span data-testid="editor-mode">{props.isCreating ? 'create' : 'edit'}</span>
      <button type="button" onClick={props.onCancel}>editor-cancel</button>
    </div>
  ),
}));

vi.mock('@/components/vault/VaultDialogs', () => ({
  default: () => <div data-testid="dialogs" />,
}));

import VaultPage from '@/components/VaultPage';
import type { Cipher, Folder } from '@/lib/types';

function makeCipher(overrides: Partial<Cipher> = {}): Cipher {
  return {
    id: 'c1',
    type: 1,
    decName: 'GitHub',
    folderId: 'f1',
    revisionDate: '2024-01-02T00:00:00Z',
    creationDate: '2024-01-01T00:00:00Z',
    login: { decUsername: 'octocat', decPassword: 'pw', uris: [] },
    ...overrides,
  } as Cipher;
}

function setup(overrides: Partial<Parameters<typeof VaultPage>[0]> = {}) {
  const ciphers: Cipher[] = [
    makeCipher({ id: 'c1', decName: 'GitHub' }),
    makeCipher({ id: 'c2', decName: 'GitLab', login: { decUsername: 'tux', decPassword: 'pw', uris: [] } }),
  ];
  const folders: Folder[] = [{ id: 'f1', name: 'Work', decName: 'Work' }];
  const props: Parameters<typeof VaultPage>[0] = {
    ciphers,
    folders,
    loading: false,
    error: '',
    emailForReprompt: 'user@example.com',
    onRefresh: vi.fn().mockResolvedValue(undefined),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onArchive: vi.fn().mockResolvedValue(undefined),
    onUnarchive: vi.fn().mockResolvedValue(undefined),
    onRestore: vi.fn().mockResolvedValue(undefined),
    onBulkDelete: vi.fn().mockResolvedValue(undefined),
    onBulkPermanentDelete: vi.fn().mockResolvedValue(undefined),
    onBulkRestore: vi.fn().mockResolvedValue(undefined),
    onBulkArchive: vi.fn().mockResolvedValue(undefined),
    onBulkUnarchive: vi.fn().mockResolvedValue(undefined),
    onBulkMove: vi.fn().mockResolvedValue(undefined),
    onVerifyMasterPassword: vi.fn().mockResolvedValue(undefined),
    onNotify: vi.fn(),
    onCreateFolder: vi.fn().mockResolvedValue(undefined),
    onRenameFolder: vi.fn().mockResolvedValue(undefined),
    onDeleteFolder: vi.fn().mockResolvedValue(undefined),
    onBulkDeleteFolders: vi.fn().mockResolvedValue(undefined),
    onDownloadAttachment: vi.fn().mockResolvedValue(undefined),
    downloadingAttachmentKey: '',
    attachmentDownloadPercent: null,
    uploadingAttachmentName: '',
    attachmentUploadPercent: null,
    mobileSidebarToggleKey: 0,
    ...overrides,
  };
  const utils = render(<VaultPage {...props} />);
  return { ...utils, props };
}

describe('<VaultPage>', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the sidebar, list panel and dialogs containers', () => {
    setup();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('list-panel')).toBeInTheDocument();
    expect(screen.getByTestId('dialogs')).toBeInTheDocument();
  });

  it('passes the filtered ciphers into the list panel', () => {
    setup();
    expect(screen.getByTestId('select-c1')).toHaveTextContent('GitHub');
    expect(screen.getByTestId('select-c2')).toHaveTextContent('GitLab');
  });

  it('auto-selects the first cipher and shows it in the detail view', () => {
    setup();
    expect(screen.getByTestId('detail-view')).toBeInTheDocument();
    expect(screen.getByTestId('detail-name')).toHaveTextContent('GitHub');
    // folderName resolves the folder's decName
    expect(screen.getByTestId('detail-folder')).toHaveTextContent('Work');
  });

  it('selecting a different item shows that item in the detail view', () => {
    setup();
    fireEvent.click(screen.getByTestId('select-c2'));
    expect(screen.getByTestId('detail-name')).toHaveTextContent('GitLab');
  });

  it('builds the login list subtitle from the username', () => {
    setup();
    expect(screen.getByTestId('select-c1')).toHaveTextContent('GitHub :: octocat');
  });

  it('filters the list through the search input', () => {
    setup();
    const search = screen.getByTestId('search') as HTMLInputElement;
    fireEvent.input(search, { target: { value: 'gitlab' } });
    // The debounce timer resolves the query; advance real time.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(screen.queryByTestId('select-c1')).not.toBeInTheDocument();
        expect(screen.getByTestId('select-c2')).toBeInTheDocument();
        resolve();
      }, 150);
    });
  });

  it('shows the editor in edit mode when detail view requests an edit', () => {
    setup();
    fireEvent.click(screen.getByText('start-edit'));
    expect(screen.getByTestId('editor')).toBeInTheDocument();
    expect(screen.getByTestId('editor-mode')).toHaveTextContent('edit');
    // Detail view is replaced by the editor.
    expect(screen.queryByTestId('detail-view')).not.toBeInTheDocument();
  });

  it('returns to the detail view when the editor is cancelled', () => {
    setup();
    fireEvent.click(screen.getByText('start-edit'));
    fireEvent.click(screen.getByText('editor-cancel'));
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
    expect(screen.getByTestId('detail-view')).toBeInTheDocument();
  });

  it('shows the empty-state prompt when there are no ciphers', () => {
    setup({ ciphers: [] });
    expect(screen.getByText('Select an item')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-view')).not.toBeInTheDocument();
  });

  it('starts a create flow when the global add-item event fires', () => {
    setup({ ciphers: [] });
    act(() => {
      window.dispatchEvent(new Event('nodewarden:add-item'));
    });
    expect(screen.getByTestId('editor')).toBeInTheDocument();
    expect(screen.getByTestId('editor-mode')).toHaveTextContent('create');
  });
});
