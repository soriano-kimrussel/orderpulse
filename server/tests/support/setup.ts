import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, inject } from 'vitest';
import { connectDatabase, disconnectDatabase } from '../../src/db/connect.js';

beforeAll(async () => {
  // A separate database per test file, so files can run in parallel.
  const uri = new URL(inject('mongoUri'));
  uri.pathname = `/orderpulse-test-${randomUUID()}`;
  await connectDatabase(uri.toString());
});

afterEach(async () => {
  // Empty the collections but keep them, so the indexes survive between tests.
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await disconnectDatabase();
});
