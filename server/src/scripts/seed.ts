import { env } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../db/connect.js';
import {
  DEMO_ADMIN_EMAIL,
  DEMO_MEMBER_EMAIL,
  DEMO_PASSWORD,
  seedDemoData,
} from './seedData.js';

/** `npm run seed`: writes the demo account into the database in MONGODB_URI. */
async function main(): Promise<void> {
  await connectDatabase(env.MONGODB_URI);
  const result = await seedDemoData();
  await disconnectDatabase();

  console.log(`Seeded ${result.orders} orders for account ${result.accountId}`);
  console.log(`  admin:  ${DEMO_ADMIN_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  member: ${DEMO_MEMBER_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`Send a test webhook with:`);
  console.log(`  npm run webhook:send -- --account ${result.accountId}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
