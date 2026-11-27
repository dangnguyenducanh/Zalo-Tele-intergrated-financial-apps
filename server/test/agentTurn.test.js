import mongoose from 'mongoose';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { AgentTurn } from '../src/models/AgentTurn.js';
import { startTestDb, stopTestDb } from './helpers/db.js';

// docs/03 §3.7: the agent service's setup creates agentTurns and its indexes (the unique (userId, requestId), the 30-day TTL),
// because its MongoDB role has no right to. Express only reads the collection and sets clearedAt, so its model must create nothing.
beforeAll(startTestDb);
afterAll(stopTestDb);

test('TC-F14-98 the Express AgentTurn model declares no index and creates neither the collection nor an index when it starts or on a first insert', async () => {
  expect(AgentTurn.collection.name).toBe('agentTurns');
  expect(AgentTurn.schema.indexes()).toEqual([]);

  await AgentTurn.init();
  const names = async () => (await mongoose.connection.db.listCollections().toArray()).map((collection) => collection.name);
  expect(await names()).not.toContain('agentTurns'); // Model.init() made nothing

  await AgentTurn.create({ userId: new mongoose.Types.ObjectId(), channel: 'web', threadKey: 'web', requestId: 'r1', trigger: 'chat', answer: 'x' });
  expect(await names()).toContain('agentTurns');
  const indexes = await AgentTurn.collection.indexes();
  expect(indexes.map((index) => index.name)).toEqual(['_id_']); // no unique index, no TTL: those are python -m agent.setup's
});
