import type { RouteObject } from 'react-router';
import { expect, test, vi } from 'vitest';
import { preloadRoutes } from '@/test/renderApp';

// BUG-043: the first lazy page a test file opened was downloaded and compiled INSIDE its first test,
// so on a busy machine findBy* (1 s) timed out while the spinner was still on screen.
test('TC-NF-24 preloadRoutes runs every lazy loader once, at any depth, and waits for all of them', async () => {
  const done: string[] = [];
  const loader = (name: string) =>
    vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1)); // a loader that takes a moment
      done.push(name);
      return { Component: () => null };
    });
  const [top, nested, deep] = [loader('top'), loader('nested'), loader('deep')];
  const table: RouteObject[] = [
    { path: '/a', lazy: top },
    { children: [{ path: '/b', lazy: nested }, { path: '/plain', element: null }, { children: [{ path: '/c', lazy: deep }] }] },
  ];

  await preloadRoutes(table);

  expect([top, nested, deep].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
  expect(done.sort()).toEqual(['deep', 'nested', 'top']); // finished, not just started
});
