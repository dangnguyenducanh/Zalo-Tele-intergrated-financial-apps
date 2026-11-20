import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDb } from '../../src/config/db.js';

// A real, throw-away MongoDB per test file (docs/07 §7.2). Usage:
//   beforeAll(startTestDb); afterEach(clearTestDb); afterAll(stopTestDb);
let mongod;

export async function startTestDb() {
  mongod = await MongoMemoryServer.create();
  await connectDb(mongod.getUri()); // later connectDb() calls from the app reuse this connection
}

export async function clearTestDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export async function stopTestDb() {
  await mongoose.disconnect();
  await mongod?.stop();
}
