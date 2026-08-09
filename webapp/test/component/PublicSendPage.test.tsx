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

// The file-download flow reads bytes off a Response and hands them to a helper
// that triggers the browser download. Mock the whole download surface so the
// component's decrypt/legacy-fallback branches can be driven deterministically.
const downloadBytesAsFile = vi.fn();
const readResponseBytesWithProgress = vi.fn();
vi.mock('@/lib/download', () => ({
  downloadBytesAsFile: (...args: unknown[]) => downloadBytesAsFile(...args),
  readResponseBytesWithProgress: (...args: unknown[]) => readResponseBytesWithProgress(...args),
}));

const copyTextToClipboard = vi.fn();
vi.mock('@/lib/clipboard', () => ({
  copyTextToClipboard: (...args: unknown[]) => copyTextToClipboard(...args),
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

  it('falls back to txt_no_name in the title and disables copy when the text body is empty', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue({ id: 'send-empty', type: 0, decText: '' });

    render(<PublicSendPage accessId="acc-empty" keyPart={VALID_KEY} />);

    expect(await screen.findByText(t('txt_text_send'))).toBeInTheDocument();
    // No decName -> title falls back to txt_no_name.
    expect(screen.getAllByText(t('txt_no_name')).length).toBeGreaterThan(0);
    // Empty body -> the copy button is disabled, and clicking it copies the
    // empty-string fallback rather than the (absent) body.
    const copyBtn = screen.getByRole('button', { name: new RegExp(t('txt_copy')) });
    expect(copyBtn).toBeDisabled();
    fireEvent.click(copyBtn);
    expect(copyTextToClipboard).toHaveBeenCalledWith('');
  });

  it('copies the decrypted text body when the copy button is clicked', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue({ id: 'send-copy', type: 0, decName: 'Copyable', decText: 'copy me' });

    render(<PublicSendPage accessId="acc-copy" keyPart={VALID_KEY} />);

    const copyBtn = await screen.findByRole('button', { name: new RegExp(t('txt_copy')) });
    fireEvent.click(copyBtn);
    expect(copyTextToClipboard).toHaveBeenCalledWith('copy me');
  });

  it('renders the expiration line with a formatted date', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue({
      id: 'send-exp',
      type: 0,
      decName: 'Expiring',
      decText: 'x',
      expirationDate: '2030-01-02T03:04:05.000Z',
    });

    render(<PublicSendPage accessId="acc-exp" keyPart={VALID_KEY} />);

    expect(await screen.findByText(t('txt_text_send'))).toBeInTheDocument();
    const formatted = new Date('2030-01-02T03:04:05.000Z').toLocaleString();
    expect(
      screen.getByText(t('txt_expires_at_value', { value: formatted })),
    ).toBeInTheDocument();
  });

  it('ignores an unparseable expiration date (no expires line)', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue({
      id: 'send-badexp',
      type: 0,
      decName: 'BadExp',
      decText: 'x',
      expirationDate: 'not-a-date',
    });

    render(<PublicSendPage accessId="acc-badexp" keyPart={VALID_KEY} />);

    expect(await screen.findByText(t('txt_text_send'))).toBeInTheDocument();
    // formatSendDate returns '' for an invalid date, so the value substituted
    // into the expires message is empty (the line still renders).
    expect(screen.getByText(/^Expires at:/)).toBeInTheDocument();
  });

  it('falls back to the size name then encrypted-file label for a file send with no names', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue({
      id: 'send-file-fallback',
      type: 1,
      decName: 'Nameless File',
      file: { id: 'file-x', sizeName: '3 MB' },
    });

    render(<PublicSendPage accessId="acc-ff" keyPart={VALID_KEY} />);

    // decFileName + file.fileName absent -> sizeName is used.
    expect(await screen.findByText('3 MB')).toBeInTheDocument();
  });

  it('shows the encrypted-file label when a file send has no names at all', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue({
      id: 'send-file-noname',
      type: 1,
      decName: 'Anon',
      file: { id: 'file-y' },
    });

    render(<PublicSendPage accessId="acc-noname" keyPart={VALID_KEY} />);

    expect(await screen.findByText(t('txt_encrypted_file'))).toBeInTheDocument();
  });

  it.each([
    ['missing id', { type: 0, decText: 'x' }],
    ['invalid type', { id: 'z', type: 5, decText: 'x' }],
    ['file send without a file', { id: 'z', type: 1 }],
  ])('surfaces txt_send_unavailable when the payload is unparseable (%s)', async (_label, payload) => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue(payload);

    render(<PublicSendPage accessId="acc-bad" keyPart={VALID_KEY} />);

    expect(await screen.findByText(t('txt_send_unavailable'))).toBeInTheDocument();
  });

  it('uses the generic open-send message when the error carries no message', async () => {
    accessPublicSend.mockRejectedValue(apiError('', 500));

    render(<PublicSendPage accessId="acc-nomsg" keyPart={VALID_KEY} />);

    expect(await screen.findByText(t('txt_failed_to_open_send'))).toBeInTheDocument();
  });

  it('downloads and decrypts a file send using the link key', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue({
      id: 'send-dl',
      type: 1,
      decName: 'Downloadable',
      decFileName: 'report.pdf',
      file: { id: 'file-dl', fileName: 'report.enc', sizeName: '12 KB' },
    });
    accessPublicSendFile.mockResolvedValue('https://sends.example/file-dl');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    readResponseBytesWithProgress.mockImplementation(async (_resp: unknown, onProgress: (p: { percent: number }) => void) => {
      onProgress({ percent: 42 });
      return new Uint8Array([1, 2, 3, 4]);
    });
    decryptPublicSendFileBytes.mockResolvedValue(new Uint8Array([9, 9, 9]));

    render(<PublicSendPage accessId="acc-dl" keyPart={VALID_KEY} />);

    const dlBtn = await screen.findByRole('button', { name: new RegExp(t('txt_download')) });
    fireEvent.click(dlBtn);

    await vi.waitFor(() => expect(downloadBytesAsFile).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('https://sends.example/file-dl');
    expect(decryptPublicSendFileBytes).toHaveBeenCalled();
    // The decrypted bytes are wrapped in a blob and handed off under the
    // decrypted file name.
    expect(downloadBytesAsFile.mock.calls[0][1]).toBe('report.pdf');
    vi.unstubAllGlobals();
  });

  it('falls back to the raw bytes when file decryption fails (legacy plaintext send)', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue({
      id: 'send-legacy',
      type: 1,
      decName: 'Legacy',
      file: { id: 'file-legacy', fileName: 'legacy.bin' },
    });
    accessPublicSendFile.mockResolvedValue('https://sends.example/file-legacy');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    readResponseBytesWithProgress.mockResolvedValue(new Uint8Array([5, 6, 7]));
    decryptPublicSendFileBytes.mockRejectedValue(new Error('bad key'));

    render(<PublicSendPage accessId="acc-legacy" keyPart={VALID_KEY} />);

    const dlBtn = await screen.findByRole('button', { name: new RegExp(t('txt_download')) });
    fireEvent.click(dlBtn);

    await vi.waitFor(() => expect(downloadBytesAsFile).toHaveBeenCalled());
    // Falls back to file.fileName since there is no decFileName.
    expect(downloadBytesAsFile.mock.calls[0][1]).toBe('legacy.bin');
    vi.unstubAllGlobals();
  });

  it('names the downloaded file with the generic send-file label when no name is known', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue({
      id: 'send-anon-dl',
      type: 1,
      decName: 'Anon',
      file: { id: 'file-anon' },
    });
    accessPublicSendFile.mockResolvedValue('https://sends.example/file-anon');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    readResponseBytesWithProgress.mockResolvedValue(new Uint8Array([1]));
    decryptPublicSendFileBytes.mockResolvedValue(new Uint8Array([2]));

    render(<PublicSendPage accessId="acc-anon" keyPart={VALID_KEY} />);

    const dlBtn = await screen.findByRole('button', { name: new RegExp(t('txt_download')) });
    fireEvent.click(dlBtn);

    await vi.waitFor(() => expect(downloadBytesAsFile).toHaveBeenCalled());
    expect(downloadBytesAsFile.mock.calls[0][1]).toBe(t('txt_send_file'));
    vi.unstubAllGlobals();
  });

  it('uses the generic download-failed message when the download error has no message', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue({
      id: 'send-dlerr2',
      type: 1,
      decName: 'Broken2',
      decFileName: 'broken2.pdf',
      file: { id: 'file-err2', fileName: 'broken2.enc' },
    });
    // Reject before any message is produced so the || fallback is exercised.
    accessPublicSendFile.mockRejectedValue(new Error(''));

    render(<PublicSendPage accessId="acc-dlerr2" keyPart={VALID_KEY} />);

    const dlBtn = await screen.findByRole('button', { name: new RegExp(t('txt_download')) });
    fireEvent.click(dlBtn);

    expect(await screen.findByText(t('txt_download_failed'))).toBeInTheDocument();
  });

  it('renders the not-found page when the key is present but not valid base64', async () => {
    // '@@@' makes atob throw, so decodeBase64Url returns null and the key is
    // treated as unusable.
    render(<PublicSendPage accessId="acc-badkey" keyPart="@@@" />);

    expect(await screen.findByText(t('txt_page_not_found'))).toBeInTheDocument();
    expect(accessPublicSend).not.toHaveBeenCalled();
  });

  it('surfaces txt_send_unavailable when the decrypted payload is not an object', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue(null);

    render(<PublicSendPage accessId="acc-null" keyPart={VALID_KEY} />);

    expect(await screen.findByText(t('txt_send_unavailable'))).toBeInTheDocument();
  });

  it('ignores the result of a superseded load request', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    accessPublicSend.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    accessPublicSend.mockResolvedValueOnce({ raw: true });
    decryptPublicSend.mockResolvedValue({ id: 'winner', type: 0, decName: 'Winner', decText: 'winning text' });

    const { rerender } = render(<PublicSendPage accessId="race-1" keyPart={VALID_KEY} />);
    // Changing the accessId re-fires the effect, aborting the first (pending)
    // request and starting a second one that resolves normally.
    rerender(<PublicSendPage accessId="race-2" keyPart={VALID_KEY} />);
    expect(await screen.findByText('winning text')).toBeInTheDocument();

    // Now resolve the stale first request: its requestId no longer matches, so
    // the component must ignore it and keep the winning render.
    resolveFirst({ raw: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByText('winning text')).toBeInTheDocument();
  });

  it('ignores a superseded request that resolves during decryption', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    let resolveFirstDecrypt: (value: unknown) => void = () => {};
    // First decryption is deferred so the request is still in flight (past the
    // access() stale-check) when it gets superseded.
    decryptPublicSend.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveFirstDecrypt = resolve;
      }),
    );
    decryptPublicSend.mockResolvedValueOnce({ id: 'win2', type: 0, decName: 'Win2', decText: 'second wins' });

    const { rerender } = render(<PublicSendPage accessId="drace-1" keyPart={VALID_KEY} />);
    // Wait until the first request has reached (and is blocked inside) decrypt.
    await vi.waitFor(() => expect(decryptPublicSend).toHaveBeenCalledTimes(1));

    rerender(<PublicSendPage accessId="drace-2" keyPart={VALID_KEY} />);
    expect(await screen.findByText('second wins')).toBeInTheDocument();

    // Resolve the stale first decryption: the abort/stale guard after decrypt
    // must discard it.
    resolveFirstDecrypt({ id: 'stale', type: 0, decName: 'Stale', decText: 'stale text' });
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByText('stale text')).not.toBeInTheDocument();
    expect(screen.getByText('second wins')).toBeInTheDocument();
  });

  it('ignores a superseded request that rejects after being replaced', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    let rejectFirstDecrypt: (reason: unknown) => void = () => {};
    decryptPublicSend.mockImplementationOnce(
      () => new Promise((_resolve, reject) => {
        rejectFirstDecrypt = reject;
      }),
    );
    decryptPublicSend.mockResolvedValueOnce({ id: 'win3', type: 0, decName: 'Win3', decText: 'third wins' });

    const { rerender } = render(<PublicSendPage accessId="rrace-1" keyPart={VALID_KEY} />);
    await vi.waitFor(() => expect(decryptPublicSend).toHaveBeenCalledTimes(1));

    rerender(<PublicSendPage accessId="rrace-2" keyPart={VALID_KEY} />);
    expect(await screen.findByText('third wins')).toBeInTheDocument();

    // The stale first request now rejects; the catch-guard must swallow it and
    // leave no error banner.
    rejectFirstDecrypt(apiError('stale failure', 500));
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByText('stale failure')).not.toBeInTheDocument();
    expect(screen.getByText('third wins')).toBeInTheDocument();
  });

  it('shows a download error when the file fetch response is not ok', async () => {
    accessPublicSend.mockResolvedValue({ raw: true });
    decryptPublicSend.mockResolvedValue({
      id: 'send-dlerr',
      type: 1,
      decName: 'Broken',
      decFileName: 'broken.pdf',
      file: { id: 'file-err', fileName: 'broken.enc' },
    });
    accessPublicSendFile.mockResolvedValue('https://sends.example/file-err');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    render(<PublicSendPage accessId="acc-dlerr" keyPart={VALID_KEY} />);

    const dlBtn = await screen.findByRole('button', { name: new RegExp(t('txt_download')) });
    fireEvent.click(dlBtn);

    expect(await screen.findByText(t('txt_download_failed'))).toBeInTheDocument();
    expect(downloadBytesAsFile).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
