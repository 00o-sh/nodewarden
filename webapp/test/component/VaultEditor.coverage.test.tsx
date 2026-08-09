import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'preact';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import jsQR from 'jsqr';
import VaultEditor from '@/components/vault/VaultEditor';
import { createEmptyDraft } from '@/components/vault/vault-page-helpers';
import type { Cipher, Folder, VaultDraft } from '@/lib/types';

// This file drives the paths the other two VaultEditor suites leave uncovered:
// the bank/license/passport field sections, exhaustive identity editing, the
// TOTP QR scanner (file-upload decode via BarcodeDetector and the jsQR canvas
// fallback, plus the live camera useEffect), the QR dialog controls, and a set
// of small conditional branches (favorite-on, passkey label fallback, download
// label states, attachment add button, empty-id attachment, move-up row).

vi.mock('jsqr', () => ({ default: vi.fn() }));
const mockJsQR = vi.mocked(jsQR);

function makeDraft(overrides: Partial<VaultDraft> = {}): VaultDraft {
  return { ...createEmptyDraft(1), name: 'GitHub', ...overrides };
}

function setup(
  draft: VaultDraft,
  overrides: Partial<Parameters<typeof VaultEditor>[0]> = {}
) {
  const callbacks = {
    onUpdateDraft: vi.fn(),
    onSeedSshDefaults: vi.fn(),
    onUpdateSshPublicKey: vi.fn(),
    onUpdateDraftLoginUri: vi.fn(),
    onUpdateDraftLoginUriMatch: vi.fn(),
    onReorderDraftLoginUri: vi.fn(),
    onRequestDeleteLoginPasskey: vi.fn(),
    onQueueAttachmentFiles: vi.fn(),
    onToggleExistingAttachmentRemoval: vi.fn(),
    onRemoveQueuedAttachment: vi.fn(),
    onDownloadAttachment: vi.fn(),
    onPatchDraftCustomField: vi.fn(),
    onUpdateDraftCustomFields: vi.fn(),
    onOpenFieldModal: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    onDeleteSelected: vi.fn(),
  };
  const folders: Folder[] = [{ id: 'f1', name: 'Work', decName: 'Work' }];
  const props: Parameters<typeof VaultEditor>[0] = {
    draft,
    isCreating: true,
    busy: false,
    folders,
    selectedCipher: null,
    editExistingAttachments: [],
    removedAttachmentIds: {},
    removedAttachmentCount: 0,
    attachmentQueue: [],
    attachmentInputRef: createRef<HTMLInputElement>(),
    localError: '',
    downloadingAttachmentKey: '',
    attachmentDownloadPercent: null,
    uploadingAttachmentName: '',
    attachmentUploadPercent: null,
    ...callbacks,
    ...overrides,
  };
  const utils = render(<VaultEditor {...props} />);
  return { ...utils, ...callbacks, props };
}

// Fire an input event on every text field inside a type-specific section and
// assert one handler call per field, so each per-field onInput arrow is hit.
function editEverySectionField(container: HTMLElement, onUpdateDraft: ReturnType<typeof vi.fn>) {
  const inputs = Array.from(container.querySelectorAll('.field-grid input.input')) as HTMLInputElement[];
  expect(inputs.length).toBeGreaterThan(0);
  const before = onUpdateDraft.mock.calls.length;
  inputs.forEach((input, i) => {
    fireEvent.input(input, { target: { value: `v${i}` } });
  });
  expect(onUpdateDraft.mock.calls.length).toBe(before + inputs.length);
}

describe('<VaultEditor> section field coverage', () => {
  it('edits every bank account field (type 6)', () => {
    const { container, onUpdateDraft } = setup(makeDraft({ type: 6 }));
    expect(screen.getByText('Bank Account Details')).toBeInTheDocument();
    editEverySectionField(container, onUpdateDraft);
    expect(onUpdateDraft).toHaveBeenCalledWith(expect.objectContaining({ bankName: expect.any(String) }));
  });

  it('edits every driver-license field (type 7)', () => {
    const { container, onUpdateDraft } = setup(makeDraft({ type: 7 }));
    expect(screen.getByText('Driver License Details')).toBeInTheDocument();
    editEverySectionField(container, onUpdateDraft);
    expect(onUpdateDraft).toHaveBeenCalledWith(expect.objectContaining({ licenseNumber: expect.any(String) }));
  });

  it('edits every passport field (type 8)', () => {
    const { container, onUpdateDraft } = setup(makeDraft({ type: 8 }));
    expect(screen.getByText('Passport Details')).toBeInTheDocument();
    editEverySectionField(container, onUpdateDraft);
    expect(onUpdateDraft).toHaveBeenCalledWith(expect.objectContaining({ passportSurname: expect.any(String) }));
  });

  it('edits every identity field (type 4)', () => {
    const { container, onUpdateDraft } = setup(makeDraft({ type: 4 }));
    expect(screen.getByText('Identity Details')).toBeInTheDocument();
    editEverySectionField(container, onUpdateDraft);
    expect(onUpdateDraft).toHaveBeenCalledWith(expect.objectContaining({ identCountry: expect.any(String) }));
  });
});

describe('<VaultEditor> small branch coverage', () => {
  it('renders the filled star when the draft is already a favorite', () => {
    setup(makeDraft({ favorite: true }));
    const favBtn = screen.getByRole('button', { name: /Favorite/ });
    expect(favBtn).toHaveClass('star-on');
  });

  it('falls back to the folder id when a folder has no name', () => {
    setup(makeDraft(), { folders: [{ id: 'bare-id' } as Folder] });
    const folderSelect = screen.getByText('Folder').closest('label')!.querySelector('select')!;
    const values = Array.from(folderSelect.options).map((o) => o.textContent);
    expect(values).toContain('bare-id');
  });

  it('moves a website row up when it is not the first row', () => {
    const draft = makeDraft({
      type: 1,
      loginUris: [
        { uri: 'https://a.com', match: null },
        { uri: 'https://b.com', match: 3 },
      ],
    });
    const { onReorderDraftLoginUri } = setup(draft);
    const rows = document.querySelectorAll('.website-row');
    // The second row can move up (index > 0).
    fireEvent.click(within(rows[1] as HTMLElement).getByRole('button', { name: 'Move up' }));
    expect(onReorderDraftLoginUri).toHaveBeenCalledWith(1, 0);
  });

  it('renders a passkey with no creation date using the plain passkey label', () => {
    const draft = makeDraft({ type: 1, loginFido2Credentials: [{ creationDate: '' }] });
    setup(draft);
    expect(screen.getByText('Passkeys')).toBeInTheDocument();
    // The row text/label collapses to the generic "Passkey" string.
    const rows = screen.getAllByText('Passkey');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('clicks the attachment add button which opens the hidden file picker', () => {
    const attachmentInputRef = createRef<HTMLInputElement>();
    const { container } = setup(makeDraft(), { attachmentInputRef });
    const hidden = container.querySelector('input.attachment-file-input') as HTMLInputElement;
    const clickSpy = vi.spyOn(hidden, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Upload attachments' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('skips existing attachments that have no id', () => {
    const cipher = { id: 'c1', type: 1 } as Cipher;
    setup(makeDraft(), {
      isCreating: false,
      selectedCipher: cipher,
      editExistingAttachments: [
        { id: '', decFileName: 'ghost.png', size: 10 },
        { id: 'a2', decFileName: 'real.png', size: 20 },
      ],
    });
    expect(screen.queryByText('ghost.png')).not.toBeInTheDocument();
    expect(screen.getByText('real.png')).toBeInTheDocument();
  });

  it('shows the indeterminate "Downloading..." label when percent is null', () => {
    const cipher = { id: 'c1', type: 1 } as Cipher;
    setup(makeDraft(), {
      isCreating: false,
      selectedCipher: cipher,
      editExistingAttachments: [{ id: 'a1', decFileName: 'photo.png', size: 2048 }],
      downloadingAttachmentKey: 'c1:a1',
      attachmentDownloadPercent: null,
    });
    expect(screen.getByText('Downloading...')).toBeInTheDocument();
  });

  it('renders a checked boolean custom field with the "Checked" label', () => {
    const draft = makeDraft({ customFields: [{ type: 2, label: 'Active', value: 'true' }] });
    setup(draft);
    expect(screen.getByText('Checked')).toBeInTheDocument();
  });
});

describe('<VaultEditor> TOTP QR file decode', () => {
  const realCreateImageBitmap = globalThis.createImageBitmap;
  const realGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    mockJsQR.mockReset();
    globalThis.createImageBitmap = vi.fn(async () => ({
      width: 16,
      height: 16,
      close: vi.fn(),
    })) as unknown as typeof createImageBitmap;
  });

  afterEach(() => {
    globalThis.createImageBitmap = realCreateImageBitmap;
    HTMLCanvasElement.prototype.getContext = realGetContext;
    delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
    vi.restoreAllMocks();
  });

  function openScanner() {
    setup(makeDraft({ type: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Scan TOTP QR code' }));
    return screen.getByRole('dialog', { name: 'Scan TOTP QR code' });
  }

  function dialogFileInput(dialog: HTMLElement): HTMLInputElement {
    return dialog.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
  }

  it('decodes a QR image with the native BarcodeDetector and applies the value', async () => {
    (window as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      constructor() {}
      detect() {
        return Promise.resolve([{ rawValue: 'JBSWY3DPEHPK3PXP' }]);
      }
    };
    const dialog = openScanner();
    await userEvent.upload(dialogFileInput(dialog), new File(['x'], 'qr.png', { type: 'image/png' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Scan TOTP QR code' })).not.toBeInTheDocument();
    });
  });

  it('falls back to the jsQR canvas decoder when no native detector exists', async () => {
    const fakeCtx = {
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(16 * 16 * 4) })),
    };
    HTMLCanvasElement.prototype.getContext = vi.fn(() => fakeCtx) as unknown as typeof realGetContext;
    mockJsQR.mockReturnValue({ data: 'JBSWY3DPEHPK3PXP' } as ReturnType<typeof jsQR>);
    const dialog = openScanner();
    await userEvent.upload(dialogFileInput(dialog), new File(['x'], 'qr.png', { type: 'image/png' }));
    await waitFor(() => {
      expect(mockJsQR).toHaveBeenCalled();
      expect(screen.queryByRole('dialog', { name: 'Scan TOTP QR code' })).not.toBeInTheDocument();
    });
  });

  it('reports when the jsQR decoder finds no QR code in the image', async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(16 * 16 * 4) })),
    })) as unknown as typeof realGetContext;
    mockJsQR.mockReturnValue(null);
    const dialog = openScanner();
    await userEvent.upload(dialogFileInput(dialog), new File(['x'], 'qr.png', { type: 'image/png' }));
    await waitFor(() => {
      expect(within(dialog).getByText('No QR code found in that image.')).toBeInTheDocument();
    });
  });

  it('falls back to jsQR when the native detector throws', async () => {
    (window as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      constructor() {}
      detect() {
        return Promise.reject(new Error('nope'));
      }
    };
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(16 * 16 * 4) })),
    })) as unknown as typeof realGetContext;
    mockJsQR.mockReturnValue({ data: 'JBSWY3DPEHPK3PXP' } as ReturnType<typeof jsQR>);
    const dialog = openScanner();
    await userEvent.upload(dialogFileInput(dialog), new File(['x'], 'qr.png', { type: 'image/png' }));
    await waitFor(() => {
      expect(mockJsQR).toHaveBeenCalled();
    });
  });

  it('rejects a non-image file before attempting to decode', async () => {
    const dialog = openScanner();
    await userEvent.upload(dialogFileInput(dialog), new File(['x'], 'note.txt', { type: 'text/plain' }), {
      applyAccept: false,
    });
    await waitFor(() => {
      expect(within(dialog).getByText('Choose an image file.')).toBeInTheDocument();
    });
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });

  it('rejects an image larger than the 8 MB limit', async () => {
    const dialog = openScanner();
    const big = new File(['x'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 9 * 1024 * 1024 });
    await userEvent.upload(dialogFileInput(dialog), big);
    await waitFor(() => {
      expect(within(dialog).getByText('Choose an image smaller than 8 MB.')).toBeInTheDocument();
    });
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });

  it('reports a scan failure when decoding throws', async () => {
    globalThis.createImageBitmap = vi.fn(async () => {
      throw new Error('decode boom');
    }) as unknown as typeof createImageBitmap;
    const dialog = openScanner();
    await userEvent.upload(dialogFileInput(dialog), new File(['x'], 'qr.png', { type: 'image/png' }));
    await waitFor(() => {
      expect(within(dialog).getByText('Failed to scan QR code.')).toBeInTheDocument();
    });
  });
});

describe('<VaultEditor> TOTP QR dialog controls', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function openScanner() {
    setup(makeDraft({ type: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Scan TOTP QR code' }));
    return screen.getByRole('dialog', { name: 'Scan TOTP QR code' });
  }

  it('closes the scanner from the header close button', () => {
    const dialog = openScanner();
    // There is both a header X and a footer "Close" button; target the header one.
    fireEvent.click(dialog.querySelector('.totp-scan-close') as HTMLElement);
    expect(screen.queryByRole('dialog', { name: 'Scan TOTP QR code' })).not.toBeInTheDocument();
  });

  it('closes the scanner from the footer primary Close button', () => {
    const dialog = openScanner();
    fireEvent.click(dialog.querySelector('.totp-scan-actions .btn-primary') as HTMLElement);
    expect(screen.queryByRole('dialog', { name: 'Scan TOTP QR code' })).not.toBeInTheDocument();
  });

  it('closes the scanner when the backdrop mask is clicked', () => {
    openScanner();
    const mask = document.querySelector('.totp-scan-mask') as HTMLElement;
    fireEvent.click(mask);
    expect(screen.queryByRole('dialog', { name: 'Scan TOTP QR code' })).not.toBeInTheDocument();
  });

  it('opens the hidden image picker from the "Choose image" button', () => {
    const dialog = openScanner();
    const fileInput = dialog.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose image' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});

describe('<VaultEditor> TOTP QR live camera', () => {
  const realMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  const realPlay = HTMLMediaElement.prototype.play;
  const realReadyState = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState');
  const realRAF = window.requestAnimationFrame;
  const realCAF = window.cancelAnimationFrame;

  beforeEach(() => {
    mockJsQR.mockReset();
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get: () => HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    // Drive the scan loop for a bounded number of frames so it finds a code and
    // stops, without spinning forever if a frame fails to decode.
    let frames = 0;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      frames += 1;
      if (frames <= 5) setTimeout(() => cb(performance.now()), 0);
      return frames;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    if (realMediaDevices) Object.defineProperty(navigator, 'mediaDevices', realMediaDevices);
    else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    HTMLMediaElement.prototype.play = realPlay;
    if (realReadyState) Object.defineProperty(HTMLMediaElement.prototype, 'readyState', realReadyState);
    window.requestAnimationFrame = realRAF;
    window.cancelAnimationFrame = realCAF;
    delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
    vi.restoreAllMocks();
  });

  function mockCamera(getUserMedia: () => Promise<MediaStream>) {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(getUserMedia) },
    });
  }

  function openScanner() {
    setup(makeDraft({ type: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Scan TOTP QR code' }));
    return screen.getByRole('dialog', { name: 'Scan TOTP QR code' });
  }

  it('starts the camera, scans a frame with BarcodeDetector, and applies the value', async () => {
    const stop = vi.fn();
    mockCamera(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream);
    (window as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      constructor() {}
      detect() {
        return Promise.resolve([{ rawValue: 'JBSWY3DPEHPK3PXP' }]);
      }
    };
    openScanner();
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Scan TOTP QR code' })).not.toBeInTheDocument();
    });
    // Closing the scanner tears the stream down.
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it('scans a camera frame through the jsQR fallback when no detector exists', async () => {
    const stop = vi.fn();
    mockCamera(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream);
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    const wDesc = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoWidth');
    const hDesc = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoHeight');
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 2 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 2 });
    mockJsQR.mockReturnValue({ data: 'JBSWY3DPEHPK3PXP' } as ReturnType<typeof jsQR>);
    try {
      openScanner();
      await waitFor(() => {
        expect(mockJsQR).toHaveBeenCalled();
      });
    } finally {
      if (wDesc) Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', wDesc);
      if (hDesc) Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', hDesc);
    }
  });

  it('reports camera-unavailable when getUserMedia rejects', async () => {
    mockCamera(async () => {
      throw new Error('denied');
    });
    const dialog = openScanner();
    await waitFor(() => {
      expect(
        within(dialog).getByText('Camera is unavailable. Check browser permission, or choose an image.')
      ).toBeInTheDocument();
    });
  });
});
