import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

// Gives every request an id (sent back as X-Request-Id) and logs one line when the response is done,
// so an error seen in the browser can be matched to its API log line.
export function requestId(req, res, next) {
  req.id = randomUUID();
  res.set('X-Request-Id', req.id);
  const started = Date.now();
  res.on('finish', () => {
    if (env.NODE_ENV === 'test') return;
    console.info(`${req.id} ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`);
  });
  next();
}
