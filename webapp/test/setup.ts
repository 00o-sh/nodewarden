// Shared setup for the jsdom-based frontend tests (unit + component).
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/preact';

// Unmount any components rendered during a test so DOM state never leaks
// between tests.
afterEach(() => {
  cleanup();
});
