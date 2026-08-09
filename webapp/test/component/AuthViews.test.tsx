import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import AuthViews from '@/components/AuthViews';
import { setCurrentNetworkStatus } from '@/lib/network-status';

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
    onRetrySessionRefresh: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  // The network-status module is a shared singleton; reset so an offline test
  // never leaks into a later one.
  setCurrentNetworkStatus('online');
});

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

  it('fires onSubmitPasskeyUnlock and onShowLockedPasswordHint from their buttons', () => {
    const onSubmitPasskeyUnlock = vi.fn();
    const onShowLockedPasswordHint = vi.fn();
    render(
      <AuthViews
        {...baseProps({ mode: 'locked', onSubmitPasskeyUnlock, onShowLockedPasswordHint })}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Unlock with passkey/i }));
    fireEvent.click(screen.getByRole('button', { name: /Show Password Hint/i }));
    expect(onSubmitPasskeyUnlock).toHaveBeenCalledTimes(1);
    expect(onShowLockedPasswordHint).toHaveBeenCalledTimes(1);
  });

  it('shows a loading notice and disables actions while unlockPreparing', () => {
    render(<AuthViews {...baseProps({ mode: 'locked', unlockPreparing: true })} />);
    expect(screen.getAllByText('Loading...').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /^Loading\.\.\.$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Show Password Hint/i })).toBeDisabled();
  });

  it('shows the "Unlocking…" label on the unlock button while unlock is pending', () => {
    render(<AuthViews {...baseProps({ mode: 'locked', pendingAction: 'unlock' })} />);
    expect(screen.getByRole('button', { name: /^Unlocking\.\.\.$/i })).toBeInTheDocument();
  });

  it('shows the passkey unlocking label while a passkey action is pending', () => {
    render(<AuthViews {...baseProps({ mode: 'locked', pendingAction: 'passkey' })} />);
    // Both unlock buttons read "Unlocking…" — the passkey one specifically.
    const buttons = screen.getAllByRole('button', { name: /Unlocking\.\.\./i });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the session-refresh error with a working retry button', () => {
    const onRetrySessionRefresh = vi.fn();
    render(
      <AuthViews
        {...baseProps({
          mode: 'locked',
          sessionRefreshError: 'Session expired',
          onRetrySessionRefresh,
        })}
      />
    );
    expect(screen.getByText('Session expired')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    expect(onRetrySessionRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('<AuthViews> shared branches', () => {
  it('toggles the master-password visibility via the eye button', () => {
    render(<AuthViews {...baseProps()} />);
    const pwInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    expect(pwInput).toBeInTheDocument();
    // The last button in the password wrapper is the eye toggle.
    const eyeBtn = pwInput.parentElement!.querySelector('button.eye-btn') as HTMLButtonElement;
    fireEvent.click(eyeBtn);
    expect(pwInput.getAttribute('type')).toBe('text');
    fireEvent.click(eyeBtn);
    expect(pwInput.getAttribute('type')).toBe('password');
  });

  it('renders the offline-mode notice when the network is offline', () => {
    setCurrentNetworkStatus('offline');
    render(<AuthViews {...baseProps()} />);
    expect(screen.getByRole('alert')).toHaveClass('offline-mode-notice');
  });

  it('uses a text input for email when relaxedLoginInput is set', () => {
    render(<AuthViews {...baseProps({ relaxedLoginInput: true })} />);
    const email = screen.getByRole('textbox') as HTMLInputElement;
    expect(email.getAttribute('type')).toBe('text');
  });

  it('shows the password-hint loading label while loginHintLoading', () => {
    render(<AuthViews {...baseProps({ loginHintLoading: true, loginValues: { email: 'x@y.com', password: '' } })} />);
    expect(screen.getByRole('button', { name: /Loading hint/i })).toBeInTheDocument();
  });

  it('fires onChangeLogin when typing into the password field', () => {
    const onChangeLogin = vi.fn();
    render(<AuthViews {...baseProps({ onChangeLogin })} />);
    const pwInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(pwInput, { target: { value: 'pw' } });
    expect(onChangeLogin).toHaveBeenCalledWith({ email: '', password: 'pw' });
  });

  it('shows the busy labels on login while a login action is pending', () => {
    render(<AuthViews {...baseProps({ pendingAction: 'login' })} />);
    expect(screen.getByRole('button', { name: /Logging In/i })).toBeInTheDocument();
  });

  it('shows the passkey busy label on login while a passkey action is pending', () => {
    render(<AuthViews {...baseProps({ pendingAction: 'passkey' })} />);
    // The passkey button switches to the logging-in label.
    const buttons = screen.getAllByRole('button', { name: /Logging In/i });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('shows the registering label while a register action is pending', () => {
    render(<AuthViews {...baseProps({ mode: 'register', pendingAction: 'register' })} />);
    expect(screen.getByRole('button', { name: /Creating account/i })).toBeInTheDocument();
  });

  it('keeps the invite-code field visible when an invite code is present even if not required', () => {
    render(
      <AuthViews
        {...baseProps({
          mode: 'register',
          registrationInviteRequired: false,
          registerValues: {
            name: '', email: '', password: '', password2: '', passwordHint: '', inviteCode: 'ABC',
          },
        })}
      />
    );
    expect(screen.getByText('Invite Code (Required)')).toBeInTheDocument();
  });

  it('fires onChangeRegister for every register field', () => {
    const onChangeRegister = vi.fn();
    render(<AuthViews {...baseProps({ mode: 'register', onChangeRegister })} />);
    const textboxes = screen.getAllByRole('textbox');
    // name, email, password-hint, invite-code are textboxes; passwords are separate.
    fireEvent.input(textboxes[1], { target: { value: 'e@x.com' } });
    expect(onChangeRegister).toHaveBeenCalledWith(expect.objectContaining({ email: 'e@x.com' }));
    const passwords = Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
    fireEvent.input(passwords[0], { target: { value: 'pw1' } });
    expect(onChangeRegister).toHaveBeenCalledWith(expect.objectContaining({ password: 'pw1' }));
    fireEvent.input(passwords[1], { target: { value: 'pw2' } });
    expect(onChangeRegister).toHaveBeenCalledWith(expect.objectContaining({ password2: 'pw2' }));
    // password hint is the 3rd textbox, invite code the 4th.
    fireEvent.input(textboxes[2], { target: { value: 'hint' } });
    expect(onChangeRegister).toHaveBeenCalledWith(expect.objectContaining({ passwordHint: 'hint' }));
    fireEvent.input(textboxes[3], { target: { value: 'INV' } });
    expect(onChangeRegister).toHaveBeenCalledWith(expect.objectContaining({ inviteCode: 'INV' }));
  });

  it('fires onChangePasskeyPassword in the passkey-password branch and returns to login', () => {
    const onChangePasskeyPassword = vi.fn();
    const onGotoLogin = vi.fn();
    render(
      <AuthViews
        {...baseProps({
          pendingPasskeyPasswordEmail: 'pk@example.com',
          onChangePasskeyPassword,
          onGotoLogin,
        })}
      />
    );
    const pwInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(pwInput, { target: { value: 'x' } });
    expect(onChangePasskeyPassword).toHaveBeenCalledWith('x');
    fireEvent.click(screen.getByRole('button', { name: /Back To Login/i }));
    expect(onGotoLogin).toHaveBeenCalledTimes(1);
  });

  it('shows the unlocking label in the passkey-password branch while login is pending', () => {
    render(
      <AuthViews
        {...baseProps({ pendingPasskeyPasswordEmail: 'pk@example.com', pendingAction: 'login' })}
      />
    );
    expect(screen.getByRole('button', { name: /^Unlocking\.\.\.$/i })).toBeInTheDocument();
  });
});
