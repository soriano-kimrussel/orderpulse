import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/connect.js';
import { createRealtimeServer } from './realtime/socket.js';
import { startWebhookWorker, type WorkerHandle } from './worker/webhookWorker.js';

/**
 * Starts everything: database, HTTP API, Socket.IO and the webhook worker.
 *
 * The worker runs in the same process as the API on purpose. It emits
 * Socket.IO events when it creates or updates an order, and that needs the
 * in-process Socket.IO server. See the README for how this would be split.
 */
export async function startServer(options: { onShutdown?: () => Promise<void> } = {}): Promise<void> {
  await connectDatabase(env.MONGODB_URI);

  const httpServer = createServer(createApp());
  const io = createRealtimeServer(httpServer);
  const worker: WorkerHandle | null = env.WORKER_ENABLED ? startWebhookWorker() : null;

  await new Promise<void>((resolve) => {
    httpServer.listen(env.PORT, resolve);
  });
  console.log(`[server] listening on http://localhost:${env.PORT}`);
  console.log(`[worker] ${worker ? `polling every ${env.WORKER_POLL_MS}ms` : 'disabled'}`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received, shutting down`);

    // Let the worker finish the event it is on, then close sockets and HTTP.
    await worker?.stop();
    await io.close();
    await disconnectDatabase();
    await options.onShutdown?.();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
