import mongoose from 'mongoose';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { startTestDb, stopTestDb } from './helpers/db.js';

beforeAll(startTestDb);
afterAll(stopTestDb);

test('TC-NF-04 sanitizeFilter treats an operator object from user input as a plain value', async () => {
  const User = mongoose.model('SanitizeProbe', new mongoose.Schema({ email: String }));
  await User.create({ email: 'a@example.com' });

  // A login body like {"email":{"$gt":""}} must not match every user: the filter becomes
  // {email: {$eq: {$gt: ''}}}, which fails to cast to a string (the error middleware answers 400).
  await expect(User.findOne({ email: { $gt: '' } })).rejects.toMatchObject({ name: 'CastError' });
  // Filters the server builds itself opt in to operators with mongoose.trusted().
  expect(await User.findOne({ email: mongoose.trusted({ $gt: '' }) })).not.toBeNull();
});
