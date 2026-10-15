// Shared setup for the jsdom-based frontend tests (unit + component).
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach } from 'vitest';
import { act, cleanup } from '@testing-library/preact';

// Unmount any components rendered during a test so DOM state never leaks
// between tests. Preact 11 runs useEffect cleanups after paint (on a timer in
// jsdom), so unmount inside act() to flush them now; otherwise they can fire
// after the test file's jsdom environment is torn down ("window is not
// defined").
afterEach(() => {
  act(() => cleanup());
});

// A render that settles outside act() (e.g. a promise resolving after the last
// assertion) still schedules its effects on Preact's after-paint timer, which in
// jsdom is a 35ms setTimeout. If that timer is pending when the file ends, it
// fires after jsdom is torn down. Let it run once while `window` still exists.
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
});
