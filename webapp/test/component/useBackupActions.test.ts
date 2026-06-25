import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/preact';

vi.mock('@/lib/api/backup', () => ({
  buildCompleteAdminBackupExport: vi.fn(),
  deleteRemoteBackup: vi.fn(),
  downloadRemoteBackup: vi.fn(),
  getAdminBackupSettings: vi.fn(),
  importAdminBackup: vi.fn(),
  inspectRemoteBackupIntegrity: vi.fn(),
  listRemoteBackups: vi.fn(),
  restoreRemoteBackup: vi.fn(),
  runAdminBackupNow: vi.fn(),
  saveAdminBackupSettings: vi.fn(),
}));

vi.mock('@/lib/download', () => ({
  downloadBytesAsFile: vi.fn(),
}));

vi.mock('@/lib/backup-restore-progress', () => ({
  dispatchBackupProgress: vi.fn(),
}));

import useBackupActions from '@/hooks/useBackupActions';
import {
  buildCompleteAdminBackupExport,
  deleteRemoteBackup,
  downloadRemoteBackup,
  getAdminBackupSettings,
  importAdminBackup,
  inspectRemoteBackupIntegrity,
  listRemoteBackups,
  restoreRemoteBackup,
  runAdminBackupNow,
  saveAdminBackupSettings,
} from '@/lib/api/backup';
import { downloadBytesAsFile } from '@/lib/download';
import { dispatchBackupProgress } from '@/lib/backup-restore-progress';

const mockedBuildExport = vi.mocked(buildCompleteAdminBackupExport);
const mockedDeleteRemote = vi.mocked(deleteRemoteBackup);
const mockedDownloadRemote = vi.mocked(downloadRemoteBackup);
const mockedGetSettings = vi.mocked(getAdminBackupSettings);
const mockedImport = vi.mocked(importAdminBackup);
const mockedInspect = vi.mocked(inspectRemoteBackupIntegrity);
const mockedList = vi.mocked(listRemoteBackups);
const mockedRestore = vi.mocked(restoreRemoteBackup);
const mockedRunNow = vi.mocked(runAdminBackupNow);
const mockedSaveSettings = vi.mocked(saveAdminBackupSettings);
const mockedDownloadFile = vi.mocked(downloadBytesAsFile);
const mockedDispatch = vi.mocked(dispatchBackupProgress);

function setup(opts: { onImported?: () => void; onRestored?: () => void } = {}) {
  const authedFetch = vi.fn();
  const onImported = opts.onImported ?? vi.fn();
  const onRestored = opts.onRestored ?? vi.fn();
  const { result } = renderHook(() => useBackupActions({ authedFetch, onImported, onRestored }));
  return { actions: result.current, authedFetch, onImported, onRestored };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useBackupActions', () => {
  describe('exportBackup', () => {
    it('builds the export, writes the file, and dispatches a completion event', async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      mockedBuildExport.mockResolvedValue({ bytes, fileName: 'b.zip', mimeType: 'application/zip' });
      const { actions, authedFetch } = setup();

      await actions.exportBackup('hash', true);

      expect(mockedBuildExport).toHaveBeenCalledTimes(1);
      const buildArgs = mockedBuildExport.mock.calls[0];
      expect(buildArgs[0]).toBe(authedFetch);
      expect(buildArgs[1]).toBe('hash');
      expect(buildArgs[2]).toBe(true);
      expect(typeof buildArgs[3]).toBe('function');
      expect(mockedDownloadFile).toHaveBeenCalledWith(bytes, 'b.zip', 'application/zip');
      expect(mockedDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'backup-export', step: 'export_complete', done: true, ok: true })
      );
    });

    it('defaults includeAttachments to false', async () => {
      mockedBuildExport.mockResolvedValue({ bytes: new Uint8Array(), fileName: 'b.zip', mimeType: 'application/zip' });
      const { actions } = setup();
      await actions.exportBackup('hash');
      expect(mockedBuildExport.mock.calls[0][2]).toBe(false);
    });

    it('propagates errors and does not download or dispatch completion', async () => {
      mockedBuildExport.mockRejectedValue(new Error('export fail'));
      const { actions } = setup();
      await expect(actions.exportBackup('hash')).rejects.toThrow('export fail');
      expect(mockedDownloadFile).not.toHaveBeenCalled();
      expect(mockedDispatch).not.toHaveBeenCalled();
    });
  });

  describe('importBackup', () => {
    const file = new File(['x'], 'f.zip');

    it('imports, fires onImported, and returns the result', async () => {
      const result = { imported: true } as Awaited<ReturnType<typeof importAdminBackup>>;
      mockedImport.mockResolvedValue(result);
      const { actions, authedFetch, onImported } = setup();

      const returned = await actions.importBackup('hash', file, true);

      expect(mockedImport).toHaveBeenCalledWith(authedFetch, 'hash', file, true);
      expect(onImported).toHaveBeenCalledTimes(1);
      expect(returned).toBe(result);
    });

    it('defaults replaceExisting to false', async () => {
      mockedImport.mockResolvedValue({ imported: true } as Awaited<ReturnType<typeof importAdminBackup>>);
      const { actions, authedFetch } = setup();
      await actions.importBackup('hash', file);
      expect(mockedImport).toHaveBeenCalledWith(authedFetch, 'hash', file, false);
    });

    it('propagates errors and does not fire onImported', async () => {
      mockedImport.mockRejectedValue(new Error('import fail'));
      const { actions, onImported } = setup();
      await expect(actions.importBackup('hash', file)).rejects.toThrow('import fail');
      expect(onImported).not.toHaveBeenCalled();
    });

    it('works when onImported is not provided', async () => {
      mockedImport.mockResolvedValue({ imported: true } as Awaited<ReturnType<typeof importAdminBackup>>);
      const authedFetch = vi.fn();
      const { result } = renderHook(() => useBackupActions({ authedFetch }));
      await expect(result.current.importBackup('hash', file)).resolves.toMatchObject({ imported: true });
    });
  });

  describe('importBackupAllowingChecksumMismatch', () => {
    const file = new File(['x'], 'f.zip');

    it('imports with allowChecksumMismatch=true and fires onImported', async () => {
      const result = { imported: true } as Awaited<ReturnType<typeof importAdminBackup>>;
      mockedImport.mockResolvedValue(result);
      const { actions, authedFetch, onImported } = setup();

      const returned = await actions.importBackupAllowingChecksumMismatch('hash', file, true);

      expect(mockedImport).toHaveBeenCalledWith(authedFetch, 'hash', file, true, true);
      expect(onImported).toHaveBeenCalledTimes(1);
      expect(returned).toBe(result);
    });

    it('propagates errors and does not fire onImported', async () => {
      mockedImport.mockRejectedValue(new Error('import fail'));
      const { actions, onImported } = setup();
      await expect(actions.importBackupAllowingChecksumMismatch('hash', file)).rejects.toThrow('import fail');
      expect(onImported).not.toHaveBeenCalled();
    });
  });

  describe('loadSettings', () => {
    it('returns settings from the api', async () => {
      const settings = { destinations: [] } as unknown as Awaited<ReturnType<typeof getAdminBackupSettings>>;
      mockedGetSettings.mockResolvedValue(settings);
      const { actions, authedFetch } = setup();
      const returned = await actions.loadSettings();
      expect(mockedGetSettings).toHaveBeenCalledWith(authedFetch);
      expect(returned).toBe(settings);
    });

    it('propagates errors', async () => {
      mockedGetSettings.mockRejectedValue(new Error('load fail'));
      const { actions } = setup();
      await expect(actions.loadSettings()).rejects.toThrow('load fail');
    });
  });

  describe('saveSettings', () => {
    it('forwards the hash and settings to the api', async () => {
      const settings = { destinations: [] } as unknown as Parameters<typeof saveAdminBackupSettings>[2];
      mockedSaveSettings.mockResolvedValue(settings as Awaited<ReturnType<typeof saveAdminBackupSettings>>);
      const { actions, authedFetch } = setup();
      const returned = await actions.saveSettings('hash', settings);
      expect(mockedSaveSettings).toHaveBeenCalledWith(authedFetch, 'hash', settings);
      expect(returned).toBe(settings);
    });

    it('propagates errors', async () => {
      mockedSaveSettings.mockRejectedValue(new Error('save fail'));
      const { actions } = setup();
      await expect(actions.saveSettings('hash', {} as Parameters<typeof saveAdminBackupSettings>[2])).rejects.toThrow('save fail');
    });
  });

  describe('runRemoteBackup', () => {
    it('forwards the hash and destination', async () => {
      const resp = { result: {}, settings: {} } as unknown as Awaited<ReturnType<typeof runAdminBackupNow>>;
      mockedRunNow.mockResolvedValue(resp);
      const { actions, authedFetch } = setup();
      const returned = await actions.runRemoteBackup('hash', 'dest1');
      expect(mockedRunNow).toHaveBeenCalledWith(authedFetch, 'hash', 'dest1');
      expect(returned).toBe(resp);
    });

    it('propagates errors', async () => {
      mockedRunNow.mockRejectedValue(new Error('run fail'));
      const { actions } = setup();
      await expect(actions.runRemoteBackup('hash')).rejects.toThrow('run fail');
    });
  });

  describe('listRemoteBackups', () => {
    it('forwards destination and path', async () => {
      const resp = { items: [], currentPath: '', destinationId: 'd' } as unknown as Awaited<ReturnType<typeof listRemoteBackups>>;
      mockedList.mockResolvedValue(resp);
      const { actions, authedFetch } = setup();
      const returned = await actions.listRemoteBackups('dest1', 'sub/');
      expect(mockedList).toHaveBeenCalledWith(authedFetch, 'dest1', 'sub/');
      expect(returned).toBe(resp);
    });

    it('propagates errors', async () => {
      mockedList.mockRejectedValue(new Error('list fail'));
      const { actions } = setup();
      await expect(actions.listRemoteBackups('dest1', '')).rejects.toThrow('list fail');
    });
  });

  describe('downloadRemoteBackup', () => {
    it('fetches the payload and writes the file', async () => {
      const bytes = new Uint8Array([9]);
      mockedDownloadRemote.mockResolvedValue({ bytes, fileName: 'r.zip', mimeType: 'application/zip' });
      const onProgress = vi.fn();
      const { actions, authedFetch } = setup();

      await actions.downloadRemoteBackup('hash', 'dest1', 'p.zip', onProgress);

      expect(mockedDownloadRemote).toHaveBeenCalledWith(authedFetch, 'hash', 'dest1', 'p.zip', onProgress);
      expect(mockedDownloadFile).toHaveBeenCalledWith(bytes, 'r.zip', 'application/zip');
    });

    it('propagates errors and does not write a file', async () => {
      mockedDownloadRemote.mockRejectedValue(new Error('download fail'));
      const { actions } = setup();
      await expect(actions.downloadRemoteBackup('hash', 'dest1', 'p.zip')).rejects.toThrow('download fail');
      expect(mockedDownloadFile).not.toHaveBeenCalled();
    });
  });

  describe('inspectRemoteBackup', () => {
    it('forwards destination and path', async () => {
      const resp = { integrity: {}, fileName: 'p.zip' } as unknown as Awaited<ReturnType<typeof inspectRemoteBackupIntegrity>>;
      mockedInspect.mockResolvedValue(resp);
      const { actions, authedFetch } = setup();
      const returned = await actions.inspectRemoteBackup('dest1', 'p.zip');
      expect(mockedInspect).toHaveBeenCalledWith(authedFetch, 'dest1', 'p.zip');
      expect(returned).toBe(resp);
    });

    it('propagates errors', async () => {
      mockedInspect.mockRejectedValue(new Error('inspect fail'));
      const { actions } = setup();
      await expect(actions.inspectRemoteBackup('dest1', 'p.zip')).rejects.toThrow('inspect fail');
    });
  });

  describe('deleteRemoteBackup', () => {
    it('forwards destination and path', async () => {
      mockedDeleteRemote.mockResolvedValue(undefined);
      const { actions, authedFetch } = setup();
      await actions.deleteRemoteBackup('dest1', 'p.zip');
      expect(mockedDeleteRemote).toHaveBeenCalledWith(authedFetch, 'dest1', 'p.zip');
    });

    it('propagates errors', async () => {
      mockedDeleteRemote.mockRejectedValue(new Error('delete fail'));
      const { actions } = setup();
      await expect(actions.deleteRemoteBackup('dest1', 'p.zip')).rejects.toThrow('delete fail');
    });
  });

  describe('restoreRemoteBackup', () => {
    it('restores, fires onRestored, and returns the result', async () => {
      const result = { imported: true } as Awaited<ReturnType<typeof restoreRemoteBackup>>;
      mockedRestore.mockResolvedValue(result);
      const { actions, authedFetch, onRestored } = setup();

      const returned = await actions.restoreRemoteBackup('hash', 'dest1', 'p.zip', true);

      expect(mockedRestore).toHaveBeenCalledWith(authedFetch, 'hash', 'dest1', 'p.zip', true);
      expect(onRestored).toHaveBeenCalledTimes(1);
      expect(returned).toBe(result);
    });

    it('defaults replaceExisting to false', async () => {
      mockedRestore.mockResolvedValue({ imported: true } as Awaited<ReturnType<typeof restoreRemoteBackup>>);
      const { actions, authedFetch } = setup();
      await actions.restoreRemoteBackup('hash', 'dest1', 'p.zip');
      expect(mockedRestore).toHaveBeenCalledWith(authedFetch, 'hash', 'dest1', 'p.zip', false);
    });

    it('propagates errors and does not fire onRestored', async () => {
      mockedRestore.mockRejectedValue(new Error('restore fail'));
      const { actions, onRestored } = setup();
      await expect(actions.restoreRemoteBackup('hash', 'dest1', 'p.zip')).rejects.toThrow('restore fail');
      expect(onRestored).not.toHaveBeenCalled();
    });

    it('works when onRestored is not provided', async () => {
      mockedRestore.mockResolvedValue({ imported: true } as Awaited<ReturnType<typeof restoreRemoteBackup>>);
      const authedFetch = vi.fn();
      const { result } = renderHook(() => useBackupActions({ authedFetch }));
      await expect(result.current.restoreRemoteBackup('hash', 'dest1', 'p.zip')).resolves.toMatchObject({ imported: true });
    });
  });

  describe('restoreRemoteBackupAllowingChecksumMismatch', () => {
    it('restores with allowChecksumMismatch=true and fires onRestored', async () => {
      const result = { imported: true } as Awaited<ReturnType<typeof restoreRemoteBackup>>;
      mockedRestore.mockResolvedValue(result);
      const { actions, authedFetch, onRestored } = setup();

      const returned = await actions.restoreRemoteBackupAllowingChecksumMismatch('hash', 'dest1', 'p.zip', true);

      expect(mockedRestore).toHaveBeenCalledWith(authedFetch, 'hash', 'dest1', 'p.zip', true, true);
      expect(onRestored).toHaveBeenCalledTimes(1);
      expect(returned).toBe(result);
    });

    it('propagates errors and does not fire onRestored', async () => {
      mockedRestore.mockRejectedValue(new Error('restore fail'));
      const { actions, onRestored } = setup();
      await expect(actions.restoreRemoteBackupAllowingChecksumMismatch('hash', 'dest1', 'p.zip')).rejects.toThrow('restore fail');
      expect(onRestored).not.toHaveBeenCalled();
    });
  });
});
