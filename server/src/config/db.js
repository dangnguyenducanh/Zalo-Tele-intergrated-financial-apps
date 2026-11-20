import mongoose from 'mongoose';
import { attachDatabasePool } from '@vercel/functions';
import { env } from './env.js';

// Operator injection guard (docs/04 §4.10): an object such as {"$gt": ""} that reaches a query filter
// from user input is matched as a plain value. Filters the server builds itself with operators must
// opt in with mongoose.trusted(), e.g. { date: mongoose.trusted({ $gte: from }) }.
mongoose.set('sanitizeFilter', true);

// One cached connection promise per process: warm Vercel invocations (and every request locally)
// reuse it instead of opening a new connection.
let connection;

export function connectDb(uri = env.MONGODB_URI) {
  connection ??= mongoose
    .connect(uri, { dbName: env.MONGODB_DB || undefined, serverSelectionTimeoutMS: 5000 })
    .then((m) => {
      // Lets Vercel's Fluid compute release idle pooled connections properly (no-op outside Vercel).
      attachDatabasePool(m.connection.getClient());
      return m;
    })
    .catch((err) => {
      connection = undefined; // the next request tries again instead of reusing a failed promise
      throw err;
    });
  return connection;
}
