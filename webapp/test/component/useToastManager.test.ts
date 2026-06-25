import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/preact';
import { useToastManager } from '@/hooks/useToastManager';

describe('useToastManager', () => {
  it('starts with no toasts', () => {
    const { result } = renderHook(() => useToastManager());
    expect(result.current.toasts).toEqual([]);
  });

  it('pushes a toast with the given type and text', () => {
    const { result } = renderHook(() => useToastManager());
    act(() => result.current.pushToast('success', 'Saved'));
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]).toMatchObject({ type: 'success', text: 'Saved' });
  });

  it('caps the queue so only the most recent toasts are kept', () => {
    const { result } = renderHook(() => useToastManager());
    act(() => {
      for (let i = 0; i < 6; i += 1) result.current.pushToast('success', `t${i}`);
    });
    // slice(-3) keeps at most 4 (3 prior + 1 new) per push.
    expect(result.current.toasts.length).toBeLessThanOrEqual(4);
    expect(result.current.toasts.at(-1)?.text).toBe('t5');
  });

  it('removes a toast by id', () => {
    const { result } = renderHook(() => useToastManager());
    act(() => result.current.pushToast('error', 'Boom'));
    const id = result.current.toasts[0].id;
    act(() => result.current.removeToast(id));
    expect(result.current.toasts).toEqual([]);
  });
});
