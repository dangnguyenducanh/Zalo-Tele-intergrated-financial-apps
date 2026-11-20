import { Provider } from 'react-redux';
import { RouterProvider, type createBrowserRouter } from 'react-router';
import type { AppStore } from './app/store';
import { AuthProvider } from './auth/AuthContext';
import { useAuth } from './auth/useAuth';
import Splash from './components/Splash';
import { AppThemeProvider } from './theme/AppThemeProvider';

type Router = ReturnType<typeof createBrowserRouter>;

// Providers, outermost first: Redux store → AuthContext → MUI theme → router (docs/05 §5.1).
// main.tsx passes the real store and a browser router; tests pass a fresh store and a memory router.
export default function App({ store, router }: { store: AppStore; router: Router }) {
  return (
    <Provider store={store}>
      <AuthProvider>
        <AppThemeProvider>
          <Pages router={router} />
        </AppThemeProvider>
      </AuthProvider>
    </Provider>
  );
}

// Until the session is restored we don't know whether to show the app or /login, so show a splash.
function Pages({ router }: { router: Router }) {
  const { status } = useAuth();
  return status === 'loading' ? <Splash /> : <RouterProvider router={router} />;
}
