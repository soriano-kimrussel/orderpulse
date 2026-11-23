import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.routes.js';
import { ordersRouter } from './routes/orders.routes.js';
import { statsRouter } from './routes/stats.routes.js';
import { usersRouter } from './routes/users.routes.js';
import { webhooksRouter } from './routes/webhooks.routes.js';

/**
 * Builds the Express app without starting a listener, so tests can drive it
 * with supertest and server.ts can attach Socket.IO to the same HTTP server.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN }));

  // Mounted before express.json(): the webhook route needs the raw body bytes
  // to verify the HMAC signature.
  app.use('/webhooks', webhooksRouter);

  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/stats', statsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
