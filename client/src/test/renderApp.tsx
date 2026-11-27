import { render } from '@testing-library/react';
import { createMemoryRouter, type RouteObject } from 'react-router';
import App from '@/App';
import { makeStore } from '@/app/store';
import { routes } from '@/router';

// Calls every route's `lazy` loader (at any depth) and waits for all of them, so each page's code is
// downloaded and compiled once, here, and not inside the first test that opens it.
export async function preloadRoutes(table: RouteObject[]): Promise<void> {
  const loads = table.flatMap((route) => [
    typeof route.lazy === 'function' ? route.lazy() : [], // no route uses the object form of `lazy`
    preloadRoutes(route.children ?? []),
  ]);
  await Promise.all(loads);
}

// BUG-043: the first lazy page of a test file used to load inside its first test. On a busy machine that
// took longer than findBy*'s 1 s and the spinner was still on screen. A top-level await runs while the
// file is being imported, before any test starts, and no test timer runs then.
await preloadRoutes(routes);

// Renders the whole app (store, AuthContext, theme, router) at `path`, with a fresh store.
export function renderApp(path = '/', routeTable: RouteObject[] = routes) {
  const store = makeStore();
  const router = createMemoryRouter(routeTable, { initialEntries: [path] });
  return { store, router, ...render(<App store={store} router={router} />) };
}
