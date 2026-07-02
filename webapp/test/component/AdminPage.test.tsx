import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import AdminPage from '@/components/AdminPage';
import type { AdminInvite, AdminUser } from '@/lib/types';

const USERS: AdminUser[] = [
  { id: 'me', email: 'admin@example.com', name: 'The Admin', role: 'admin', status: 'active' },
  { id: 'u2', email: 'active@example.com', name: 'Active User', role: 'user', status: 'active' },
  { id: 'u3', email: 'banned@example.com', name: '', role: 'user', status: 'banned' },
];

const INVITES: AdminInvite[] = [
  { code: 'CODE-ACTIVE', status: 'active', expiresAt: '2030-01-01T00:00:00.000Z', inviteLink: 'https://x/invite/CODE-ACTIVE' },
  { code: 'CODE-INACTIVE', status: 'inactive', expiresAt: '2020-01-01T00:00:00.000Z', inviteLink: 'https://x/invite/CODE-INACTIVE' },
];

function setup(overrides: Partial<Parameters<typeof AdminPage>[0]> = {}) {
  const handlers = {
    onRefresh: vi.fn(),
    onCreateInvite: vi.fn().mockResolvedValue(undefined),
    onDeleteAllInvites: vi.fn().mockResolvedValue(undefined),
    onToggleUserStatus: vi.fn().mockResolvedValue(undefined),
    onDeleteUser: vi.fn().mockResolvedValue(undefined),
    onDeleteInvite: vi.fn().mockResolvedValue(undefined),
    onDeleteInvalidInvites: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <AdminPage
      currentUserId="me"
      users={USERS}
      invites={INVITES}
      loading={false}
      error=""
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

describe('<AdminPage>', () => {
  it('renders the users table with rows for each user', () => {
    setup();
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByText('active@example.com')).toBeInTheDocument();
    expect(screen.getByText('banned@example.com')).toBeInTheDocument();
    // role / status translated
    expect(screen.getByText('The Admin')).toBeInTheDocument();
  });

  it('renders the invites table with codes and statuses', () => {
    setup();
    expect(screen.getByText('CODE-ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('CODE-INACTIVE')).toBeInTheDocument();
  });

  it('fires onCreateInvite with the hours value when create button is clicked', () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole('button', { name: /Create Timed Invite/i }));
    expect(handlers.onCreateInvite).toHaveBeenCalledTimes(1);
    expect(handlers.onCreateInvite).toHaveBeenCalledWith(168);
  });

  it('passes an updated hours value to onCreateInvite', () => {
    const handlers = setup();
    const hoursInput = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.input(hoursInput, { target: { value: '72' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Timed Invite/i }));
    expect(handlers.onCreateInvite).toHaveBeenCalledWith(72);
  });

  it('fires onDeleteAllInvites when the delete-all button is clicked', () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole('button', { name: /Delete All/i }));
    expect(handlers.onDeleteAllInvites).toHaveBeenCalledTimes(1);
  });

  it('fires onDeleteInvite with the code of the clicked invite row', () => {
    const handlers = setup();
    // Each invite row exposes a per-row Delete button (exact name, so it does
    // not match the "Delete All" / "Delete Invalid" header actions).
    const row = screen.getByText('CODE-ACTIVE').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(handlers.onDeleteInvite).toHaveBeenCalledWith('CODE-ACTIVE');
  });

  it('fires onDeleteInvalidInvites when the delete-invalid button is clicked', () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole('button', { name: /Delete Invalid/i }));
    expect(handlers.onDeleteInvalidInvites).toHaveBeenCalledTimes(1);
  });

  it('fires onToggleUserStatus with the toggleable status for a non-current user', () => {
    const handlers = setup();
    const row = screen.getByText('active@example.com').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /Ban/i }));
    expect(handlers.onToggleUserStatus).toHaveBeenCalledWith('u2', 'active');
  });

  it('disables the status toggle for the current user', () => {
    setup();
    const row = screen.getByText('admin@example.com').closest('tr')!;
    expect(within(row).getByRole('button', { name: /Ban/i })).toBeDisabled();
  });

  it('shows an unban action for banned users and fires onToggleUserStatus', () => {
    const handlers = setup();
    const row = screen.getByText('banned@example.com').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /Unban/i }));
    expect(handlers.onToggleUserStatus).toHaveBeenCalledWith('u3', 'banned');
  });

  it('fires onDeleteUser for non-admin users and hides delete for admins', () => {
    const handlers = setup();
    const adminRow = screen.getByText('admin@example.com').closest('tr')!;
    expect(within(adminRow).queryByRole('button', { name: /^Delete$/i })).not.toBeInTheDocument();

    const userRow = screen.getByText('active@example.com').closest('tr')!;
    fireEvent.click(within(userRow).getByRole('button', { name: /^Delete$/i }));
    expect(handlers.onDeleteUser).toHaveBeenCalledWith('u2');
  });

  it('fires onRefresh from the error banner refresh button', () => {
    const handlers = setup({ error: 'Boom happened' });
    expect(screen.getByText('Boom happened')).toBeInTheDocument();
    // multiple refresh buttons exist; click the first (error banner)
    const refreshButtons = screen.getAllByRole('button', { name: /Refresh/i });
    fireEvent.click(refreshButtons[0]);
    expect(handlers.onRefresh).toHaveBeenCalled();
  });

  it('renders empty states when there are no users or invites', () => {
    setup({ users: [], invites: [] });
    expect(screen.getByText('No users found.')).toBeInTheDocument();
    expect(screen.getByText('No invites found.')).toBeInTheDocument();
  });
});
