import { startServer } from './bootstrap.js';

startServer().catch((error: unknown) => {
  console.error('[server] failed to start', error);
  process.exit(1);
});
