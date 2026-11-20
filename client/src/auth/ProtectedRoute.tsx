import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './useAuth';

// Layout route: renders the child routes only for a logged-in user, otherwise goes to /login and
// remembers where the user wanted to go. (While the session is restoring, App shows a splash.)
export default function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
