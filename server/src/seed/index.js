// Entry point for `npm run seed` (default category templates + first admin) and `npm run seed:test`
// (admin + userA + userB; fixtures come with T16). Accounts are read from server/.env. Safe to run again.
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { User } from '../models/User.js';
import { onUserRegistered } from '../services/auth.js';
import { seedCategoryTemplates } from '../services/categories.js';
import { seedUsers } from '../services/users.js';

await connectDb();
await seedCategoryTemplates(); // first, so the seeded users get copies of the templates
await seedUsers(process.env, { test: process.argv.includes('--test') });
// Accounts made before default data existed get it now; accounts that already have it are skipped.
for (const user of await User.find()) await onUserRegistered(user);
await mongoose.disconnect();
