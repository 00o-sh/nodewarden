import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBytesAsFile, readResponseBytesWithProgress } from '@/lib/download';

describe('downloadBytesAsFile', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    vi.useFakeTimers();
    createObjectURL = vi.fn(() => 'blob:mock-url');
    revokeObjectURL = vi.fn();
    // jsdom does not implement these by default.
    (URL as any).createObjectURL = createObjectURL;
    (URL as any).revokeObjectURL = revokeObjectURL;
    // Anchor click would otherwise attempt navigation in jsdom.
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    clickSpy.mockRestore();
    (URL as any).createObjectURL = originalCreate;
    (URL as any).revokeObjectURL = originalRevoke;
  });

  it('creates a blob URL, configures and clicks an anchor, then revokes', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    downloadBytesAsFile(bytes, 'data.bin', 'application/octet-stream');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/octet-stream');
    expect(blob.size).toBe(4);

    expect(clickSpy).toHaveBeenCalledTimes(1);
    // Anchor is removed from the DOM after the click.
    expect(document.querySelector('a')).toBeNull();

    // Revocation is deferred to a timeout.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('sets the download filename and href on the anchor before clicking', () => {
    let captured: HTMLAnchorElement | null = null;
    clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
      captured = this;
    });
    downloadBytesAsFile(new Uint8Array([9]), 'report.csv', 'text/csv');
    expect(captured).not.toBeNull();
    expect(captured!.download).toBe('report.csv');
    expect(captured!.href).toContain('blob:mock-url');
  });

  it('defaults mime type and filename when blank', () => {
    let captured: HTMLAnchorElement | null = null;
    clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
      captured = this;
    });
    downloadBytesAsFile(new Uint8Array([0]), '', '');
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/octet-stream');
    expect(captured!.download).toBe('download.bin');
  });
});

describe('readResponseBytesWithProgress', () => {
  it('reads bytes via arrayBuffer when there is no streaming body', async () => {
    const data = new Uint8Array([10, 20, 30]);
    const progress: number[] = [];
    // A Response-like object with no `body` (jsdom Response may not stream).
    const response = {
      body: null,
      headers: new Headers({ 'Content-Length': '3' }),
      arrayBuffer: async () => data.buffer.slice(0),
    } as unknown as Response;

    const bytes = await readResponseBytesWithProgress(response, (p) => progress.push(p.loaded));
    expect(Array.from(bytes)).toEqual([10, 20, 30]);
    expect(progress).toContain(3);
  });

  it('streams chunks from a ReadableStream body and reports cumulative progress', async () => {
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
    const states: Array<{ loaded: number; total: number | null; percent: number | null }> = [];
    const response = {
      body: stream,
      headers: new Headers({ 'Content-Length': '5' }),
    } as unknown as Response;

    const bytes = await readResponseBytesWithProgress(response, (p) => states.push(p));
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);

    // Progress is reported starting at 0 and ending at the full length.
    expect(states[0].loaded).toBe(0);
    const last = states[states.length - 1];
    expect(last.loaded).toBe(5);
    expect(last.total).toBe(5);
    expect(last.percent).toBe(100);
  });

  it('reports null total/percent when Content-Length is absent or invalid', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.close();
      },
    });
    const states: Array<{ total: number | null; percent: number | null }> = [];
    const response = {
      body: stream,
      headers: new Headers({ 'Content-Length': 'not-a-number' }),
    } as unknown as Response;

    const bytes = await readResponseBytesWithProgress(response, (p) => states.push(p));
    expect(bytes.byteLength).toBe(4);
    expect(states.every((s) => s.total === null && s.percent === null)).toBe(true);
  });

  it('works without an onProgress callback', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([7]));
        controller.close();
      },
    });
    const response = {
      body: stream,
      headers: new Headers(),
    } as unknown as Response;
    const bytes = await readResponseBytesWithProgress(response);
    expect(Array.from(bytes)).toEqual([7]);
  });
});
