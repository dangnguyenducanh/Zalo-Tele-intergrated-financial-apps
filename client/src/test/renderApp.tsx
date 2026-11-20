import { render } from '@testing-library/react';
import { createMemoryRouter, type RouteObject } from 'react-router';
import App from '@/App';
import { makeStore } from '@/app/store';
import { routes } from '@/router';

// Renders the whole app (store, AuthContext, theme, router) at `path`, with a fresh store.
export function renderApp(path = '/', routeTable: RouteObject[] = routes) {
  const store = makeStore();
  const router = createMemoryRouter(routeTable, { initialEntries: [path] });
  return { store, router, ...render(<App store={store} router={router} />) };
}
