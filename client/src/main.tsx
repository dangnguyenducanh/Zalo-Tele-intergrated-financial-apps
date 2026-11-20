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
