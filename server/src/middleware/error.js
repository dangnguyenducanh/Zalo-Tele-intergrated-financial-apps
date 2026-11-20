import { STATUS_CODES } from 'node:http';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';

const CLIENT_ERROR_CODES = { 400: 'VALIDATION_ERROR', 413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE' };

// Maps any thrown error to { status, body } with the shape { error: { code, message, details? } }.
export function toErrorResponse(err) {
  if (err instanceof AppError) {
    return reply(err.status, err.code, err.message, err.details);
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), issue: i.code }));
    return reply(400, 'VALIDATION_ERROR', 'Invalid input', details);
  }
  if (err.name === 'CastError') {
    return reply(400, 'VALIDATION_ERROR', `Invalid value for ${err.path}`, [{ path: err.path, issue: 'invalid' }]);
  }
  if (err.code === 11000) {
    const details = Object.keys(err.keyValue ?? {}).map((path) => ({ path, issue: 'duplicate' }));
    return reply(409, 'CONFLICT', 'Resource already exists', details);
  }
  // Client mistakes caught by Express or its body parser (bad JSON, body too large, unsupported charset
  // or encoding, undecodable URL parameter) carry a 4xx `status`, which Express's own handler keeps too.
  const status = err.status ?? err.statusCode;
  if (status >= 400 && status < 500) {
    // `expose` marks a message written for clients; otherwise send the standard reason phrase.
    return reply(status, CLIENT_ERROR_CODES[status] ?? 'BAD_REQUEST', err.expose ? err.message : STATUS_CODES[status]);
  }
  // Anything else is a bug: hide the message and the stack from the client.
  return reply(500, 'INTERNAL', 'Internal server error');
}

function reply(status, code, message, details) {
  return { status, body: { error: details ? { code, message, details } : { code, message } } };
}

// Express recognises an error middleware by its 4 parameters, so `_next` must stay.
export function errorHandler(err, req, res, _next) {
  const { status, body } = toErrorResponse(err);
  if (status >= 500) console.error(`${req.id} ${req.method} ${req.originalUrl}`, err);
  res.status(status).json(body);
}
