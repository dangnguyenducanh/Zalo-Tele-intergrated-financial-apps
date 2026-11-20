import { render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import App from './App';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('TC-NF-06 App shows the API and database status from /api/health', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 'ok', db: 'up' }));
  vi.stubGlobal('fetch', fetchMock);

  render(<App />);

  expect(await screen.findByRole('status')).toHaveTextContent('API: ok · DB: up');
  expect(fetchMock).toHaveBeenCalledWith('/api/health');
});

test('TC-NF-06 App says the API is unreachable when the request fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

  render(<App />);

  expect(await screen.findByText('API: unreachable')).toBeInTheDocument();
});
