// An expected error with an HTTP status and a stable machine-readable code (docs/04 §4.5).
// Throw it from any route or service; the error middleware turns it into JSON.
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
