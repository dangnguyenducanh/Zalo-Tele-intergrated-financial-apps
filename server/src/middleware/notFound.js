import { AppError } from '../utils/AppError.js';

// Runs after every router: nothing matched, so answer 404 in the standard error shape.
export function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
}
