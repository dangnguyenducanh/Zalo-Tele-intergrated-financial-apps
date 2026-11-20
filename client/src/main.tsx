import '@fontsource-variable/chivo'; // self-hosted; each subset (Vietnamese included) downloads only when its glyphs appear
import '@fontsource-variable/chivo-mono';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import App from './App';
import { store } from './app/store';
import './i18n';
import { routes } from './router';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} router={createBrowserRouter(routes)} />
  </StrictMode>,
);
