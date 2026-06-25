import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import PublicSendPage from '@/components/PublicSendPage';
import { t } from '@/lib/i18n';

// Mock the network/crypto layer so we can drive each render branch
// deterministically. The component flow is:
//   accessPublicSend() -> decryptPublicSend() -> parsePublicSendData()
// so decryptPublicSend just needs to return an object that parses cleanly.
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

// A base64url key that decodes to >= 16 bytes so hasUsableSendKey() passes.
const VALID_KEY = 'AAAAAAAAAAAAAAAAAAAAAA'; // 16 zero bytes

function apiError(message: string, status: number): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe('<PublicSendPage>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the text-send display branch', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue({
      id: 'send-1',
      type: 0,
      decName: 'A Text Send',
      decText: 'secret contents',
    });

    render(<PublicSendPage accessId="acc-1" keyPart={VALID_KEY} />);

    expect(await screen.findByText(t('txt_text_send'))).toBeInTheDocument();
    expect(screen.getByText('secret contents')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(t('txt_copy')) })).toBeInTheDocument();
  });

  it('renders the file-send display branch with a download button', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue({
      id: 'send-2',
      type: 1,
      decName: 'A File Send',
      decFileName: 'report.pdf',
      file: { id: 'file-1', fileName: 'report.enc', sizeName: '12 KB' },
    });

    render(<PublicSendPage accessId="acc-2" keyPart={VALID_KEY} />);

    expect(await screen.findByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(t('txt_download')) })).toBeInTheDocument();
  });

  it('renders the password-prompt branch on a 401 and re-requests with the password', async () => {
    accessPublicSend.mockRejectedValueOnce(apiError('unauthorized', 401));

    render(<PublicSendPage accessId="acc-3" keyPart={VALID_KEY} />);

    expect(await screen.findByText(t('txt_this_send_is_password_protected'))).toBeInTheDocument();
    const unlockBtn = screen.getByRole('button', { name: new RegExp(t('txt_unlock_send')) });
    expect(unlockBtn).toBeInTheDocument();

    // Second attempt succeeds once a password is supplied.
    accessPublicSend.mockResolvedValueOnce({ raw: true });
    decryptPublicSend.mockResolvedValueOnce({
      id: 'send-3',
      type: 0,
      decName: 'Protected',
      decText: 'unlocked text',
    });

    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(passwordInput, { target: { value: 'hunter2' } });
    fireEvent.click(unlockBtn);

    expect(await screen.findByText('unlocked text')).toBeInTheDocument();
    // Second call passed the typed password as the 3rd positional arg.
    const lastCall = accessPublicSend.mock.calls[accessPublicSend.mock.calls.length - 1];
    expect(lastCall[2]).toBe('hunter2');
  });

  it('renders the error branch on a generic failure', async () => {
    accessPublicSend.mockRejectedValue(apiError('something exploded', 500));

    render(<PublicSendPage accessId="acc-4" keyPart={VALID_KEY} />);

    expect(await screen.findByText('something exploded')).toBeInTheDocument();
  });

  it('renders the not-found page on a 404', async () => {
    accessPublicSend.mockRejectedValue(apiError('missing', 404));

    render(<PublicSendPage accessId="acc-5" keyPart={VALID_KEY} />);

    expect(await screen.findByText(t('txt_page_not_found'))).toBeInTheDocument();
  });

  it('renders the not-found page when the link key is missing/unusable', async () => {
    render(<PublicSendPage accessId="acc-6" keyPart={null} />);

    expect(await screen.findByText(t('txt_page_not_found'))).toBeInTheDocument();
    expect(accessPublicSend).not.toHaveBeenCalled();
  });
});
