/**
 * `npm run dev:memory`: runs the whole server against an in-memory MongoDB,
 * seeded with demo data. No database to install or configure.
 *
 * The data lives only as long as this process. For a persistent database, set
 * MONGODB_URI in .env and use `npm run dev` instead.
 */
import 'dotenv/config';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();

// Set before the app is imported below: config/env.ts reads process.env at import time.
process.env.MONGODB_URI = mongod.getUri('orderpulse');
process.env.JWT_SECRET ??= 'dev-memory-only-jwt-secret';
process.env.WEBHOOK_SECRET ??= 'dev-memory-only-webhook-secret';

const { connectDatabase } = await import('./db/connect.js');
const { DEMO_ADMIN_EMAIL, DEMO_MEMBER_EMAIL, DEMO_PASSWORD, seedDemoData } = await import(
  './scripts/seedData.js'
);
const { startServer } = await import('./bootstrap.js');

await connectDatabase(process.env.MONGODB_URI);
const seeded = await seedDemoData();

await startServer({ onShutdown: () => mongod.stop().then(() => undefined) });

console.log(`[dev:memory] in-memory MongoDB at ${process.env.MONGODB_URI}`);
console.log(`[dev:memory] seeded ${seeded.orders} orders for account ${seeded.accountId}`);
console.log(`[dev:memory] log in as ${DEMO_ADMIN_EMAIL} or ${DEMO_MEMBER_EMAIL} / ${DEMO_PASSWORD}`);
console.log(`[dev:memory] test webhook: npm run webhook:send -- --account ${seeded.accountId}`);
