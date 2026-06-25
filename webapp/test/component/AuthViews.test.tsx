import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import AuthViews from '@/components/AuthViews';

type Props = Parameters<typeof AuthViews>[0];

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    mode: 'login',
    pendingAction: null,
    unlockReady: true,
    unlockPreparing: false,
    loginValues: { email: '', password: '' },
    passkeyPassword: '',
    registerValues: {
      name: '',
      email: '',
      password: '',
      password2: '',
      passwordHint: '',
      inviteCode: '',
    },
    unlockPassword: '',
    emailForLock: 'lock@example.com',
    loginHintLoading: false,
    onChangeLogin: vi.fn(),
    onChangePasskeyPassword: vi.fn(),
    onChangeRegister: vi.fn(),
    onChangeUnlock: vi.fn(),
    onSubmitLogin: vi.fn(),
    onSubmitPasskey: vi.fn(),
    onSubmitPasskeyUnlock: vi.fn(),
    onSubmitPasskeyPassword: vi.fn(),
    onSubmitRegister: vi.fn(),
    onSubmitUnlock: vi.fn(),
    onGotoLogin: vi.fn(),
    onGotoRegister: vi.fn(),
    onLogout: vi.fn(),
    onTogglePasswordHint: vi.fn(),
    onShowLockedPasswordHint: vi.fn(),
    ...overrides,
  };
}

describe('<AuthViews> login mode', () => {
  it('renders the login form with email + passkey + register actions', () => {
    render(<AuthViews {...baseProps()} />);
    expect(screen.getByRole('button', { name: /^Log In$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log in with passkey/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Account/i })).toBeInTheDocument();
  });

  it('fires onChangeLogin with the new email when typing into the email field', () => {
    const onChangeLogin = vi.fn();
    render(<AuthViews {...baseProps({ onChangeLogin })} />);
    const email = screen.getByRole('textbox');
    fireEvent.input(email, { target: { value: 'a@b.com' } });
    expect(onChangeLogin).toHaveBeenCalledWith({ email: 'a@b.com', password: '' });
  });

  it('fires onSubmitLogin when the form is submitted', () => {
    const onSubmitLogin = vi.fn();
    render(<AuthViews {...baseProps({ onSubmitLogin })} />);
    fireEvent.click(screen.getByRole('button', { name: /^Log In$/i }));
    expect(onSubmitLogin).toHaveBeenCalledTimes(1);
  });

  it('fires onSubmitPasskey and onGotoRegister from their buttons', () => {
    const onSubmitPasskey = vi.fn();
    const onGotoRegister = vi.fn();
    render(<AuthViews {...baseProps({ onSubmitPasskey, onGotoRegister })} />);
    fireEvent.click(screen.getByRole('button', { name: /Log in with passkey/i }));
    fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));
    expect(onSubmitPasskey).toHaveBeenCalledTimes(1);
    expect(onGotoRegister).toHaveBeenCalledTimes(1);
  });

  it('disables the password-hint button when email is empty and enables it when present', () => {
    const { rerender } = render(<AuthViews {...baseProps()} />);
    expect(screen.getByRole('button', { name: /Show Password Hint/i })).toBeDisabled();
    rerender(<AuthViews {...baseProps({ loginValues: { email: 'x@y.com', password: '' } })} />);
    expect(screen.getByRole('button', { name: /Show Password Hint/i })).not.toBeDisabled();
  });

  it('renders the passkey-password branch and submits it when pending', () => {
    const onSubmitPasskeyPassword = vi.fn();
    render(
      <AuthViews
        {...baseProps({
          pendingPasskeyPasswordEmail: 'pk@example.com',
          onSubmitPasskeyPassword,
        })}
      />
    );
    expect(screen.getByText('pk@example.com')).toBeInTheDocument();
    // The primary submit button now reads "Unlock" in this branch.
    fireEvent.click(screen.getByRole('button', { name: /^Unlock$/i }));
    expect(onSubmitPasskeyPassword).toHaveBeenCalledTimes(1);
  });
});

describe('<AuthViews> register mode', () => {
  it('renders the create-account form fields', () => {
    render(<AuthViews {...baseProps({ mode: 'register' })} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Confirm Master Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Account/i })).toBeInTheDocument();
  });

  it('shows the invite-code field by default and hides it when not required', () => {
    const { rerender } = render(<AuthViews {...baseProps({ mode: 'register' })} />);
    expect(screen.getByText('Invite Code (Required)')).toBeInTheDocument();
    rerender(
      <AuthViews
        {...baseProps({ mode: 'register', registrationInviteRequired: false })}
      />
    );
    expect(screen.queryByText('Invite Code (Required)')).not.toBeInTheDocument();
  });

  it('fires onChangeRegister when typing the name', () => {
    const onChangeRegister = vi.fn();
    render(<AuthViews {...baseProps({ mode: 'register', onChangeRegister })} />);
    const nameInput = screen.getAllByRole('textbox')[0];
    fireEvent.input(nameInput, { target: { value: 'Alice' } });
    expect(onChangeRegister).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alice' }));
  });

  it('fires onSubmitRegister on submit and onGotoLogin from the back button', () => {
    const onSubmitRegister = vi.fn();
    const onGotoLogin = vi.fn();
    render(
      <AuthViews {...baseProps({ mode: 'register', onSubmitRegister, onGotoLogin })} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));
    fireEvent.click(screen.getByRole('button', { name: /Back To Login/i }));
    expect(onSubmitRegister).toHaveBeenCalledTimes(1);
    expect(onGotoLogin).toHaveBeenCalledTimes(1);
  });
});

describe('<AuthViews> locked mode', () => {
  it('renders the unlock vault view with the locked email', () => {
    render(<AuthViews {...baseProps({ mode: 'locked' })} />);
    expect(screen.getByText('lock@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Unlock$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Unlock with passkey/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log Out/i })).toBeInTheDocument();
  });

  it('fires onSubmitUnlock on submit and onLogout from the log-out button', () => {
    const onSubmitUnlock = vi.fn();
    const onLogout = vi.fn();
    render(<AuthViews {...baseProps({ mode: 'locked', onSubmitUnlock, onLogout })} />);
    fireEvent.click(screen.getByRole('button', { name: /^Unlock$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Log Out/i }));
    expect(onSubmitUnlock).toHaveBeenCalledTimes(1);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('disables unlock buttons when unlockReady is false', () => {
    render(<AuthViews {...baseProps({ mode: 'locked', unlockReady: false })} />);
    expect(screen.getByRole('button', { name: /^Unlock$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Unlock with passkey/i })).toBeDisabled();
  });

  it('fires onChangeUnlock when typing the master password', () => {
    const onChangeUnlock = vi.fn();
    render(<AuthViews {...baseProps({ mode: 'locked', onChangeUnlock })} />);
    const pwInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(pwInput, { target: { value: 'secret' } });
    expect(onChangeUnlock).toHaveBeenCalledWith('secret');
  });
});
