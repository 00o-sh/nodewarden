// Shared setup for the jsdom-based frontend tests (unit + component).
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { act, cleanup } from '@testing-library/preact';

// Unmount any components rendered during a test so DOM state never leaks
// between tests. Preact 11 runs useEffect cleanups after paint (on a timer in
// jsdom), so unmount inside act() to flush them now; otherwise they can fire
// after the test file's jsdom environment is torn down ("window is not
// defined").
afterEach(() => {
  act(() => cleanup());
});
