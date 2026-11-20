import { AppError } from '../utils/AppError.js';

// Use after requireAuth, e.g. router.use(requireAuth, requireRole('admin')). The role comes from the JWT.
export function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) throw new AppError(403, 'FORBIDDEN', 'You are not allowed to do this');
    next();
  };
}
