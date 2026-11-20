// Entry point for `npm run seed` (first admin; default category templates come with T05) and
// `npm run seed:test` (admin + userA + userB; fixtures come with T16). Accounts are read from server/.env.
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { seedUsers } from '../services/users.js';

await connectDb();
await seedUsers(process.env, { test: process.argv.includes('--test') });
await mongoose.disconnect();
