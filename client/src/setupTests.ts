import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { setSession } from './auth/session';
import i18n from './i18n';
import { resetFake, server } from './test/fakeApi';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' })); // a request without a handler fails the test
afterAll(() => server.close());

beforeEach(async () => {
  localStorage.clear();
  setSession(null);
  resetFake();
  await i18n.changeLanguage('vi');
});

// Vitest globals are off, so React Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
