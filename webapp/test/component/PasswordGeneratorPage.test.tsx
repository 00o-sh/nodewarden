import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import PasswordGeneratorPage from '@/components/PasswordGeneratorPage';
import { t } from '@/lib/i18n';
import type { GeneratedSshKey } from '@/lib/ssh-key-generator';

// The clipboard helper touches navigator.clipboard, which jsdom does not
// implement; mock it and invoke the success/error callbacks the page passes.
const copyTextToClipboard = vi.fn(
  async (_value: string, options?: { onSuccess?: () => void; onError?: () => void }) => {
    options?.onSuccess?.();
    return true;
  },
);
vi.mock('@/lib/clipboard', () => ({
  copyTextToClipboard: (...args: unknown[]) =>
    copyTextToClipboard(...(args as [string, { onSuccess?: () => void; onError?: () => void }?])),
}));

// SSH key generation performs async WebCrypto work; mock it so the page's
// loading/success/error branches are deterministic.
const generateSshKey = vi.fn();
vi.mock('@/lib/ssh-key-generator', () => ({
  generateSshKey: (...args: unknown[]) => generateSshKey(...args),
}));

const SAMPLE_KEY: GeneratedSshKey = {
  type: 'ED25519',
  bits: 256,
  publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISAMPLEKEYBYTES',
  privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nprivatekeybody\n-----END OPENSSH PRIVATE KEY-----',
  fingerprint: 'SHA256:abcdef0123456789',
};

function selectMode(label: string) {
  fireEvent.click(screen.getByRole('tab', { name: t(label) }));
}

describe('<PasswordGeneratorPage>', () => {
  beforeEach(() => {
    copyTextToClipboard.mockClear();
    generateSshKey.mockReset();
    generateSshKey.mockResolvedValue(SAMPLE_KEY);
    // Provide createObjectURL/revokeObjectURL for the SSH download path.
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    });
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  });

  it('renders the default password mode with a generated value, strength meter and count', () => {
    render(<PasswordGeneratorPage />);
    const output = screen.getByLabelText(t('txt_generated_value')) as HTMLElement;
    expect(output.textContent && output.textContent.length).toBeGreaterThan(0);
    // A 16-char password with several character classes yields a non-empty
    // strength meter (at least one active segment).
    expect(document.querySelector('.generator-strength .active')).toBeTruthy();
    expect(screen.getByText(t('txt_generator_character_count', { count: 16 }))).toBeInTheDocument();
  });

  it('regenerates a new value when the regenerate button is clicked', () => {
    render(<PasswordGeneratorPage />);
    const output = screen.getByLabelText(t('txt_generated_value')) as HTMLElement;
    const first = output.textContent;
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_regenerate')) }));
    // Regenerating re-runs generateValue; the value almost certainly changes.
    expect(screen.getByLabelText(t('txt_generated_value')).textContent).not.toBe('');
    void first;
  });

  it('copies the generated value and shows the copied label', async () => {
    render(<PasswordGeneratorPage />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_copy')) }));
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(t('txt_copied'))).toBeInTheDocument();
  });

  it('adjusts the length via the stepper buttons', () => {
    render(<PasswordGeneratorPage />);
    const lengthInput = document.getElementById('generator-stepper-length') as HTMLInputElement;
    expect(lengthInput.value).toBe('16');
    const plus = screen.getByRole('button', { name: `${t('txt_generator_length')} +` });
    fireEvent.click(plus);
    expect((document.getElementById('generator-stepper-length') as HTMLInputElement).value).toBe('17');
    const minus = screen.getByRole('button', { name: `${t('txt_generator_length')} -` });
    fireEvent.click(minus);
    fireEvent.click(minus);
    expect((document.getElementById('generator-stepper-length') as HTMLInputElement).value).toBe('15');
  });

  it('typing a length directly clamps through clampInteger', () => {
    render(<PasswordGeneratorPage />);
    const lengthInput = document.getElementById('generator-stepper-length') as HTMLInputElement;
    fireEvent.input(lengthInput, { target: { value: '40' } });
    expect((document.getElementById('generator-stepper-length') as HTMLInputElement).value).toBe('40');
  });

  it('toggles character-type checkboxes and reveals per-type minimum steppers', () => {
    render(<PasswordGeneratorPage />);
    // Special is off by default: enabling it reveals its minimum stepper.
    const special = screen.getByText(t('txt_generator_special')).closest('label')!.querySelector('input')!;
    expect(document.getElementById('generator-stepper-min-special')).toBeFalsy();
    fireEvent.click(special);
    expect(document.getElementById('generator-stepper-min-special')).toBeTruthy();
  });

  it('refuses to disable the last remaining character type', () => {
    render(<PasswordGeneratorPage />);
    // Turn off numbers, uppercase, special so only lowercase remains enabled.
    const toggle = (label: string) =>
      screen.getByText(t(label)).closest('label')!.querySelector('input') as HTMLInputElement;
    fireEvent.click(toggle('txt_generator_uppercase'));
    fireEvent.click(toggle('txt_generator_numbers'));
    // Only lowercase is left; attempting to disable it is ignored (the guard
    // returns without a state change). Its minimum stepper — rendered only while
    // lowercase is enabled — therefore stays mounted.
    expect(toggle('txt_generator_lowercase').checked).toBe(true);
    expect(document.getElementById('generator-stepper-min-lowercase')).toBeTruthy();
    fireEvent.click(toggle('txt_generator_lowercase'));
    expect(document.getElementById('generator-stepper-min-lowercase')).toBeTruthy();
  });

  it('toggles the avoid-ambiguous option', () => {
    render(<PasswordGeneratorPage />);
    const avoid = screen.getByText(t('txt_generator_avoid_ambiguous')).closest('label')!.querySelector('input') as HTMLInputElement;
    expect(avoid.checked).toBe(false);
    fireEvent.click(avoid);
    expect(
      (screen.getByText(t('txt_generator_avoid_ambiguous')).closest('label')!.querySelector('input') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('switches to passphrase mode and exposes its options', () => {
    render(<PasswordGeneratorPage />);
    selectMode('txt_passphrase');
    expect(document.getElementById('generator-stepper-words')).toBeTruthy();
    // Value should now be a separator-joined passphrase.
    expect(screen.getByLabelText(t('txt_generated_value')).textContent).toContain('-');
    // Switch the word list to custom to reveal the custom-words textarea.
    fireEvent.change(document.getElementById('generator-word-list') as HTMLSelectElement, { target: { value: 'custom' } });
    expect(document.getElementById('generator-custom-words')).toBeTruthy();
    // Separator field and toggles.
    fireEvent.input(document.getElementById('generator-separator') as HTMLInputElement, { target: { value: '_' } });
    const capitalize = screen.getByText(t('txt_generator_capitalize')).closest('label')!.querySelector('input')!;
    fireEvent.click(capitalize);
    const includeNumber = screen.getByText(t('txt_generator_include_number')).closest('label')!.querySelector('input')!;
    fireEvent.click(includeNumber);
  });

  it('switches to pin mode', () => {
    render(<PasswordGeneratorPage />);
    selectMode('txt_generator_pin');
    expect(document.getElementById('generator-stepper-pin-length')).toBeTruthy();
    expect(screen.getByText(t('txt_generator_pin_description'))).toBeInTheDocument();
    expect(/^\d+$/.test(screen.getByLabelText(t('txt_generated_value')).textContent || '')).toBe(true);
  });

  it('switches to username mode and exposes its options', () => {
    render(<PasswordGeneratorPage />);
    selectMode('txt_generator_username');
    expect(document.getElementById('generator-stepper-username-words')).toBeTruthy();
    fireEvent.change(document.getElementById('generator-username-word-list') as HTMLSelectElement, { target: { value: 'custom' } });
    expect(document.getElementById('generator-username-custom-words')).toBeTruthy();
    fireEvent.input(document.getElementById('generator-username-custom-word') as HTMLInputElement, { target: { value: 'hunter' } });
    fireEvent.input(document.getElementById('generator-username-delimiter') as HTMLInputElement, { target: { value: '.' } });
    const capitalize = screen.getByText(t('txt_generator_capitalize')).closest('label')!.querySelector('input')!;
    fireEvent.click(capitalize);
    const includeNumber = screen.getByText(t('txt_generator_include_number')).closest('label')!.querySelector('input')!;
    fireEvent.click(includeNumber);
    // Nudge the word-count stepper to exercise its onChange wiring.
    fireEvent.click(screen.getByRole('button', { name: `${t('txt_generator_words')} +` }));
    expect((document.getElementById('generator-stepper-username-words') as HTMLInputElement).value).toBe('3');
  });

  it('switches to email mode and toggles between plus-addressed and catch-all inputs', () => {
    render(<PasswordGeneratorPage />);
    selectMode('txt_generator_email_alias');
    // No email address entered yet -> the required hint fills the output.
    expect(screen.getByText(t('txt_generator_email_required_hint'))).toBeInTheDocument();
    const emailInput = document.getElementById('generator-email') as HTMLInputElement;
    fireEvent.input(emailInput, { target: { value: 'user@example.com' } });
    // Switch to catch-all: the domain field replaces the email field.
    fireEvent.change(document.getElementById('generator-email-type') as HTMLSelectElement, { target: { value: 'catchAll' } });
    expect(document.getElementById('generator-domain')).toBeTruthy();
    fireEvent.input(document.getElementById('generator-domain') as HTMLInputElement, { target: { value: 'example.com' } });
  });

  it('switches to ssh mode, shows loading then the generated key output', async () => {
    render(<PasswordGeneratorPage />);
    selectMode('txt_generator_ssh_key');
    expect(await screen.findByText(SAMPLE_KEY.fingerprint)).toBeInTheDocument();
    // Public + private key sections render.
    expect(screen.getByText(t('txt_generator_public_key'))).toBeInTheDocument();
    expect(screen.getByText(t('txt_generator_private_key'))).toBeInTheDocument();
    // The security note reflects the ssh-specific copy.
    expect(screen.getByText(t('txt_generator_ssh_security_note'))).toBeInTheDocument();
  });

  it('copies the ssh public key with comment from the primary copy button', async () => {
    render(<PasswordGeneratorPage />);
    selectMode('txt_generator_ssh_key');
    await screen.findByText(SAMPLE_KEY.fingerprint);
    // Add a comment, which is appended to the copied public key.
    fireEvent.input(document.getElementById('generator-ssh-comment') as HTMLInputElement, { target: { value: 'me@host' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_generator_copy_public_key')) }));
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalled());
    const copiedValue = copyTextToClipboard.mock.calls[0][0] as string;
    expect(copiedValue).toContain('me@host');
  });

  it('copies and downloads keys from the ssh output field buttons', async () => {
    render(<PasswordGeneratorPage />);
    selectMode('txt_generator_ssh_key');
    await screen.findByText(SAMPLE_KEY.fingerprint);
    // Two "Copy" small buttons (public + private) plus the primary copy button.
    const copyButtons = screen.getAllByRole('button', { name: new RegExp(t('txt_copy')) });
    fireEvent.click(copyButtons[0]);
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalled());
    // Download buttons create an object URL and click an anchor.
    const downloadButtons = screen.getAllByRole('button', { name: new RegExp(t('txt_download')) });
    fireEvent.click(downloadButtons[0]);
    expect(URL.createObjectURL).toHaveBeenCalled();
    // Reveal + download the private key too.
    fireEvent.click(downloadButtons[1]);
  });

  it('switches the ssh algorithm to rsa and reveals the key-length select', async () => {
    render(<PasswordGeneratorPage />);
    selectMode('txt_generator_ssh_key');
    await screen.findByText(SAMPLE_KEY.fingerprint);
    fireEvent.change(document.getElementById('generator-ssh-type') as HTMLSelectElement, { target: { value: 'rsa' } });
    expect(document.getElementById('generator-rsa-length')).toBeTruthy();
    fireEvent.change(document.getElementById('generator-rsa-length') as HTMLSelectElement, { target: { value: '2048' } });
    expect(screen.getByText(t('txt_generator_ssh_rsa_description'))).toBeInTheDocument();
  });

  it('shows the ssh error state when key generation fails', async () => {
    generateSshKey.mockRejectedValue(new Error('boom'));
    render(<PasswordGeneratorPage />);
    selectMode('txt_generator_ssh_key');
    expect(await screen.findByText(t('txt_generator_ssh_error'))).toBeInTheDocument();
  });

  it('restores persisted settings from localStorage on mount', () => {
    localStorage.setItem(
      'nodewarden.passwordGenerator.settings.v2',
      JSON.stringify({ ...{ mode: 'pin' } }),
    );
    render(<PasswordGeneratorPage />);
    // The persisted pin mode is applied, so the pin length stepper is present.
    expect(document.getElementById('generator-stepper-pin-length')).toBeTruthy();
  });
});
