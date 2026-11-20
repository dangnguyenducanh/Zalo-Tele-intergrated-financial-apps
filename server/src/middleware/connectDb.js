import { connectDb } from '../config/db.js';

// Every API route awaits the cached MongoDB connection before it runs (docs/04 §4.2).
// If MongoDB is unreachable the error reaches the error middleware as a 500.
export async function connectDbMiddleware(req, res, next) {
  await connectDb();
  next();
}
